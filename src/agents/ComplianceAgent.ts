/**
 * Agent 3: Compliance Agent（合规审查）
 * 包装 RuleEngine，面向对象输出合规结论。
 */
import type { ComplianceResult, Measurement, ObjectType, SpatialObject } from '../core/types'
import { DEFAULT_RULES, RuleEngine } from '../rules/RuleEngine'

export class ComplianceAgent {
  private engine: RuleEngine

  constructor(engine?: RuleEngine) {
    this.engine = engine ?? new RuleEngine(DEFAULT_RULES)
  }

  get ruleEngine(): RuleEngine {
    return this.engine
  }

  inspect(
    obj: SpatialObject,
    measurements: Measurement[],
    counts: Partial<Record<ObjectType, number>>
  ): ComplianceResult {
    return this.engine.inspect(obj, measurements, counts)
  }
}
