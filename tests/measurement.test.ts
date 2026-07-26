import { describe, expect, it } from 'vitest'
import { MEASUREMENT_PLAN, MeasurementEngine } from '../src/measurement/MeasurementEngine'
import type { BoundingInfo } from '../src/core/types'

const bbox: BoundingInfo = {
  center: { lon: 116, lat: 40, height: 3 },
  width: 0.83,
  length: 2.5,
  height: 2.03,
  orientationDeg: 45,
  groundHeight: 0.5
}

describe('MeasurementEngine', () => {
  const engine = new MeasurementEngine()

  it('门自动选择 width + height（文档第七节）', () => {
    expect(engine.selectMeasurements('door')).toEqual(['width', 'height'])
  })

  it('建筑自动选择 height + volume + area', () => {
    expect(engine.selectMeasurements('building')).toEqual(['height', 'volume', 'area'])
  })

  it('测量值全部来自输入几何，不臆造', () => {
    const ms = engine.measure(bbox, 'door')
    const width = ms.find((m) => m.kind === 'width')
    const height = ms.find((m) => m.kind === 'height')
    expect(width?.value).toBe(0.83)
    expect(height?.value).toBe(2.03)
  })

  it('面积 = 长 × 宽', () => {
    const m = engine.measureOne('area', bbox)
    expect(m.value).toBeCloseTo(2.5 * 0.83, 3)
    expect(m.unit).toBe('m²')
  })

  it('体积 = 长 × 宽 × 高', () => {
    const m = engine.measureOne('volume', bbox)
    expect(m.value).toBeCloseTo(2.5 * 0.83 * 2.03, 3)
    expect(m.unit).toBe('m³')
  })

  it('净空 = 中心高 - 地面基准', () => {
    const m = engine.measureOne('clearance', bbox)
    expect(m.value).toBe(2.5)
  })

  it('角度 = OBB 方位角', () => {
    const m = engine.measureOne('angle', bbox)
    expect(m.value).toBe(45)
  })

  it('所有对象类型都有测量计划', () => {
    const types = Object.keys(MEASUREMENT_PLAN)
    for (const t of types) {
      expect(MEASUREMENT_PLAN[t as keyof typeof MEASUREMENT_PLAN].length).toBeGreaterThan(0)
    }
  })
})
