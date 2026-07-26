/**
 * 纯地理/几何计算工具函数。
 * 与 Cesium 完全解耦，可独立单元测试。
 */

const EARTH_RADIUS = 6378137

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI
}

/** Haversine 球面距离（米） */
export function haversineDistance(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** 两点高度差（竖直测量） */
export function verticalHeight(h1: number, h2: number): number {
  return Math.abs(h2 - h1)
}

/**
 * 多边形测地面积（米²）。
 * 使用局部等距圆柱投影近似，适用于工程尺度（< 数公里）。
 */
export function polygonArea(points: Array<{ lon: number; lat: number }>): number {
  if (points.length < 3) return 0
  const lat0 = toRadians(points[0].lat)
  const kx = toRadians(1) * EARTH_RADIUS * Math.cos(lat0)
  const ky = toRadians(1) * EARTH_RADIUS
  const xy = points.map((p) => ({ x: p.lon * kx, y: p.lat * ky }))
  let sum = 0
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length
    sum += xy[i].x * xy[j].y - xy[j].x * xy[i].y
  }
  return Math.abs(sum / 2)
}

/**
 * 折线长度（米）
 */
export function polylineLength(points: Array<{ lon: number; lat: number }>): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(points[i - 1].lon, points[i - 1].lat, points[i].lon, points[i].lat)
  }
  return total
}

/** 三点夹角（度），B 为顶点 */
export function angleBetween(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
  c: { lon: number; lat: number }
): number {
  const lat0 = toRadians(b.lat)
  const toXY = (p: { lon: number; lat: number }) => ({
    x: toRadians(p.lon - b.lon) * Math.cos(lat0),
    y: toRadians(p.lat - b.lat)
  })
  const va = toXY(a)
  const vc = toXY(c)
  const dot = va.x * vc.x + va.y * vc.y
  const ma = Math.hypot(va.x, va.y)
  const mc = Math.hypot(vc.x, vc.y)
  if (ma === 0 || mc === 0) return 0
  return toDegrees(Math.acos(Math.min(1, Math.max(-1, dot / (ma * mc)))))
}

/**
 * 二维 PCA：返回点集长轴方位角（度，0=北/+y，顺时针）与沿长短轴的展布长度。
 * 用于从采样点云计算 OBB 的方向与尺寸。
 */
export function pca2d(points: Array<{ x: number; y: number }>): {
  orientationDeg: number
  lengthAlongMajor: number
  lengthAlongMinor: number
} {
  if (points.length === 0) return { orientationDeg: 0, lengthAlongMajor: 0, lengthAlongMinor: 0 }
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of points) {
    const dx = p.x - cx
    const dy = p.y - cy
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  // 主方向角（相对 x 轴）
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ux = Math.cos(theta)
  const uy = Math.sin(theta)
  const vx = -uy
  const vy = ux
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const p of points) {
    const dx = p.x - cx
    const dy = p.y - cy
    const u = dx * ux + dy * uy
    const v = dx * vx + dy * vy
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  // theta 是相对东(x)轴的角度，转换为相对北(y)轴的顺时针方位角
  let az = 90 - toDegrees(theta)
  az = ((az % 180) + 180) % 180
  return {
    orientationDeg: Math.round(az * 10) / 10,
    lengthAlongMajor: maxU - minU,
    lengthAlongMinor: maxV - minV
  }
}

/** 经纬度点转局部平面坐标（以 ref 为原点，x=东，y=北，单位米） */
export function toLocalXY(
  p: { lon: number; lat: number },
  ref: { lon: number; lat: number }
): { x: number; y: number } {
  return {
    x: toRadians(p.lon - ref.lon) * EARTH_RADIUS * Math.cos(toRadians(ref.lat)),
    y: toRadians(p.lat - ref.lat) * EARTH_RADIUS
  }
}

/** 网格聚类：对布尔网格做 8-连通域分析，返回每簇的格子索引列表 */
export function clusterGrid(mask: boolean[], cols: number, rows: number): number[][] {
  const visited = new Array(mask.length).fill(false)
  const clusters: number[][] = []
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || visited[i]) continue
    const cluster: number[] = []
    const stack = [i]
    visited[i] = true
    while (stack.length) {
      const cur = stack.pop() as number
      cluster.push(cur)
      const cx = cur % cols
      const cy = Math.floor(cur / cols)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue
          const ni = ny * cols + nx
          if (mask[ni] && !visited[ni]) {
            visited[ni] = true
            stack.push(ni)
          }
        }
      }
    }
    clusters.push(cluster)
  }
  return clusters
}
