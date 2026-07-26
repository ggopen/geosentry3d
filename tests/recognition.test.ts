import { describe, expect, it } from 'vitest'
import { RecognitionAgent } from '../src/agents/RecognitionAgent'
import { AnalysisOrchestrator } from '../src/agents/Orchestrator'
import type { BoundingInfo } from '../src/core/types'

function makeBBox(width: number, length: number, height: number): BoundingInfo {
  return {
    center: { lon: 116, lat: 40, height: height },
    width,
    length,
    height,
    orientationDeg: 0,
    groundHeight: 0
  }
}

describe('RecognitionAgent（文档第六节启发式）', () => {
  const agent = new RecognitionAgent()

  it('典型门：高 2.03 / 宽 0.83 → door, 高置信度', () => {
    const r = agent.classify(makeBBox(0.83, 0.83, 2.03))
    expect(r.type).toBe('door')
    expect(r.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('高而细（h>3, 宽<0.5）→ pole', () => {
    expect(agent.classify(makeBBox(0.3, 0.3, 6)).type).toBe('pole')
  })

  it('矮长薄（h 1~3, 长>2, 薄）→ fence', () => {
    expect(agent.classify(makeBBox(0.2, 5, 1.5)).type).toBe('fence')
  })

  it('贴地延展 → road', () => {
    expect(agent.classify(makeBBox(3, 10, 0.1)).type).toBe('road')
  })

  it('大尺度 → building', () => {
    expect(agent.classify(makeBBox(12, 20, 25)).type).toBe('building')
  })
})

describe('AnalysisOrchestrator 多Agent流水线', () => {
  it('完整输出 schema：objectId/objectType/measurements/compliance/annotations/recommendations', () => {
    const orch = new AnalysisOrchestrator()
    const result = orch.analyze(makeBBox(0.83, 0.83, 2.03))
    expect(result.objectId).toBeTruthy()
    expect(result.objectType).toBe('door')
    expect(result.measurements.length).toBe(2)
    expect(['PASS', 'FAIL', 'WARN']).toContain(result.compliance.status)
    expect(result.compliance.status).toBe('FAIL') // 宽 0.83 < 0.9
    expect(result.annotations[0].color).toBe('red')
    expect(result.recommendations.length).toBeGreaterThan(0)
  })

  it('合规对象 → 绿色标注', () => {
    const orch = new AnalysisOrchestrator()
    const result = orch.analyze(makeBBox(1.0, 1.0, 2.1))
    expect(result.objectType).toBe('door')
    expect(result.compliance.status).toBe('PASS')
    expect(result.annotations[0].color).toBe('green')
  })
})
