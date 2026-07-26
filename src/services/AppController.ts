/**
 * 应用控制器：粘合 SceneService / AnnotationLayer / MeasureTool 与多 Agent 编排器。
 * UI 组件只与控制器交互，保持模块松散耦合。
 */
import * as Cesium from 'cesium'
import type { MeasureMode, MeasureResult } from '../measurement/MeasureTool'
import { AnalysisOrchestrator } from '../agents/Orchestrator'
import { AnnotationLayer } from '../annotation/AnnotationLayer'
import { RuleEngine } from '../rules/RuleEngine'
import { ReportEngine } from './ReportEngine'
import { SceneService } from './SceneService'
import { MeasureTool } from '../measurement/MeasureTool'
import { useAppStore } from '../store/appStore'
import type { Rule } from '../core/types'

export class AppController {
  readonly scene = new SceneService()
  readonly report = new ReportEngine()
  readonly orchestrator = new AnalysisOrchestrator()
  private annotationLayer: AnnotationLayer | null = null
  private measureTool: MeasureTool | null = null
  private store = useAppStore()

  init(container: HTMLElement): void {
    const viewer = this.scene.init(container)
    this.annotationLayer = new AnnotationLayer(viewer)
    this.measureTool = new MeasureTool(viewer)
  }

  /** 加载瓦片集 */
  async loadTileset(): Promise<void> {
    this.store.loading = true
    this.store.loadingText = '正在加载 3D Tiles…'
    try {
      await this.scene.loadTileset(this.store.tilesetUrl)
      this.store.tilesetLoaded = true
      this.store.log(`瓦片集加载完成：${this.store.tilesetUrl}`)
    } catch (e) {
      this.store.log(`瓦片集加载失败：${(e as Error).message}`)
      throw e
    } finally {
      this.store.loading = false
    }
  }

  /** 开启"点击分析"模式：点击模型 → 采样 → 多Agent流水线 → 标注 */
  enableClickAnalyze(): void {
    const viewer = this.scene.getViewer()
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(async (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      await this.analyzeAtScreenPosition(e.position)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    // 返回销毁函数挂到 viewer 上便于清理
    ;(viewer as unknown as { _analyzeHandler?: Cesium.ScreenSpaceEventHandler })._analyzeHandler?.destroy()
    ;(viewer as unknown as { _analyzeHandler?: Cesium.ScreenSpaceEventHandler })._analyzeHandler = handler
  }

  disableClickAnalyze(): void {
    const viewer = this.scene.getViewer()
    ;(viewer as unknown as { _analyzeHandler?: Cesium.ScreenSpaceEventHandler })._analyzeHandler?.destroy()
    ;(viewer as unknown as { _analyzeHandler?: Cesium.ScreenSpaceEventHandler })._analyzeHandler = undefined
  }

  /** 对屏幕上某点执行分析 */
  async analyzeAtScreenPosition(position: Cesium.Cartesian2): Promise<void> {
    if (this.store.analyzing) return
    this.store.analyzing = true
    this.store.log('采样中：正在调用测量工具获取真实几何…')
    try {
      const bbox = await this.scene.analyzeAt(position)
      if (!bbox) {
        this.store.log('未拾取到有效几何，请点击模型表面')
        return
      }
      this.runPipeline([bbox])
    } catch (e) {
      this.store.log(`分析失败：${(e as Error).message}`)
    } finally {
      this.store.analyzing = false
    }
  }

  /** 自动扫描整个场景 */
  async autoScan(): Promise<void> {
    if (this.store.analyzing) return
    this.store.analyzing = true
    this.store.log('自动扫描：正在对场景做网格采样（这可能需要十几秒）…')
    try {
      const bboxes = await this.scene.autoScan(22, 10, (done, total) => {
        this.store.loadingText = `自动扫描采样中 ${done}/${total}`
      })
      if (bboxes.length === 0) {
        this.store.log('自动扫描未发现凸出对象')
        return
      }
      this.runPipeline(bboxes)
      this.store.log(`自动扫描完成：发现 ${bboxes.length} 个候选对象`)
    } catch (e) {
      this.store.log(`自动扫描失败：${(e as Error).message}`)
    } finally {
      this.store.analyzing = false
      this.store.loadingText = ''
    }
  }

  /** 多 Agent 流水线：识别 → 测量 → 合规 → 标注 → 入库 */
  private runPipeline(bboxes: import('../core/types').BoundingInfo[]): void {
    const engine = new RuleEngine(this.store.rules as Rule[])
    const errors = engine.validate()
    for (const err of errors) this.store.log(`规则语法错误 [${err.rule}]：${err.error}`)

    for (const bbox of bboxes) {
      const result = this.orchestrator.analyze(bbox, this.store.counts as never)
      // 用当前规则重新评估（orchestrator 内部用默认规则，这里覆盖为 Store 中的规则）
      const obj = {
        id: result.objectId,
        type: result.objectType,
        confidence: result.confidence,
        bbox: result.bbox,
        properties: {}
      }
      result.compliance = engine.inspect(obj, result.measurements, this.store.counts as never)
      this.store.addResult(result)
      this.annotationLayer?.add(result.annotations[0], result.bbox)
      const statusText = result.compliance.status === 'FAIL' ? '违规' : result.compliance.status === 'WARN' ? '警告' : '合规'
      this.store.log(
        `识别为 ${result.objectType}（置信度 ${(result.confidence * 100).toFixed(0)}%）→ ${statusText}，` +
        `尺寸 ${result.bbox.length.toFixed(2)}×${result.bbox.width.toFixed(2)}×${result.bbox.height.toFixed(2)}m`
      )
    }
  }

  /** 手动测量 */
  startMeasure(mode: MeasureMode): void {
    this.measureTool?.start(mode, (r: MeasureResult) => {
      this.store.log(`手动测量：${r.text}`)
      this.store.measureMode = 'none'
    })
  }

  clearMeasure(): void {
    this.measureTool?.clear()
  }

  clearAnnotations(): void {
    this.annotationLayer?.clear()
    this.store.clearResults()
    this.store.log('已清除全部标注与分析结果')
  }

  flyToResult(id: string): void {
    const r = this.store.results.find((x) => x.objectId === id)
    if (!r) return
    this.scene.flyTo(r.bbox)
    this.annotationLayer?.highlight(id)
  }

  /** 导出报告 */
  exportReport(format: 'html' | 'json' | 'csv'): void {
    const results = this.store.results
    if (results.length === 0) {
      this.store.log('暂无分析结果，无法生成报告')
      return
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    if (format === 'html') {
      this.report.download(`compliance-report-${stamp}.html`, this.report.toHTML(results, this.store.tilesetUrl), 'text/html')
    } else if (format === 'json') {
      this.report.download(`compliance-report-${stamp}.json`, this.report.toJSON(results), 'application/json')
    } else {
      this.report.download(`compliance-report-${stamp}.csv`, this.report.toCSV(results), 'text/csv')
    }
    this.store.log(`已导出 ${format.toUpperCase()} 报告（${results.length} 个对象）`)
  }
}
