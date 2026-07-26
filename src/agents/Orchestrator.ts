/**
 * Multi-Agent 编排器（对应文档第九节完整流程）
 *
 * Scene → Recognition Agent → Measurement Agent → Compliance Agent
 *       → Annotation Agent → Report Agent
 *
 * 最高约束：Never guess geometry. Always call measurement tools.
 * —— 所有数值均来自采样得到的 BoundingInfo，经 MeasurementEngine 计算。
 */
import type { BoundingInfo, InspectionResult, ObjectType, SpatialObject } from '../core/types'
import { genId } from '../utils/number'
import { AnnotationAgent } from './AnnotationAgent'
import { ComplianceAgent } from './ComplianceAgent'
import { MeasurementAgent } from './MeasurementAgent'
import { RecognitionAgent } from './RecognitionAgent'

export class AnalysisOrchestrator {
  private recognition = new RecognitionAgent()
  private measurement = new MeasurementAgent()
  private compliance = new ComplianceAgent()
  private annotation = new AnnotationAgent()

  /** 对单个采样包围盒执行完整分析流水线 */
  analyze(bbox: BoundingInfo, counts: Partial<Record<ObjectType, number>> = {}): InspectionResult {
    // 1. Recognition
    const rec = this.recognition.classify(bbox)
    const obj: SpatialObject = {
      id: genId('obj'),
      type: rec.type,
      confidence: rec.confidence,
      bbox,
      properties: {
        orientationDeg: bbox.orientationDeg,
        groundHeight: bbox.groundHeight
      }
    }
    // 2. Measurement（自动选择测量方法，数值全部来自真实几何）
    const measurements = this.measurement.measure(obj)
    // 3. Compliance
    const complianceResult = this.compliance.inspect(obj, measurements, counts)
    // 4. Annotation
    const spec = this.annotation.buildSpec(obj, complianceResult)
    // 5. 建议
    const recommendations = this.buildRecommendations(complianceResult.violations)

    return {
      objectId: obj.id,
      objectType: obj.type,
      confidence: obj.confidence,
      measurements,
      compliance: complianceResult,
      annotations: [spec],
      recommendations,
      bbox
    }
  }

  private buildRecommendations(violations: InspectionResult['compliance']['violations']): string[] {
    return violations.map((v) =>
      v.severity === 'error'
        ? `【必须整改】${v.rule}：实测 ${v.actual}，要求 ${v.expected}`
        : `【建议整改】${v.rule}：实测 ${v.actual}，要求 ${v.expected}`
    )
  }
}
