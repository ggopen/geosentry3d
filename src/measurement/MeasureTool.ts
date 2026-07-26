/**
 * 交互式手动测量工具（Phase 1 基础测量）
 * 支持距离（折线）、面积（多边形）、高度（两点竖直差）三种模式。
 * 数值计算走 utils/geo 的纯函数，与渲染解耦。
 */
import * as Cesium from 'cesium'
import { haversineDistance, polygonArea, polylineLength } from '../utils/geo'
import { round2 } from '../utils/number'

export type MeasureMode = 'distance' | 'area' | 'height'

export interface MeasureResult {
  mode: MeasureMode
  value: number
  unit: string
  text: string
}

export class MeasureTool {
  private viewer: Cesium.Viewer
  private handler: Cesium.ScreenSpaceEventHandler | null = null
  private dataSource: Cesium.CustomDataSource
  private points: Cesium.Cartographic[] = []
  private activeEntity: Cesium.Entity | null = null
  private mode: MeasureMode = 'distance'
  private onComplete: ((r: MeasureResult) => void) | null = null

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer
    this.dataSource = new Cesium.CustomDataSource('manual-measure')
    viewer.dataSources.add(this.dataSource)
  }

  /** 启动一次测量 */
  start(mode: MeasureMode, onComplete: (r: MeasureResult) => void): void {
    this.stop()
    this.mode = mode
    this.onComplete = onComplete
    this.points = []
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)

    this.handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const carto = this.pick(e.position)
      if (!carto) return
      this.points.push(carto)
      this.drawPoints()
      if (this.mode === 'height' && this.points.length === 2) this.finish()
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    this.handler.setInputAction(() => {
      if (this.points.length >= (this.mode === 'area' ? 3 : 2)) this.finish()
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  }

  private pick(position: Cesium.Cartesian2): Cesium.Cartographic | null {
    const cartesian = this.viewer.scene.pickPosition(position)
    if (!cartesian) return null
    return Cesium.Cartographic.fromCartesian(cartesian)
  }

  private drawPoints(): void {
    this.dataSource.entities.removeAll()
    for (const p of this.points) {
      this.dataSource.entities.add({
        position: Cesium.Cartesian3.fromRadians(p.longitude, p.latitude, p.height),
        point: { pixelSize: 8, color: Cesium.Color.CYAN, disableDepthTestDistance: Number.POSITIVE_INFINITY }
      })
    }
    if (this.points.length >= 2) {
      const positions = this.points.map((p) => Cesium.Cartesian3.fromRadians(p.longitude, p.latitude, p.height))
      if (this.mode === 'area' && this.points.length >= 3) positions.push(positions[0])
      this.activeEntity = this.dataSource.entities.add({
        polyline: {
          positions,
          width: 3,
          material: Cesium.Color.CYAN,
          clampToGround: false
        }
      })
    }
  }

  private finish(): void {
    const pts = this.points.map((p) => ({
      lon: Cesium.Math.toDegrees(p.longitude),
      lat: Cesium.Math.toDegrees(p.latitude),
      height: p.height
    }))
    let result: MeasureResult
    if (this.mode === 'distance') {
      const v = polylineLength(pts)
      result = { mode: 'distance', value: round2(v), unit: 'm', text: `距离 ${round2(v)} m` }
    } else if (this.mode === 'area') {
      const v = polygonArea(pts)
      const perimeter = polylineLength([...pts, pts[0]])
      result = { mode: 'area', value: round2(v), unit: 'm²', text: `面积 ${round2(v)} m² / 周长 ${round2(perimeter)} m` }
    } else {
      const v = Math.abs(pts[1].height - pts[0].height)
      const horizontal = haversineDistance(pts[0].lon, pts[0].lat, pts[1].lon, pts[1].lat)
      const slopeDeg = horizontal > 0 ? (Math.atan2(v, horizontal) * 180) / Math.PI : 90
      result = { mode: 'height', value: round2(v), unit: 'm', text: `高度差 ${round2(v)} m（水平距 ${round2(horizontal)} m，坡角 ${round2(slopeDeg)}°）` }
    }
    // 结果标签
    const last = this.points[this.points.length - 1]
    this.dataSource.entities.add({
      position: Cesium.Cartesian3.fromRadians(last.longitude, last.latitude, last.height + 2),
      label: {
        text: result.text,
        font: '14px sans-serif',
        fillColor: Cesium.Color.CYAN,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
    this.onComplete?.(result)
    this.handler?.destroy()
    this.handler = null
  }

  /** 终止当前测量（保留已绘制内容） */
  stop(): void {
    this.handler?.destroy()
    this.handler = null
  }

  /** 清除所有手动测量图形 */
  clear(): void {
    this.stop()
    this.dataSource.entities.removeAll()
    this.points = []
  }
}
