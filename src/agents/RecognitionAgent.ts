/**
 * Agent 1: Object Recognition Agent（对象识别）
 *
 * 基于文档第六节的几何启发式规则，对采样得到的 OBB 进行分类：
 * - Door:   height 1.8~2.5m, width 0.6~1.5m, vertical
 * - Fence:  height 1~3m, length > 2m, thin geometry
 * - Pole:   height > 3m, width < 0.5m
 * 另扩展 building / road / tree / window / ground 的工程启发式。
 */
import type { BoundingInfo, ObjectType } from '../core/types'

export interface RecognitionResult {
  type: ObjectType
  confidence: number
}

export class RecognitionAgent {
  classify(bbox: BoundingInfo): RecognitionResult {
    const { width, length, height } = bbox
    const thin = Math.min(width, length)
    const long = Math.max(width, length)

    // Pole: 高而细
    if (height > 3 && long < 0.5) {
      return { type: 'pole', confidence: 0.95 }
    }
    // Door: 典型门洞尺寸
    if (height >= 1.8 && height <= 2.5 && long >= 0.6 && long <= 1.5) {
      return { type: 'door', confidence: 0.97 }
    }
    // Window: 较小的近方形面片
    if (height >= 0.5 && height < 1.8 && long >= 0.5 && long <= 2 && thin >= 0.4) {
      return { type: 'window', confidence: 0.85 }
    }
    // Fence: 矮、长、薄
    if (height >= 1 && height <= 3 && long > 2 && thin < 0.4) {
      return { type: 'fence', confidence: 0.92 }
    }
    // Road: 贴地且延展
    if (height < 0.3 && long > 2) {
      return { type: 'road', confidence: 0.8 }
    }
    // Building: 大尺度
    if (height > 3 && long > 3) {
      return { type: 'building', confidence: 0.9 }
    }
    // Tree: 中等高度、紧凑冠幅
    if (height >= 2 && height <= 20 && long >= 0.5 && long <= 8 && thin / long > 0.4) {
      return { type: 'tree', confidence: 0.7 }
    }
    if (height < 0.3) {
      return { type: 'ground', confidence: 0.6 }
    }
    return { type: 'unknown', confidence: 0.3 }
  }
}
