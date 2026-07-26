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

/** 数值分位数（q ∈ [0,1]），线性插值 */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * q))
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/** Andrew 单调链凸包，返回逆时针顶点（不重复首尾） */
export function convexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length <= 2) return [...points]
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Array<{ x: number; y: number }> = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Array<{ x: number; y: number }> = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** 旋转卡壳：求点集的最小面积外接矩形 */
export function minAreaRect(points: Array<{ x: number; y: number }>): {
  center: { x: number; y: number }
  /** 长边（米） */
  length: number
  /** 短边（米） */
  width: number
  /** 长轴方位角（度，0=北/+y，顺时针） */
  orientationDeg: number
  /** 矩形四角（局部坐标，逆时针） */
  corners: Array<{ x: number; y: number }>
} {
  const empty = { center: { x: 0, y: 0 }, length: 0, width: 0, orientationDeg: 0, corners: [] as Array<{ x: number; y: number }> }
  if (points.length === 0) return empty
  if (points.length === 1) return { ...empty, center: { ...points[0] } }

  const hull = convexHull(points)
  let best = { area: Infinity, angle: 0, minU: 0, maxU: 0, minV: 0, maxV: 0 }

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const angle = Math.atan2(b.y - a.y, b.x - a.x) // 边方向角
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const p of hull) {
      const u = p.x * cos + p.y * sin
      const v = -p.x * sin + p.y * cos
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const area = (maxU - minU) * (maxV - minV)
    if (area < best.area) best = { area, angle, minU, maxU, minV, maxV }
  }

  const cos = Math.cos(best.angle)
  const sin = Math.sin(best.angle)
  const toXY = (u: number, v: number) => ({ x: u * cos - v * sin, y: u * sin + v * cos })
  const corners = [
    toXY(best.minU, best.minV),
    toXY(best.maxU, best.minV),
    toXY(best.maxU, best.maxV),
    toXY(best.minU, best.maxV)
  ]
  const cx = (best.minU + best.maxU) / 2
  const cy = (best.minV + best.maxV) / 2
  const center = toXY(cx, cy)

  const sideU = best.maxU - best.minU
  const sideV = best.maxV - best.minV
  // 长轴方向角：若 sideU 为长边则方向为 best.angle，否则垂直
  const majorAngle = sideU >= sideV ? best.angle : best.angle + Math.PI / 2
  let az = 90 - toDegrees(majorAngle)
  az = ((az % 180) + 180) % 180
  return {
    center,
    length: Math.max(sideU, sideV),
    width: Math.min(sideU, sideV),
    orientationDeg: Math.round(az * 10) / 10,
    corners
  }
}

/** 局部平面多边形周长（米） */
export function localPerimeter(points: Array<{ x: number; y: number }>): number {
  let p = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    p += Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y)
  }
  return p
}

/** 局部平面多边形面积（米²，Shoelace） */
export function localPolygonArea(points: Array<{ x: number; y: number }>): number {
  let s = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    s += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return Math.abs(s / 2)
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
