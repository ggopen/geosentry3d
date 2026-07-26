/**
 * Agent 3 的一部分：Spatial Rule Engine（空间规则引擎）
 *
 * 支持文档第八节的 DSL：
 *   height > 2
 *   distance(a,b) > 5        （对象尺度距离）
 *   area > 20
 *   count(window) > 4        （结合场景上下文）
 *   door.width > 0.9
 *   fence.height < 2.2
 *   IF building.height > 30 THEN fireLevel = Level1
 *   逻辑组合：cond1 AND cond2 / cond1 OR cond2 （也支持 && / ||）
 *
 * 设计：正则分词 + 递归下降解析，输出 AST 后以上下文求值，规则与求值分离。
 */
import type { ComplianceResult, Measurement, ObjectType, Rule, SpatialObject, Violation } from '../core/types'

/* ---------------- 分词 ---------------- */

type TokenType = 'number' | 'string' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'if' | 'then' | 'and' | 'or' | 'assign'

interface Token {
  type: TokenType
  value: string
}

const TOKEN_RE =
  /\s*(>=|<=|!=|==|&&|\|\||[><=(),]|\bIF\b|\bTHEN\b|\bAND\b|\bOR\b|\bif\b|\bthen\b|\band\b|\bor\b|-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_.]*)/y

export function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    if (/\s/.test(src[i])) {
      i++
      continue
    }
    TOKEN_RE.lastIndex = i
    const m = TOKEN_RE.exec(src)
    if (!m || m.index !== i) throw new Error(`DSL 语法错误，无法解析位置 ${i}: "${src.slice(i)}"`)
    i = TOKEN_RE.lastIndex
    const raw = m[1]
    let type: TokenType
    if (/^-?\d/.test(raw)) type = 'number'
    else if (/^(>=|<=|!=|==|>|<)$/.test(raw)) type = 'op'
    else if (raw === '(') type = 'lparen'
    else if (raw === ')') type = 'rparen'
    else if (raw === ',') type = 'comma'
    else if (/^(IF|if)$/.test(raw)) type = 'if'
    else if (/^(THEN|then)$/.test(raw)) type = 'then'
    else if (/^(AND|and|&&)$/.test(raw)) type = 'and'
    else if (/^(OR|or|\|\|)$/.test(raw)) type = 'or'
    else if (raw === '=') type = 'assign'
    else type = 'ident'
    tokens.push({ type, value: raw })
  }
  return tokens
}

/* ---------------- AST ---------------- */

export type AstNode =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'field'; path: string[] }
  | { kind: 'call'; name: string; args: AstNode[] }
  | { kind: 'cmp'; op: string; left: AstNode; right: AstNode }
  | { kind: 'and'; left: AstNode; right: AstNode }
  | { kind: 'or'; left: AstNode; right: AstNode }
  | { kind: 'if'; cond: AstNode; target: string; value: AstNode }

export function parse(tokens: Token[]): AstNode {
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const next = (): Token => {
    const t = tokens[pos]
    if (!t) throw new Error('DSL 意外结束')
    pos++
    return t
  }
  const expect = (type: TokenType): Token => {
    const t = next()
    if (t.type !== type) throw new Error(`DSL 语法错误：期望 ${type}，得到 ${t.type}(${t.value})`)
    return t
  }

  function parsePrimary(): AstNode {
    const t = next()
    if (t.type === 'number') return { kind: 'num', value: parseFloat(t.value) }
    if (t.type === 'lparen') {
      const e = parseOr()
      expect('rparen')
      return e
    }
    if (t.type === 'ident') {
      const p = peek()
      if (p && p.type === 'lparen') {
        next() // consume (
        const args: AstNode[] = []
        if (peek()?.type !== 'rparen') {
          args.push(parseOr())
          while (peek()?.type === 'comma') {
            next()
            args.push(parseOr())
          }
        }
        expect('rparen')
        return { kind: 'call', name: t.value, args }
      }
      return { kind: 'field', path: t.value.split('.') }
    }
    throw new Error(`DSL 语法错误：意外的 ${t.type}(${t.value})`)
  }

  function parseCmp(): AstNode {
    const left = parsePrimary()
    const p = peek()
    if (p && p.type === 'op') {
      next()
      const right = parsePrimary()
      return { kind: 'cmp', op: p.value, left, right }
    }
    return left
  }

  function parseAnd(): AstNode {
    let left = parseCmp()
    while (peek()?.type === 'and') {
      next()
      left = { kind: 'and', left, right: parseCmp() }
    }
    return left
  }

  function parseOr(): AstNode {
    let left = parseAnd()
    while (peek()?.type === 'or') {
      next()
      left = { kind: 'or', left, right: parseAnd() }
    }
    return left
  }

  // IF cond THEN target = value
  if (peek()?.type === 'if') {
    next()
    const cond = parseOr()
    expect('then')
    const target = expect('ident')
    expect('assign')
    const value = parsePrimary()
    if (pos !== tokens.length) throw new Error('DSL 末尾存在多余内容')
    return { kind: 'if', cond, target: target.value, value }
  }

  const ast = parseOr()
  if (pos !== tokens.length) throw new Error('DSL 末尾存在多余内容')
  return ast
}

/* ---------------- 求值 ---------------- */

/** 规则求值上下文 */
export interface EvalContext {
  /** 当前对象类型 */
  objectType: ObjectType
  /** 字段值：width/height/area/... 来自真实测量 */
  fields: Record<string, number>
  /** 场景中各类型对象计数 */
  counts: Partial<Record<ObjectType, number>>
  /** 任意命名距离，如 distance(a,b) 的参数 */
  namedDistances?: Record<string, number>
}

function compare(op: string, l: number | string, r: number | string): boolean {
  if (typeof l === 'number' && typeof r === 'number') {
    switch (op) {
      case '>': return l > r
      case '<': return l < r
      case '>=': return l >= r
      case '<=': return l <= r
      case '==': return l === r
      case '!=': return l !== r
    }
  }
  switch (op) {
    case '==': return l === r
    case '!=': return l !== r
  }
  throw new Error(`DSL 不支持的操作数比较: ${l} ${op} ${r}`)
}

function isObjectTypeName(s: string): boolean {
  return ['door', 'window', 'building', 'fence', 'pole', 'road', 'tree', 'ground', 'unknown'].includes(s)
}

export function evaluate(node: AstNode, ctx: EvalContext): number | string | boolean {
  switch (node.kind) {
    case 'num':
      return node.value
    case 'str':
      return node.value
    case 'field': {
      // door.width：首段为类型名时要求与当前对象匹配，否则取第二段字段
      let path = node.path
      if (path.length > 1 && isObjectTypeName(path[0])) {
        if (path[0] !== ctx.objectType) return NaN
        path = path.slice(1)
      }
      if (path.length === 1) {
        const v = ctx.fields[path[0]]
        if (v !== undefined) return v
        // 非测量字段的标识符视为字符串字面量（如 Level1、count(window) 的参数）
        return path[0]
      }
      throw new Error(`DSL 字段路径无效: ${node.path.join('.')}`)
    }
    case 'call': {
      const name = node.name
      if (name === 'count') {
        const arg = evaluate(node.args[0], ctx)
        return ctx.counts[arg as ObjectType] ?? 0
      }
      if (name === 'distance') {
        // distance(a,b)：在对象尺度上由测量工具提供；从命名距离表查询
        const a = String(evaluate(node.args[0], ctx))
        const b = String(evaluate(node.args[1], ctx))
        const key = `${a}|${b}`
        const v = ctx.namedDistances?.[key]
        if (v === undefined) throw new Error(`distance(${a},${b}) 缺少测量数据`)
        return v
      }
      // area / height / width / volume 等无参形式直接映射字段
      if (node.args.length === 0 && name in ctx.fields) return ctx.fields[name]
      throw new Error(`DSL 未知函数: ${name}`)
    }
    case 'cmp': {
      const l = evaluate(node.left, ctx)
      const r = evaluate(node.right, ctx)
      if (typeof l === 'boolean' || typeof r === 'boolean') throw new Error('DSL 比较操作数类型错误')
      if (typeof l === 'number' && Number.isNaN(l)) return false
      return compare(node.op, l, r)
    }
    case 'and':
      return Boolean(evaluate(node.left, ctx)) && Boolean(evaluate(node.right, ctx))
    case 'or':
      return Boolean(evaluate(node.left, ctx)) || Boolean(evaluate(node.right, ctx))
    case 'if':
      throw new Error('IF 节点不参与布尔求值')
  }
}

/* ---------------- 规则引擎 ---------------- */

export class RuleEngine {
  private rules: Rule[]

  constructor(rules: Rule[]) {
    this.rules = rules
  }

  getRules(): Rule[] {
    return this.rules
  }

  setRules(rules: Rule[]): void {
    this.rules = rules
  }

  /** 解析并校验所有规则 DSL，返回错误列表（空数组 = 全部合法） */
  validate(): Array<{ rule: string; error: string }> {
    const errors: Array<{ rule: string; error: string }> = []
    for (const r of this.rules) {
      try {
        parse(tokenize(r.condition))
      } catch (e) {
        errors.push({ rule: r.name, error: (e as Error).message })
      }
    }
    return errors
  }

  /**
   * 对单个对象执行合规审查。
   * 测量值必须来自 MeasurementEngine（Never guess geometry）。
   */
  inspect(
    obj: SpatialObject,
    measurements: Measurement[],
    counts: Partial<Record<ObjectType, number>> = {}
  ): ComplianceResult {
    const fields: Record<string, number> = {}
    for (const m of measurements) fields[m.kind] = m.value

    const ctx: EvalContext = { objectType: obj.type, fields, counts }
    const violations: Violation[] = []
    const derived: Record<string, string | number> = {}

    for (const rule of this.rules) {
      if (rule.appliesTo && !rule.appliesTo.includes(obj.type)) continue
      let ast: AstNode
      try {
        ast = parse(tokenize(rule.condition))
      } catch {
        violations.push({ rule: rule.name, actual: '—', expected: rule.expected, severity: 'warning' })
        continue
      }
      // IF...THEN 推导规则
      if (ast.kind === 'if') {
        let ok = false
        try {
          ok = Boolean(evaluate(ast.cond, ctx))
        } catch {
          ok = false
        }
        if (ok) {
          const v = evaluate(ast.value, ctx)
          derived[ast.target] = v as string | number
        }
        continue
      }
      // 普通条件：true = 合规，false = 违规
      let pass = false
      try {
        pass = Boolean(evaluate(ast, ctx))
      } catch {
        // 缺少字段等情况视为不适用，跳过
        continue
      }
      if (!pass) {
        const actualField = this.extractActualField(ast)
        violations.push({
          rule: rule.name,
          actual: actualField && fields[actualField] !== undefined ? fields[actualField] : '不满足条件',
          expected: rule.expected,
          severity: rule.severity
        })
      }
    }

    const hasError = violations.some((v) => v.severity === 'error')
    const status: ComplianceResult['status'] = hasError ? 'FAIL' : violations.length > 0 ? 'WARN' : 'PASS'
    return { status, violations, derived }
  }

  /** 从 AST 中提取首要测量字段名（用于报告 actual 值） */
  private extractActualField(ast: AstNode): string | null {
    if (ast.kind === 'cmp' && ast.left.kind === 'field') {
      const p = ast.left.path
      return p[p.length - 1]
    }
    if (ast.kind === 'and' || ast.kind === 'or') return this.extractActualField(ast.left)
    return null
  }
}

/** 内置默认规则集（对应文档第八节示例与工程实践） */
export const DEFAULT_RULES: Rule[] = [
  { name: 'Door Width', condition: 'door.width >= 0.9', severity: 'error', appliesTo: ['door'], expected: '宽度 ≥ 0.9 m' },
  { name: 'Door Height', condition: 'door.height >= 2.0', severity: 'warning', appliesTo: ['door'], expected: '高度 ≥ 2.0 m' },
  { name: 'Fence Height', condition: 'fence.height <= 2.2', severity: 'warning', appliesTo: ['fence'], expected: '高度 ≤ 2.2 m' },
  { name: 'Pole Height', condition: 'pole.height > 3', severity: 'error', appliesTo: ['pole'], expected: '高度 > 3 m' },
  { name: 'Road Width', condition: 'road.width >= 3', severity: 'warning', appliesTo: ['road'], expected: '宽度 ≥ 3 m' },
  { name: 'Building Fire Level', condition: 'IF building.height > 30 THEN fireLevel = Level1', severity: 'warning', appliesTo: ['building'], expected: '高度 > 30 m 时消防等级 = Level1' }
]
