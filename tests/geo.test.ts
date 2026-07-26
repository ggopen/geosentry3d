import { describe, expect, it } from 'vitest'
import {
  angleBetween,
  clusterGrid,
  haversineDistance,
  pca2d,
  polygonArea,
  polylineLength,
  toLocalXY,
  verticalHeight
} from '../src/utils/geo'

describe('geo 工具函数', () => {
  it('haversineDistance: 赤道上 1 经度 ≈ 111.195 km', () => {
    const d = haversineDistance(0, 0, 1, 0)
    expect(d).toBeGreaterThan(111000)
    expect(d).toBeLessThan(111400)
  })

  it('polygonArea: 约 100m x 100m 的正方形', () => {
    // 纬度 40 附近，约 0.001 纬度 ≈ 111.32 m
    const area = polygonArea([
      { lon: 116, lat: 40 },
      { lon: 116.001166, lat: 40 },
      { lon: 116.001166, lat: 40.0009 },
      { lon: 116, lat: 40.0009 }
    ])
    expect(area).toBeGreaterThan(8000)
    expect(area).toBeLessThan(12000)
  })

  it('polygonArea: 少于 3 点面积为 0', () => {
    expect(polygonArea([{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }])).toBe(0)
  })

  it('polylineLength: 两点折线等于距离', () => {
    const l = polylineLength([{ lon: 0, lat: 0 }, { lon: 1, lat: 0 }])
    expect(Math.abs(l - haversineDistance(0, 0, 1, 0))).toBeLessThan(0.01)
  })

  it('angleBetween: 直角为 90°', () => {
    const a = angleBetween({ lon: 1, lat: 0 }, { lon: 0, lat: 0 }, { lon: 0, lat: 1 })
    expect(a).toBeCloseTo(90, 0)
  })

  it('verticalHeight: 取绝对值', () => {
    expect(verticalHeight(10, 25)).toBe(15)
    expect(verticalHeight(25, 10)).toBe(15)
  })

  it('pca2d: 沿东西方向拉伸的点云主轴接近 90°', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i * 2, y: (i % 3) * 0.2 }))
    const r = pca2d(pts)
    expect(r.orientationDeg).toBeGreaterThan(80)
    expect(r.orientationDeg).toBeLessThan(100)
    expect(r.lengthAlongMajor).toBeGreaterThan(35)
    expect(r.lengthAlongMinor).toBeLessThan(2)
  })

  it('toLocalXY: 相对原点的东向偏移', () => {
    const p = toLocalXY({ lon: 116.001, lat: 40 }, { lon: 116, lat: 40 })
    expect(p.x).toBeGreaterThan(80)
    expect(Math.abs(p.y)).toBeLessThan(1)
  })

  it('clusterGrid: 两个分离的簇', () => {
    // 5x5 网格，两个角各一个簇
    const mask = new Array(25).fill(false)
    mask[0] = true
    mask[1] = true // 左上角簇（2 格）
    mask[24] = true // 右下角单格
    const clusters = clusterGrid(mask, 5, 5)
    expect(clusters.length).toBe(2)
    expect(clusters.map((c) => c.length).sort()).toEqual([1, 2])
  })
})
