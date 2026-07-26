/**
 * Agent 5: Report Engine（报告引擎）
 * 生成 HTML / CSV / JSON 三种格式的合规分析报告，浏览器端直接下载。
 */
import type { InspectionResult } from '../core/types'
import { round2 } from '../utils/number'

const TYPE_LABEL: Record<string, string> = {
  door: '门', window: '窗', building: '建筑', fence: '围栏',
  pole: '杆体', road: '道路', tree: '树木', ground: '地面', unknown: '未知'
}

export class ReportEngine {
  /** 汇总统计 */
  summarize(results: InspectionResult[]): {
    total: number; pass: number; warn: number; fail: number
  } {
    return {
      total: results.length,
      pass: results.filter((r) => r.compliance.status === 'PASS').length,
      warn: results.filter((r) => r.compliance.status === 'WARN').length,
      fail: results.filter((r) => r.compliance.status === 'FAIL').length
    }
  }

  /** JSON 报告（对应 Cesium Spatial Agent 的输出 schema） */
  toJSON(results: InspectionResult[]): string {
    const payload = {
      report: 'Spatial Compliance Report',
      generatedAt: new Date().toISOString(),
      summary: this.summarize(results),
      objects: results.map((r) => ({
        objectId: r.objectId,
        objectType: r.objectType,
        confidence: r.confidence,
        measurements: r.measurements,
        compliance: r.compliance,
        annotations: r.annotations,
        recommendations: r.recommendations
      }))
    }
    return JSON.stringify(payload, null, 2)
  }

  /** CSV 报告 */
  toCSV(results: InspectionResult[]): string {
    const header = 'objectId,type,status,length_m,width_m,height_m,violations,recommendations'
    const rows = results.map((r) => {
      const get = (k: string) => r.measurements.find((m) => m.kind === k)?.value ?? ''
      const violations = r.compliance.violations.map((v) => `${v.rule}(${v.actual}/${v.expected})`).join('; ')
      const recs = r.recommendations.join('; ')
      const cell = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`
      return [r.objectId, r.objectType, r.compliance.status, get('length'), get('width'), get('height'), cell(violations), cell(recs)].join(',')
    })
    return '﻿' + [header, ...rows].join('\n')
  }

  /** HTML 报告 */
  toHTML(results: InspectionResult[], sceneUrl: string): string {
    const s = this.summarize(results)
    const rate = s.total > 0 ? round2((s.pass / s.total) * 100) : 0
    const rows = results
      .map((r) => {
        const statusColor = r.compliance.status === 'FAIL' ? '#e53935' : r.compliance.status === 'WARN' ? '#fbc02d' : '#43a047'
        const dims = r.bbox
          ? `${r.bbox.length.toFixed(2)} × ${r.bbox.width.toFixed(2)} × ${r.bbox.height.toFixed(2)}`
          : '—'
        const violations = r.compliance.violations.length
          ? r.compliance.violations.map((v) => `<li>${v.rule}：实测 <b>${v.actual}</b>，要求 ${v.expected}</li>`).join('')
          : '<li>无</li>'
        return `<tr>
          <td>${r.objectId}</td>
          <td>${TYPE_LABEL[r.objectType] ?? r.objectType}</td>
          <td>${(r.confidence * 100).toFixed(0)}%</td>
          <td>${dims}</td>
          <td style="color:${statusColor};font-weight:bold">${r.compliance.status}</td>
          <td><ul>${violations}</ul></td>
        </tr>`
      })
      .join('\n')
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>空间合规分析报告</title>
<style>
 body{font-family:"Microsoft YaHei",sans-serif;margin:32px;color:#222}
 h1{border-bottom:3px solid #1565c0;padding-bottom:8px}
 .cards{display:flex;gap:16px;margin:16px 0}
 .card{flex:1;border:1px solid #ddd;border-radius:8px;padding:16px;text-align:center}
 .card b{font-size:28px;display:block}
 table{border-collapse:collapse;width:100%;margin-top:16px}
 th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}
 th{background:#1565c0;color:#fff}
 ul{margin:0;padding-left:18px}
 .meta{color:#666;font-size:13px}
</style></head><body>
<h1>空间合规分析报告</h1>
<p class="meta">生成时间：${new Date().toLocaleString('zh-CN')}　场景：${sceneUrl}</p>
<p class="meta">测量原则：Never guess geometry. Always call measurement tools. —— 报告内所有数值均由测量引擎实测得出。</p>
<div class="cards">
 <div class="card"><b>${s.total}</b>检测对象</div>
 <div class="card" style="color:#43a047"><b>${s.pass}</b>合规</div>
 <div class="card" style="color:#fbc02d"><b>${s.warn}</b>警告</div>
 <div class="card" style="color:#e53935"><b>${s.fail}</b>违规</div>
 <div class="card"><b>${rate}%</b>合规率</div>
</div>
<table>
<tr><th>对象 ID</th><th>类型</th><th>置信度</th><th>尺寸 长×宽×高 (m)</th><th>状态</th><th>违规明细</th></tr>
${rows}
</table>
</body></html>`
  }

  /** 触发浏览器下载 */
  download(filename: string, content: string, mime: string): void {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
}
