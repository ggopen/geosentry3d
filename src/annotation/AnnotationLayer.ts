/**
 * Spatial Annotation Engine（空间标注引擎，Cesium 实体渲染层）
 * v1.1：优先绘制**真实边界**（凹包多边形拉伸体），仅在缺少边界时退化为包围盒。
 * 颜色语义：Red=违规 / Yellow=警告 / Green=合规
 */
import * as Cesium from 'cesium'
import type { AnnotationSpec, BoundingInfo } from '../core/types'

const COLOR_MAP: Record<AnnotationSpec['color'], Cesium.Color> = {
  red: Cesium.Color.RED,
  yellow: Cesium.Color.YELLOW,
  green: Cesium.Color.LIME
}

export class AnnotationLayer {
  private viewer: Cesium.Viewer
  private dataSource: Cesium.CustomDataSource

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer
    this.dataSource = new Cesium.CustomDataSource('compliance-annotations')
    viewer.dataSources.add(this.dataSource)
  }

  /** 为一次分析结果添加标注 */
  add(spec: AnnotationSpec, bbox: BoundingInfo): void {
    const color = COLOR_MAP[spec.color]
    const top = Cesium.Cartesian3.fromDegrees(
      bbox.center.lon,
      bbox.center.lat,
      bbox.groundHeight + bbox.height + 1.5
    )

    if (bbox.footprint && bbox.footprint.length >= 3) {
      // 真实边界：凹包多边形拉伸体
      const hierarchy = new Cesium.PolygonHierarchy(
        bbox.footprint.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat))
      )
      this.dataSource.entities.add({
        id: `box-${spec.objectId}`,
        polygon: {
          hierarchy,
          height: bbox.groundHeight,
          extrudedHeight: bbox.groundHeight + Math.max(bbox.height, 0.2),
          material: color.withAlpha(0.35),
          outline: false
        }
      })
      // 顶部轮廓线（闭合）
      const outlinePositions = [
        ...bbox.footprint.map((p) =>
          Cesium.Cartesian3.fromDegrees(p.lon, p.lat, bbox.groundHeight + Math.max(bbox.height, 0.2))
        ),
        Cesium.Cartesian3.fromDegrees(
          bbox.footprint[0].lon,
          bbox.footprint[0].lat,
          bbox.groundHeight + Math.max(bbox.height, 0.2)
        )
      ]
      this.dataSource.entities.add({
        id: `outline-${spec.objectId}`,
        polyline: {
          positions: outlinePositions,
          width: 3,
          material: color,
          clampToGround: false
        }
      })
    } else {
      // 退化：定向包围盒
      const center = Cesium.Cartesian3.fromDegrees(
        bbox.center.lon,
        bbox.center.lat,
        bbox.groundHeight + bbox.height / 2
      )
      this.dataSource.entities.add({
        id: `box-${spec.objectId}`,
        position: center,
        box: {
          dimensions: new Cesium.Cartesian3(
            Math.max(bbox.length, 0.2),
            Math.max(bbox.width, 0.2),
            Math.max(bbox.height, 0.2)
          ),
          material: color.withAlpha(0.3),
          outline: true,
          outlineColor: color,
          outlineWidth: 2
        },
        orientation: Cesium.Transforms.headingPitchRollQuaternion(
          center,
          new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(bbox.orientationDeg), 0, 0)
        )
      })
    }

    // 文本标签
    this.dataSource.entities.add({
      id: `label-${spec.objectId}`,
      position: top,
      label: {
        text: spec.label,
        font: '13px "Microsoft YaHei", sans-serif',
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineColor: color,
        outlineWidth: 3,
        pixelOffset: new Cesium.Cartesian2(0, -10),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(50, 1.2, 2000, 0.4)
      }
    })
  }

  /** 高亮某个对象（闪烁效果） */
  highlight(objectId: string): void {
    const entity = this.dataSource.entities.getById(`box-${objectId}`)
    if (!entity) return
    if (entity.polygon) {
      const polygon = entity.polygon
      const original = (polygon.material as Cesium.ColorMaterialProperty).color?.getValue() ??
        Cesium.Color.RED.withAlpha(0.35)
      polygon.material = new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty(() => {
          const t = Date.now() % 1000
          return (t < 500 ? original : Cesium.Color.WHITE.withAlpha(0.6)) as Cesium.Color
        }, false)
      )
      window.setTimeout(() => {
        polygon.material = new Cesium.ColorMaterialProperty(original)
      }, 3000)
    } else if (entity.box) {
      const box = entity.box
      const original = (box.material as Cesium.ColorMaterialProperty).color?.getValue() ??
        Cesium.Color.RED.withAlpha(0.3)
      box.material = new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty(() => {
          const t = Date.now() % 1000
          return (t < 500 ? original : Cesium.Color.WHITE.withAlpha(0.6)) as Cesium.Color
        }, false)
      )
      window.setTimeout(() => {
        box.material = new Cesium.ColorMaterialProperty(original)
      }, 3000)
    }
  }

  /** 清除全部标注 */
  clear(): void {
    this.dataSource.entities.removeAll()
  }
}
