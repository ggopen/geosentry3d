/**
 * 对象分割器（v1.1 核心升级）
 *
 * 解决旧版"只能识别成立方体、边界不准确"的问题：
 * 1. **DBSCAN 密度聚类**（density-clustering，成熟第三方库）——对采样点云做对象级
 *    分割：自动去噪、分离相邻对象，取代旧版粗糙的网格连通域 + 全局 PCA。
 * 2. **concaveman 凹包**（Mapbox 系成熟库）——从簇内点集提取贴合真实形状的
 *    凹多边形边界，取代立方体近似。
 * 3. **旋转卡壳最小面积矩形**（自研，utils/geo）——精确的 长×宽×方向。
 * 4. 形状特征（面积/周长/长宽比/圆形度/密实度）供识别 Agent 做更可靠的分类。
 *
 * 纯计算模块，不依赖 Cesium，可独立单元测试。
 */
import concaveman from 'concaveman'
import { DBSCAN } from 'density-clustering'
import { localPerimeter, localPolygonArea, minAreaRect, percentile, polygonArea } from '../utils/geo'

/** 单个采样点（局部平面坐标 + 经纬度 + 高度） */
export interface SamplePoint {
  /** 局部 x（东，米） */
  x: number
  /** 局部 y（北，米） */
  y: number
  /** 采样高度（米） */
  h: number
  lon: number
  lat: number
}

/** 形状特征 */
export interface ShapeFeatures {
  /** 长宽比（长/宽，≥1） */
  aspectRatio: number
  /** 圆形度 4π·A/P²（圆=1，细长→0） */
  circularity: number
  /** 密实度：凹包面积 / 凸性近似（用最小外接矩形面积近似，越接近 1 越规则饱满） */
  solidity: number
}

/** 一个分割出的对象 */
export interface Segment {
  /** 簇内采样点 */
  points: SamplePoint[]
  /** 凹包边界（经纬度，不闭合） */
  footprint: Array<{ lon: number; lat: number }>
  /** 凹包边界（局部坐标，不闭合） */
  footprintLocal: Array<{ x: number; y: number }>
  /** 最小面积外接矩形 */
  rect: ReturnType<typeof minAreaRect>
  /** 对象高度 = 簇内 P98 高度 − 地面基准 */
  height: number
  /** 边界多边形测地面积（米²） */
  area: number
  /** 边界周长（米） */
  perimeter: number
  features: ShapeFeatures
}

export interface SegmentOptions {
  /** DBSCAN 邻域半径（米），通常取采样步长的 1.5~2 倍 */
  eps: number
  /** DBSCAN 最小点数 */
  minPts?: number
  /** 凹包 concavity 参数（1=非常贴合，越大越接近凸包） */
  concavity?: number
  /** 地面基准高度（米） */
  ground: number
  /** 丢弃面积小于该值的簇（米²） */
  minArea?: number
}

export class Segmenter {
  /**
   * 对采样点集做 DBSCAN 分割，返回按面积降序的对象段。
   */
  segment(points: SamplePoint[], opts: SegmentOptions): Segment[] {
    const { eps, minPts = 3, concavity = 2, ground, minArea = 0.3 } = opts
    if (points.length < minPts) return []

    const dataset = points.map((p) => [p.x, p.y])
    const dbscan = new DBSCAN()
    const clusters: number[][] = dbscan.run(dataset, eps, minPts)

    const segments: Segment[] = []
    for (const cluster of clusters) {
      const pts = cluster.map((i) => points[i])
      if (pts.length < minPts) continue

      // 凹包边界（局部坐标）。点太少时退化为最小外接矩形角点
      let footprintLocal: Array<{ x: number; y: number }>
      const rect = minAreaRect(pts.map((p) => ({ x: p.x, y: p.y })))
      if (pts.length >= 4) {
        const hull = concaveman(
          pts.map((p) => [p.x, p.y]),
          concavity,
          eps
        )
        footprintLocal = hull.map(([x, y]) => ({ x, y }))
        if (footprintLocal.length < 3) footprintLocal = rect.corners
      } else {
        footprintLocal = rect.corners
      }

      // 局部凹包 → 经纬度（用簇内最近采样点映射回 lon/lat 太粗糙，直接按比例插值：
      // 由于局部坐标系与经纬度是仿射关系，直接用点的 lon/lat 做同样的凹包索引不可行，
      // 因此用局部坐标与经纬度的线性映射系数换算）
      const { kx, ky, lon0, lat0 } = this.affineFromPoints(pts)
      const footprint = footprintLocal.map((p) => ({ lon: lon0 + p.x * kx, lat: lat0 + p.y * ky }))

      const area = polygonArea(footprint)
      if (area < minArea) continue

      const perimeter = localPerimeter(footprintLocal)
      const height = percentile(pts.map((p) => p.h), 0.98) - ground
      const rectArea = Math.max(rect.length * rect.width, 1e-6)
      segments.push({
        points: pts,
        footprint,
        footprintLocal,
        rect,
        height: Math.max(0.1, height),
        area,
        perimeter,
        features: {
          aspectRatio: rect.width > 1e-6 ? rect.length / rect.width : 99,
          circularity: perimeter > 1e-6 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0,
          solidity: Math.min(1, area / rectArea)
        }
      })
    }
    return segments.sort((a, b) => b.area - a.area)
  }

  /**
   * 由簇内点估计"局部坐标 → 经纬度"的仿射系数。
   * 局部坐标 x（东）/ y（北）与 lon/lat 在工程尺度上是线性关系。
   */
  private affineFromPoints(pts: SamplePoint[]): { kx: number; ky: number; lon0: number; lat0: number } {
    // 用 x/y 与 lon/lat 的最小二乘拟合
    const n = pts.length
    const mx = pts.reduce((s, p) => s + p.x, 0) / n
    const my = pts.reduce((s, p) => s + p.y, 0) / n
    const mLon = pts.reduce((s, p) => s + p.lon, 0) / n
    const mLat = pts.reduce((s, p) => s + p.lat, 0) / n
    let sxx = 0
    let sxLon = 0
    let syy = 0
    let syLat = 0
    for (const p of pts) {
      sxx += (p.x - mx) ** 2
      sxLon += (p.x - mx) * (p.lon - mLon)
      syy += (p.y - my) ** 2
      syLat += (p.y - my) * (p.lat - mLat)
    }
    const kx = sxx > 1e-12 ? sxLon / sxx : 1e-5
    const ky = syy > 1e-12 ? syLat / syy : 1e-5
    return { kx, ky, lon0: mLon - mx * kx, lat0: mLat - my * ky }
  }
}
