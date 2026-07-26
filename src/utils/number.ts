/** 数值格式化工具 */

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

let seq = 0
/** 生成对象唯一 ID */
export function genId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}
