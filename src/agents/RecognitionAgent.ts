/**
 * Agent 1: Object Recognition Agent（对象识别）
 *
 * 基于文档第六节的几何启发式规则分类：
 * - Door:   height 1.8~2.5m, width 0.6~1.5m, vertical
 * - Fence:  height 1~3m, length > 2m, thin geometry
 * - Pole:   height > 3m, width < 0.5m
 *
 * v1.1：引入真实形状特征（footprint 面积 / 长宽比 / 圆形度 / 密实度），
 * 相比旧版单纯 OBB 尺寸判断，对杆体、围栏、树木的区分更可靠。
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
    const f = bbox.shapeFeatures
    const footprintArea = bbox.footprintArea ?? width * length

    // Pole: 高而细；有形状特征时按"小而高的足印"判断更准确
    if (height > 3 && (long < 0.5 || (f !== undefined && footprintArea < 0.6))) {
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
    // Fence: 矮、长、薄；有特征时看长宽比
    if (height >= 1 && height <= 3 && ((long > 2 && thin < 0.4) || (f !== undefined && f.aspectRatio > 5 && height <= 3))) {
      return { type: 'fence', confidence: 0.92 }
    }
    // Road: 贴地且延展
    if (height < 0.3 && long > 2) {
      return { type: 'road', confidence: 0.8 }
    }
    // Tree: 中等高度、冠幅不规则（密实度低）
    if (
      height >= 2 && height <= 20 && footprintArea >= 0.5 && footprintArea <= 80 &&
      f !== undefined && f.solidity < 0.75
    ) {
      return { type: 'tree', confidence: 0.78 }
    }
    // Building: 大尺度、边界规则饱满
    if (height > 3 && (long > 3 || footprintArea > 9)) {
      return { type: 'building', confidence: f !== undefined && f.solidity >= 0.75 ? 0.93 : 0.85 }
    }
    // Tree（无特征回退）
    if (height >= 2 && height <= 20 && long >= 0.5 && long <= 8 && thin / long > 0.4) {
      return { type: 'tree', confidence: 0.7 }
    }
    if (height < 0.3) {
      return { type: 'ground', confidence: 0.6 }
    }
    return { type: 'unknown', confidence: 0.3 }
  }
}
