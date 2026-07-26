/**
 * Scene Service：Cesium Viewer 管理 + 3D Tiles 加载 + 真实几何采样。
 *
 * 核心原则：Never guess geometry. Always call measurement tools.
 * 本服务是"测量工具"的几何数据源：
 *  - analyzeAt() 通过 scene.sampleHeightMostDetailed 对点击位置周边做网格采样，
 *    用采样点云计算局部 OBB（PCA 定向），绝不臆造尺寸。
 *  - autoScan() 对整个瓦片集包围区做网格采样 + 连通域聚类，自动发现凸出对象。
 */
import * as Cesium from 'cesium'
import type { BoundingInfo } from '../core/types'
import { clusterGrid, pca2d, toLocalXY } from '../utils/geo'

export class SceneService {
  private viewer: Cesium.Viewer | null = null
  private tileset: Cesium.Cesium3DTileset | null = null

  get isReady(): boolean {
    return this.viewer !== null && this.tileset !== null
  }

  /** 初始化 Viewer（不使用 ion 资源，保证离线/无令牌可用） */
  init(container: HTMLElement): Cesium.Viewer {
    const viewer = new Cesium.Viewer(container, {
      baseLayer: false,
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: true,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false
    })
    viewer.scene.globe.show = false
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0b1017')
    this.viewer = viewer
    return viewer
  }

  getViewer(): Cesium.Viewer {
    if (!this.viewer) throw new Error('Viewer 尚未初始化')
    return this.viewer
  }

  /** 加载 3D Tiles 并定位 */
  async loadTileset(url: string): Promise<Cesium.Cesium3DTileset> {
    const viewer = this.getViewer()
    const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
      maximumScreenSpaceError: 8,
      skipLevelOfDetail: true
    })
    viewer.scene.primitives.add(tileset)
    this.tileset = tileset
    await viewer.zoomTo(tileset)
    return tileset
  }

  /** 拾取屏幕位置的地理坐标 */
  pickCartographic(position: Cesium.Cartesian2): Cesium.Cartographic | null {
    const viewer = this.getViewer()
    const ray = viewer.camera.getPickRay(position)
    if (!ray) return null
    const cartesian = viewer.scene.pickPosition(position)
    if (!cartesian) {
      const globe = viewer.scene.globe
      const c = globe.pick(ray, viewer.scene)
      if (!c) return null
      return Cesium.Cartographic.fromCartesian(c)
    }
    return Cesium.Cartographic.fromCartesian(cartesian)
  }

  /** 分批对瓦片集做最详细层级高度采样 */
  private async sampleHeights(
    cartos: Cesium.Cartographic[],
    chunkSize = 120,
    onProgress?: (done: number, total: number) => void
  ): Promise<Array<Cesium.Cartographic | undefined>> {
    const scene = this.getViewer().scene
    const results: Array<Cesium.Cartographic | undefined> = new Array(cartos.length)
    for (let i = 0; i < cartos.length; i += chunkSize) {
      const chunk = cartos.slice(i, i + chunkSize)
      const sampled = await scene.sampleHeightMostDetailed(chunk)
      for (let j = 0; j < chunk.length; j++) {
        results[i + j] = sampled[j] && Number.isFinite(sampled[j].height) ? sampled[j] : undefined
      }
      onProgress?.(Math.min(i + chunkSize, cartos.length), cartos.length)
    }
    return results
  }

  /**
   * 点击分析：以点击点为中心做局部网格采样，计算 OBB。
   * @param radius 采样半径（米）
   */
  async analyzeAt(
    position: Cesium.Cartesian2,
    radius = 2.0,
    step = 0.4
  ): Promise<BoundingInfo | null> {
    const center = this.pickCartographic(position)
    if (!center) return null

    const centerLon = Cesium.Math.toDegrees(center.longitude)
    const centerLat = Cesium.Math.toDegrees(center.latitude)
    const ref = { lon: centerLon, lat: centerLat }
    const latDegPerM = 1 / 111320
    const lonDegPerM = 1 / (111320 * Math.cos(center.latitude))

    // 构建采样网格
    const cartos: Cesium.Cartographic[] = []
    const gridXY: Array<{ x: number; y: number }> = []
    const n = Math.max(2, Math.round((radius * 2) / step))
    for (let iy = 0; iy <= n; iy++) {
      for (let ix = 0; ix <= n; ix++) {
        const x = -radius + ix * step
        const y = -radius + iy * step
        gridXY.push({ x, y })
        cartos.push(
          Cesium.Cartographic.fromDegrees(centerLon + x * lonDegPerM, centerLat + y * latDegPerM)
        )
      }
    }

    const sampled = await this.sampleHeights(cartos, 120)
    const heights = sampled.filter((s): s is Cesium.Cartographic => !!s).map((s) => s.height)
    if (heights.length < 4) return null

    const ground = Math.min(...heights)
    const threshold = ground + 0.3
    const elevated: Array<{ x: number; y: number; h: number; lon: number; lat: number }> = []
    sampled.forEach((s, i) => {
      if (s && s.height > threshold) {
        elevated.push({
          x: gridXY[i].x,
          y: gridXY[i].y,
          h: s.height,
          lon: Cesium.Math.toDegrees(s.longitude),
          lat: Cesium.Math.toDegrees(s.latitude)
        })
      }
    })

    // 无凸出物 → 地面面片
    if (elevated.length < 3) {
      return {
        center: { lon: centerLon, lat: centerLat, height: ground },
        width: radius * 2,
        length: radius * 2,
        height: 0.1,
        orientationDeg: 0,
        groundHeight: ground
      }
    }

    // PCA 求 OBB 方向与展布
    const pca = pca2d(elevated.map((p) => ({ x: p.x, y: p.y })))
    const maxH = Math.max(...elevated.map((p) => p.h))
    const objHeight = maxH - ground
    // 对象中心取凸出点均值
    const mLon = elevated.reduce((s, p) => s + p.lon, 0) / elevated.length
    const mLat = elevated.reduce((s, p) => s + p.lat, 0) / elevated.length

    return {
      center: { lon: mLon, lat: mLat, height: ground + objHeight },
      width: Math.max(0.1, Math.min(pca.lengthAlongMajor, pca.lengthAlongMinor) + step),
      length: Math.max(0.1, Math.max(pca.lengthAlongMajor, pca.lengthAlongMinor) + step),
      height: objHeight,
      orientationDeg: pca.orientationDeg,
      groundHeight: ground
    }
  }

  /**
   * 自动扫描：对瓦片集包围区网格采样 + 聚类，自动发现对象。
   */
  async autoScan(
    gridSize = 22,
    maxObjects = 10,
    onProgress?: (done: number, total: number) => void
  ): Promise<BoundingInfo[]> {
    if (!this.tileset) throw new Error('瓦片集未加载')
    const sphere = this.tileset.boundingSphere
    const centerCarto = Cesium.Cartographic.fromCartesian(sphere.center)
    const centerLon = Cesium.Math.toDegrees(centerCarto.longitude)
    const centerLat = Cesium.Math.toDegrees(centerCarto.latitude)
    const half = sphere.radius * 0.75
    const latDegPerM = 1 / 111320
    const lonDegPerM = 1 / (111320 * Math.cos(centerCarto.latitude))

    const cartos: Cesium.Cartographic[] = []
    for (let iy = 0; iy < gridSize; iy++) {
      for (let ix = 0; ix < gridSize; ix++) {
        const x = -half + (2 * half * ix) / (gridSize - 1)
        const y = -half + (2 * half * iy) / (gridSize - 1)
        cartos.push(
          Cesium.Cartographic.fromDegrees(centerLon + x * lonDegPerM, centerLat + y * latDegPerM)
        )
      }
    }

    const sampled = await this.sampleHeights(cartos, 100, onProgress)
    const heights = sampled.filter((s): s is Cesium.Cartographic => !!s).map((s) => s.height)
    if (heights.length < 10) return []

    // 地面基准：取 10% 分位数，避免被噪声拉低
    const sorted = [...heights].sort((a, b) => a - b)
    const ground = sorted[Math.floor(sorted.length * 0.1)]
    const threshold = ground + 1.0

    const mask = sampled.map((s) => !!s && s.height > threshold)
    const clusters = clusterGrid(mask, gridSize, gridSize)

    const ref = { lon: centerLon, lat: centerLat }
    const results: BoundingInfo[] = []
    const sortedClusters = clusters
      .filter((c) => c.length >= 2)
      .sort((a, b) => b.length - a.length)
      .slice(0, maxObjects)

    for (const cluster of sortedClusters) {
      const pts: Array<{ lon: number; lat: number; h: number; x: number; y: number }> = []
      for (const idx of cluster) {
        const s = sampled[idx]
        if (!s) continue
        const lon = Cesium.Math.toDegrees(s.longitude)
        const lat = Cesium.Math.toDegrees(s.latitude)
        const xy = toLocalXY({ lon, lat }, ref)
        pts.push({ lon, lat, h: s.height, x: xy.x, y: xy.y })
      }
      if (pts.length < 2) continue
      const pca = pca2d(pts.map((p) => ({ x: p.x, y: p.y })))
      const cell = (2 * half) / (gridSize - 1)
      const maxH = Math.max(...pts.map((p) => p.h))
      const mLon = pts.reduce((s, p) => s + p.lon, 0) / pts.length
      const mLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
      results.push({
        center: { lon: mLon, lat: mLat, height: maxH },
        width: Math.max(0.2, Math.min(pca.lengthAlongMajor, pca.lengthAlongMinor) + cell),
        length: Math.max(0.2, Math.max(pca.lengthAlongMajor, pca.lengthAlongMinor) + cell),
        height: maxH - ground,
        orientationDeg: pca.orientationDeg,
        groundHeight: ground
      })
    }
    return results
  }

  /** 飞到指定包围盒 */
  flyTo(bbox: BoundingInfo): void {
    const viewer = this.getViewer()
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        bbox.center.lon,
        bbox.center.lat,
        bbox.center.height + Math.max(bbox.length, bbox.height) * 4 + 30
      ),
      duration: 1.2
    })
  }
}
