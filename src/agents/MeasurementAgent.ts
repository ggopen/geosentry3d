/**
 * Agent 2: Measurement Agent（自动测量）
 * 根据识别结果自动选择测量方法并调用 Measurement Engine。
 */
import type { Measurement, SpatialObject } from '../core/types'
import { MeasurementEngine } from '../measurement/MeasurementEngine'

export class MeasurementAgent {
  private engine: MeasurementEngine

  constructor(engine?: MeasurementEngine) {
    this.engine = engine ?? new MeasurementEngine()
  }

  measure(obj: SpatialObject): Measurement[] {
    return this.engine.measure(obj.bbox, obj.type)
  }
}
