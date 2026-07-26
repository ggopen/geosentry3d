import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES, RuleEngine, evaluate, parse, tokenize, type EvalContext } from '../src/rules/RuleEngine'
import type { Measurement, SpatialObject } from '../src/core/types'

const ctx = (fields: Record<string, number>, type = 'door'): EvalContext => ({
  objectType: type as EvalContext['objectType'],
  fields,
  counts: { window: 5 }
})

function evalDsl(src: string, c: EvalContext): unknown {
  return evaluate(parse(tokenize(src)), c)
}

describe('规则引擎 DSL', () => {
  it('解析简单比较 height > 2', () => {
    expect(evalDsl('height > 2', ctx({ height: 3 }))).toBe(true)
    expect(evalDsl('height > 2', ctx({ height: 1 }))).toBe(false)
  })

  it('类型限定字段 door.width >= 0.9', () => {
    expect(evalDsl('door.width >= 0.9', ctx({ width: 0.83 }))).toBe(false)
    expect(evalDsl('door.width >= 0.9', ctx({ width: 0.95 }))).toBe(true)
  })

  it('类型不匹配时条件不成立', () => {
    expect(evalDsl('door.width >= 0.9', ctx({ width: 5 }, 'building'))).toBe(false)
  })

  it('逻辑与/或', () => {
    expect(evalDsl('width >= 0.9 AND height >= 2.0', ctx({ width: 1, height: 2.1 }))).toBe(true)
    expect(evalDsl('width >= 0.9 AND height >= 2.0', ctx({ width: 1, height: 1.8 }))).toBe(false)
    expect(evalDsl('width < 0.5 OR height > 2', ctx({ width: 1, height: 2.5 }))).toBe(true)
  })

  it('count 函数结合场景上下文', () => {
    expect(evalDsl('count(window) > 4', ctx({}))).toBe(true)
    expect(evalDsl('count(window) > 6', ctx({}))).toBe(false)
  })

  it('IF ... THEN 推导', () => {
    const ast = parse(tokenize('IF building.height > 30 THEN fireLevel = Level1'))
    expect(ast.kind).toBe('if')
    const c = ctx({ height: 45 }, 'building')
    if (ast.kind === 'if') {
      expect(evaluate(ast.cond, c)).toBe(true)
      expect(evaluate(ast.value, c)).toBe('Level1')
    }
  })

  it('fence.height < 2.2 文档示例', () => {
    expect(evalDsl('fence.height < 2.2', ctx({ height: 1.8 }, 'fence'))).toBe(true)
    expect(evalDsl('fence.height < 2.2', ctx({ height: 2.5 }, 'fence'))).toBe(false)
  })

  it('语法错误能被捕获', () => {
    expect(() => parse(tokenize('width >='))).toThrow()
    expect(() => parse(tokenize('&& width > 1'))).toThrow()
  })
})

describe('RuleEngine.inspect 合规审查', () => {
  const makeObj = (type: SpatialObject['type']): SpatialObject => ({
    id: 'obj-1',
    type,
    confidence: 0.97,
    bbox: {
      center: { lon: 116, lat: 40, height: 2 },
      width: 0.83,
      length: 0.83,
      height: 2.03,
      orientationDeg: 0,
      groundHeight: 0
    },
    properties: {}
  })

  it('文档示例：宽 0.83m 的门 → FAIL', () => {
    const engine = new RuleEngine(DEFAULT_RULES)
    const measurements: Measurement[] = [
      { kind: 'width', value: 0.83, unit: 'm' },
      { kind: 'height', value: 2.03, unit: 'm' }
    ]
    const result = engine.inspect(makeObj('door'), measurements)
    expect(result.status).toBe('FAIL')
    expect(result.violations[0].rule).toBe('Door Width')
    expect(result.violations[0].actual).toBe(0.83)
    expect(result.violations[0].expected).toContain('0.9')
  })

  it('合规的门 → PASS', () => {
    const engine = new RuleEngine(DEFAULT_RULES)
    const measurements: Measurement[] = [
      { kind: 'width', value: 1.0, unit: 'm' },
      { kind: 'height', value: 2.1, unit: 'm' }
    ]
    const result = engine.inspect(makeObj('door'), measurements)
    expect(result.status).toBe('PASS')
    expect(result.violations.length).toBe(0)
  })

  it('高层建筑触发消防等级推导', () => {
    const engine = new RuleEngine(DEFAULT_RULES)
    const measurements: Measurement[] = [
      { kind: 'height', value: 45, unit: 'm' },
      { kind: 'volume', value: 1000, unit: 'm³' },
      { kind: 'area', value: 100, unit: 'm²' }
    ]
    const result = engine.inspect(makeObj('building'), measurements)
    expect(result.derived.fireLevel).toBe('Level1')
  })

  it('规则仅适用于指定类型', () => {
    const engine = new RuleEngine(DEFAULT_RULES)
    const measurements: Measurement[] = [
      { kind: 'length', value: 5, unit: 'm' },
      { kind: 'height', value: 1.0, unit: 'm' }
    ]
    const result = engine.inspect(makeObj('fence'), measurements)
    // fence 不应被 Door Width 规则约束
    expect(result.violations.every((v) => !v.rule.startsWith('Door'))).toBe(true)
  })

  it('内置规则集全部通过语法校验', () => {
    const engine = new RuleEngine(DEFAULT_RULES)
    expect(engine.validate()).toEqual([])
  })
})
