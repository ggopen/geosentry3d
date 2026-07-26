/**
 * Agent 2: Measurement Agent（测量引擎代理）
 *
 * 按文档第七节"自动测量"规则选择测量方法：
 *   Door → width, height        Road → width, length
 *   Building → height, volume   Tree → height
 *   Fence → length, height
 *
 * 所有数值均来自采样几何（BoundingInfo），绝不臆造。
 * v1.1：优先使用真实边界面积（凹包多边形）计算 area / volume。
 */
import type { Measurement, MeasurementKind, ObjectType, SpatialObject } from '../core/types'
import { round3 } from '../utils/number'

/** 对象类型 → 需要执行的测量项（文档第七节） */
const MEASUREMENT_PLAN: Record<ObjectType, MeasurementKind[]> = {
  door: ['width', 'height'],
  window: ['width', 'height'],
  building: ['height', 'volume', 'area'],
  fence: ['length', 'height'],
  pole: ['height', 'clearance'],
  road: ['width', 'length'],
  tree: ['height'],
  ground: ['area'],
  unknown: ['length', 'width', 'height', 'area']
}

export class MeasurementAgent {
  /** 返回某对象类型应执行的测量项 */
  plan(type: ObjectType): MeasurementKind[] {
    return MEASUREMENT_PLAN[type] ?? MEASUREMENT_PLAN.unknown
  }

  /** 基于真实几何执行测量 */
  measure(obj: SpatialObject): Measurement[] {
    const kinds = this.plan(obj.type)
    const results: Measurement[] = []
    for (const kind of kinds) {
      const m = this.measureOne(kind, obj)
      if (m) results.push(m)
    }
    return results
  }

  private measureOne(kind: MeasurementKind, obj: SpatialObject): Measurement | null {
    const { bbox } = obj
    switch (kind) {
      case 'width':
        return { kind, value: round3(bbox.width), unit: 'm' }
      case 'length':
        return { kind, value: round3(bbox.length), unit: 'm' }
      case 'height':
        return { kind, value: round3(bbox.height), unit: 'm' }
      case 'area': {
        // v1.1：真实边界面积优先
        const area = bbox.footprintArea ?? bbox.length * bbox.width
        return { kind, value: round3(area), unit: 'm²' }
      }
      case 'volume': {
        const area = bbox.footprintArea ?? bbox.length * bbox.width
        return { kind, value: round3(area * bbox.height), unit: 'm³' }
      }
      case 'clearance':
        // 净空 = 对象底部到最高点的可用竖向空间（近似为对象高度）
        return { kind, value: round3(bbox.center.height - bbox.groundHeight), unit: 'm' }
      case 'distance':
        // 对象尺度距离 = 对角线
        return { kind, value: round3(Math.hypot(bbox.length, bbox.width)), unit: 'm' }
      case 'angle':
        return { kind, value: round3(bbox.orientationDeg), unit: '°' }
      default:
        return null
    }
  }
}
