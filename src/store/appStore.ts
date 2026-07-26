/**
 * Pinia 全局状态：场景状态、分析结果、规则文本、日志。
 */
import { defineStore } from 'pinia'
import type { InspectionResult } from '../core/types'
import { DEFAULT_RULES, type Rule } from '../rules/RuleEngine'

export const TILESET_URL = 'https://data.mars3d.cn/3dtiles/qx-simiao/tileset.json'

interface AppState {
  tilesetUrl: string
  tilesetLoaded: boolean
  loading: boolean
  loadingText: string
  results: InspectionResult[]
  selectedId: string | null
  rules: Rule[]
  logs: string[]
  measureMode: 'none' | 'distance' | 'area' | 'height'
  analyzing: boolean
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    tilesetUrl: TILESET_URL,
    tilesetLoaded: false,
    loading: false,
    loadingText: '',
    results: [],
    selectedId: null,
    rules: JSON.parse(JSON.stringify(DEFAULT_RULES)) as Rule[],
    logs: [],
    measureMode: 'none',
    analyzing: false
  }),
  getters: {
    counts(state): Record<string, number> {
      const c: Record<string, number> = {}
      for (const r of state.results) c[r.objectType] = (c[r.objectType] ?? 0) + 1
      return c
    },
    summary(state): { total: number; pass: number; warn: number; fail: number } {
      return {
        total: state.results.length,
        pass: state.results.filter((r) => r.compliance.status === 'PASS').length,
        warn: state.results.filter((r) => r.compliance.status === 'WARN').length,
        fail: state.results.filter((r) => r.compliance.status === 'FAIL').length
      }
    }
  },
  actions: {
    log(msg: string): void {
      const time = new Date().toLocaleTimeString('zh-CN')
      this.logs.unshift(`[${time}] ${msg}`)
      if (this.logs.length > 100) this.logs.pop()
    },
    addResult(r: InspectionResult): void {
      this.results.push(r)
    },
    clearResults(): void {
      this.results = []
      this.selectedId = null
    },
    select(id: string | null): void {
      this.selectedId = id
    },
    setRules(rules: Rule[]): void {
      this.rules = rules
    }
  }
})
