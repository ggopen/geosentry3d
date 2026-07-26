/**
 * Scene Service：Cesium Viewer 管理 + 3D Tiles 加载 + 真实几何采样。
 *
 * 核心原则：Never guess geometry. Always call measurement tools.
 * 本服务是"测量工具"的几何数据源：
 *  - analyzeAt()：点击位置周边网格采样（sampleHeightMostDetailed），
 *    自适应扩大采样半径直到对象完整落入视野；点云交给 Segmenter
 *    （DBSCAN 分割 + 凹包边界）得到精确对象轮廓。
 *  - autoScan()：全场景网格采样 + DBSCAN 分割，自动发现凸出对象。
 */
import * as Cesium from 'cesium'
import type { BoundingInfo } from '../core/types'
import { percentile, toLocalXY } from '../utils/geo'
import { Segmenter, type SamplePoint, type Segment } from '../segmentation/Segmenter'

export class SceneService {
  private viewer: Cesium.Viewer | null = null
  private tileset: Cesium.Cesium3DTileset | null = null
  private segmenter = new Segmenter()

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
      const c = viewer.scene.globe.pick(ray, viewer.scene)
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

  /** 以 (lon,lat) 为中心做正方形网格高度采样，返回采样点（局部坐标 + 经纬度 + 高度） */
  private async sampleGrid(
    centerLon: number,
    centerLat: number,
    radius: number,
    step: number,
    onProgress?: (done: number, total: number) => void
  ): Promise<SamplePoint[]> {
    const latDegPerM = 1 / 111320
    const lonDegPerM = 1 / (111320 * Math.cos((centerLat * Math.PI) / 180))
    const ref = { lon: centerLon, lat: centerLat }
    const n = Math.max(2, Math.round((radius * 2) / step))
    const cartos: Cesium.Cartographic[] = []
    const gridXY: Array<{ x: number; y: number }> = []
    for (let iy = 0; iy <= n; iy++) {
      for (let ix = 0; ix <= n; ix++) {
        const x = -radius + ix * step
        const y = -radius + iy * step
        gridXY.push({ x, y })
        cartos.push(Cesium.Cartographic.fromDegrees(centerLon + x * lonDegPerM, centerLat + y * latDegPerM))
      }
    }
    const sampled = await this.sampleHeights(cartos, 120, onProgress)
    const pts: SamplePoint[] = []
    sampled.forEach((s, i) => {
      if (!s) return
      pts.push({
        x: gridXY[i].x,
        y: gridXY[i].y,
        h: s.height,
        lon: Cesium.Math.toDegrees(s.longitude),
        lat: Cesium.Math.toDegrees(s.latitude)
      })
    })
    return pts
  }

  /** 把分割结果转换为 BoundingInfo */
  private toBoundingInfo(seg: Segment, ground: number): BoundingInfo {
    const cx = seg.footprint.reduce((s, p) => s + p.lon, 0) / seg.footprint.length
    const cy = seg.footprint.reduce((s, p) => s + p.lat, 0) / seg.footprint.length
    return {
      center: { lon: cx, lat: cy, height: ground + seg.height },
      width: Math.max(0.1, seg.rect.width),
      length: Math.max(0.1, seg.rect.length),
      height: seg.height,
      orientationDeg: seg.rect.orientationDeg,
      groundHeight: ground,
      footprint: seg.footprint,
      footprintArea: seg.area,
      perimeter: seg.perimeter,
      shapeFeatures: seg.features
    }
  }

  /**
   * 点击分析：局部网格采样 + DBSCAN 分割 + 凹包边界。
   * 若对象触到采样边界则自动扩大半径（2m → 4m → 8m），保证大对象完整。
   */
  async analyzeAt(
    position: Cesium.Cartesian2,
    initialRadius = 2.0,
    step = 0.25
  ): Promise<BoundingInfo | null> {
    const center = this.pickCartographic(position)
    if (!center) return null
    const centerLon = Cesium.Math.toDegrees(center.longitude)
    const centerLat = Cesium.Math.toDegrees(center.latitude)

    let radius = initialRadius
    for (let attempt = 0; attempt < 3; attempt++) {
      const pts = await this.sampleGrid(centerLon, centerLat, radius, step)
      if (pts.length < 8) return null

      const ground = percentile(pts.map((p) => p.h), 0.05)
      const elevated = pts.filter((p) => p.h > ground + 0.3)

      // 无凸出物 → 地面面片
      if (elevated.length < 4) {
        return {
          center: { lon: centerLon, lat: centerLat, height: ground },
          width: radius * 2,
          length: radius * 2,
          height: 0.1,
          orientationDeg: 0,
          groundHeight: ground
        }
      }

      const segments = this.segmenter.segment(elevated, {
        eps: step * 2,
        minPts: 3,
        ground,
        minArea: 0.2
      })
      if (segments.length === 0) return null

      // 选包含点击点（局部原点）的簇；否则取面积最大者
      let target =
        segments.find((seg) => seg.points.some((p) => Math.hypot(p.x, p.y) <= step * 1.5)) ??
        segments[0]

      // 对象触到采样边界且还能扩大 → 重新采样
      const touchesBorder = target.points.some(
        (p) => Math.abs(p.x) > radius - step * 1.5 || Math.abs(p.y) > radius - step * 1.5
      )
      if (touchesBorder && radius < 8) {
        radius *= 2
        step *= 1.5
        continue
      }

      // 局部地面基准：取紧邻对象边界的非凸出采样点中位数
      // （全局分位数在地形有坡度时会低估对象基座，导致高度虚高）
      const nearGround: number[] = []
      for (const p of pts) {
        if (p.h > ground + 0.3) continue
        for (const q of target.points) {
          if (Math.abs(p.x - q.x) <= 1.2 && Math.abs(p.y - q.y) <= 1.2) {
            nearGround.push(p.h)
            break
          }
        }
      }
      const groundLocal = nearGround.length >= 3 ? percentile(nearGround, 0.5) : ground
      const info = this.toBoundingInfo(target, groundLocal)
      info.height = Math.max(0.1, ground + target.height - groundLocal)
      info.center.height = groundLocal + info.height
      return info
    }
    return null
  }

  /**
   * 自动扫描：全场景网格采样 + DBSCAN 分割，自动发现对象。
   */
  async autoScan(
    gridSize = 28,
    maxObjects = 12,
    onProgress?: (done: number, total: number) => void
  ): Promise<BoundingInfo[]> {
    if (!this.tileset) throw new Error('瓦片集未加载')
    const sphere = this.tileset.boundingSphere
    const centerCarto = Cesium.Cartographic.fromCartesian(sphere.center)
    const centerLon = Cesium.Math.toDegrees(centerCarto.longitude)
    const centerLat = Cesium.Math.toDegrees(centerCarto.latitude)
    const half = sphere.radius * 0.72
    const latDegPerM = 1 / 111320
    const lonDegPerM = 1 / (111320 * Math.cos(centerCarto.latitude))
    const step = (2 * half) / (gridSize - 1)
    const ref = { lon: centerLon, lat: centerLat }

    const cartos: Cesium.Cartographic[] = []
    for (let iy = 0; iy < gridSize; iy++) {
      for (let ix = 0; ix < gridSize; ix++) {
        const x = -half + step * ix
        const y = -half + step * iy
        cartos.push(Cesium.Cartographic.fromDegrees(centerLon + x * lonDegPerM, centerLat + y * latDegPerM))
      }
    }

    const sampled = await this.sampleHeights(cartos, 100, onProgress)
    const pts: SamplePoint[] = []
    for (const s of sampled) {
      if (!s) continue
      const lon = Cesium.Math.toDegrees(s.longitude)
      const lat = Cesium.Math.toDegrees(s.latitude)
      const xy = toLocalXY({ lon, lat }, ref)
      pts.push({ x: xy.x, y: xy.y, h: s.height, lon, lat })
    }
    if (pts.length < 20) return []

    // 地面基准：10% 分位，抗噪
    const ground = percentile(pts.map((p) => p.h), 0.1)
    const elevated = pts.filter((p) => p.h > ground + 1.2)

    const segments = this.segmenter.segment(elevated, {
      eps: step * 1.6,
      minPts: 2,
      ground,
      minArea: 8
    })
    return segments.slice(0, maxObjects).map((seg) => this.toBoundingInfo(seg, ground))
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
