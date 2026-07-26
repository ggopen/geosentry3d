import { describe, expect, it } from 'vitest'
import { Segmenter, type SamplePoint } from '../src/segmentation/Segmenter'
import { convexHull, localPolygonArea, minAreaRect, percentile } from '../src/utils/geo'

/** 构造一个以 (cx,cy) 为中心的矩形点云（带高度） */
function rectPoints(cx: number, cy: number, w: number, l: number, h: number, step = 0.3): SamplePoint[] {
  const pts: SamplePoint[] = []
  for (let x = -l / 2; x <= l / 2; x += step) {
    for (let y = -w / 2; y <= w / 2; y += step) {
      pts.push({ x: cx + x, y: cy + y, h: 10 + h, lon: 116 + (cx + x) * 1e-5, lat: 40 + (cy + y) * 1e-5 })
    }
  }
  return pts
}

/** L 形点云（凹形，检验凹包） */
function lShapePoints(): SamplePoint[] {
  const pts: SamplePoint[] = []
  for (let x = 0; x <= 6; x += 0.3) for (let y = 0; y <= 2; y += 0.3) pts.push({ x, y, h: 15, lon: 116 + x * 1e-5, lat: 40 + y * 1e-5 })
  for (let x = 0; x <= 2; x += 0.3) for (let y = 2; y <= 6; y += 0.3) pts.push({ x, y, h: 15, lon: 116 + x * 1e-5, lat: 40 + y * 1e-5 })
  return pts
}

describe('几何工具：凸包 / 最小面积矩形 / 分位数', () => {
  it('convexHull 面积 ≥ 点集范围且顶点逆时针', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }, { x: 2, y: 1.5 }
    ]
    const hull = convexHull(pts)
    expect(hull.length).toBe(4) // 内点被剔除
    expect(localPolygonArea(hull)).toBeCloseTo(12, 5)
  })

  it('minAreaRect 恢复旋转矩形的尺寸与方向', () => {
    // 构造 10×2 矩形，旋转 30°
    const rad = (30 * Math.PI) / 180
    const pts: Array<{ x: number; y: number }> = []
    for (let u = -5; u <= 5; u += 0.25) {
      for (let v = -1; v <= 1; v += 0.25) {
        pts.push({ x: u * Math.cos(rad) - v * Math.sin(rad), y: u * Math.sin(rad) + v * Math.cos(rad) })
      }
    }
    const rect = minAreaRect(pts)
    expect(rect.length).toBeCloseTo(10, 0)
    expect(rect.width).toBeCloseTo(2, 0)
    // 方位角 = 90-30=60（或等价方向）
    expect(Math.min(Math.abs(rect.orientationDeg - 60), Math.abs(rect.orientationDeg - 240))).toBeLessThan(1.5)
  })

  it('percentile 计算正确', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1)).toBeCloseTo(1.9, 5)
    expect(percentile([5], 0.5)).toBe(5)
  })
})

describe('Segmenter：DBSCAN 分割 + 凹包边界', () => {
  const segmenter = new Segmenter()

  it('两个相邻对象被分成两簇（旧版会合并为一个盒子）', () => {
    const pts = [...rectPoints(0, 0, 2, 4, 5), ...rectPoints(10, 0, 3, 3, 8)]
    const segments = segmenter.segment(pts, { eps: 0.6, minPts: 3, ground: 10, minArea: 0.5 })
    expect(segments.length).toBe(2)
    expect(segments[0].area).toBeGreaterThan(segments[1].area)
  })

  it('矩形对象的测量尺寸准确（长×宽×高）', () => {
    const pts = rectPoints(0, 0, 3, 8, 6)
    const segments = segmenter.segment(pts, { eps: 0.6, minPts: 3, ground: 10, minArea: 0.5 })
    expect(segments.length).toBe(1)
    const seg = segments[0]
    expect(seg.rect.length).toBeCloseTo(8, 0)
    expect(seg.rect.width).toBeCloseTo(3, 0)
    expect(seg.height).toBeCloseTo(6, 0)
    // 面积用经纬度换算（lon/lat 步长 1e-5°，约 1.1m/1.1m·cos40°）
    expect(seg.area).toBeGreaterThan(8 * 3 * 0.6)
  })

  it('L 形对象提取出凹边界（凹包面积显著小于外接矩形）', () => {
    const pts = lShapePoints()
    const segments = segmenter.segment(pts, { eps: 0.6, minPts: 3, ground: 10, minArea: 0.5 })
    expect(segments.length).toBe(1)
    const seg = segments[0]
    const localArea = localPolygonArea(seg.footprintLocal)
    const rectArea = seg.rect.length * seg.rect.width
    // L 形真实面积 = 6*2 + 2*4 = 20；外接矩形 = 36
    // 凹包沿点集边界走，允许 ~10% 的边界裁剪误差
    expect(localArea).toBeGreaterThan(16)
    expect(localArea).toBeLessThan(24)
    expect(localArea).toBeLessThan(rectArea * 0.75)
    expect(seg.features.solidity).toBeLessThan(0.8)
  })

  it('稀疏噪声点不产生对象（minPts 过滤）', () => {
    const pts: SamplePoint[] = [
      { x: 0, y: 0, h: 12, lon: 116, lat: 40 },
      { x: 5, y: 5, h: 12, lon: 116.00005, lat: 40.00005 }
    ]
    const segments = segmenter.segment(pts, { eps: 0.6, minPts: 3, ground: 10, minArea: 0.5 })
    expect(segments.length).toBe(0)
  })

  it('形状特征：细长对象长宽比大、圆形度小', () => {
    const fencePts = rectPoints(0, 0, 0.3, 12, 1.5, 0.15)
    const segments = segmenter.segment(fencePts, { eps: 0.35, minPts: 3, ground: 10, minArea: 0.2 })
    expect(segments.length).toBe(1)
    expect(segments[0].features.aspectRatio).toBeGreaterThan(10)
    expect(segments[0].features.circularity).toBeLessThan(0.5)
  })
})

describe('RecognitionAgent：形状特征增强分类', () => {
  it('密实度低的中等对象 → tree', async () => {
    const { RecognitionAgent } = await import('../src/agents/RecognitionAgent')
    const agent = new RecognitionAgent()
    const r = agent.classify({
      center: { lon: 116, lat: 40, height: 8 },
      width: 4, length: 5, height: 8, orientationDeg: 0, groundHeight: 0,
      footprintArea: 15,
      shapeFeatures: { aspectRatio: 1.3, circularity: 0.55, solidity: 0.6 }
    })
    expect(r.type).toBe('tree')
  })

  it('规则大边界 + 高 → building（高置信度）', async () => {
    const { RecognitionAgent } = await import('../src/agents/RecognitionAgent')
    const agent = new RecognitionAgent()
    const r = agent.classify({
      center: { lon: 116, lat: 40, height: 12 },
      width: 15, length: 20, height: 12, orientationDeg: 0, groundHeight: 0,
      footprintArea: 280,
      shapeFeatures: { aspectRatio: 1.4, circularity: 0.8, solidity: 0.93 }
    })
    expect(r.type).toBe('building')
    expect(r.confidence).toBeGreaterThanOrEqual(0.9)
  })
})
