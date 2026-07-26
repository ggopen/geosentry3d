/**
 * Agent 4: Annotation Agent（空间标注规格生成）
 * Red=违规 / Yellow=警告 / Green=合规
 */
import type { AnnotationSpec, ComplianceResult, SpatialObject } from '../core/types'

const TYPE_LABEL: Record<string, string> = {
  door: '门',
  window: '窗',
  building: '建筑',
  fence: '围栏',
  pole: '杆体',
  road: '道路',
  tree: '树木',
  ground: '地面',
  unknown: '未知'
}

export class AnnotationAgent {
  buildSpec(obj: SpatialObject, compliance: ComplianceResult): AnnotationSpec {
    const color = compliance.status === 'FAIL' ? 'red' : compliance.status === 'WARN' ? 'yellow' : 'green'
    const statusText = compliance.status === 'FAIL' ? '违规' : compliance.status === 'WARN' ? '警告' : '合规'
    const dims = `${obj.bbox.length.toFixed(2)}×${obj.bbox.width.toFixed(2)}×${obj.bbox.height.toFixed(2)}m`
    return {
      objectId: obj.id,
      label: `${TYPE_LABEL[obj.type] ?? obj.type} ${obj.id.split('-').pop()} | ${statusText} | ${dims}`,
      color
    }
  }
}
