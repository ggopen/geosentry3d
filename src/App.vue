<script setup lang="ts">
import { reactive, ref } from 'vue'
import CesiumViewer from './components/CesiumViewer.vue'
import ObjectList from './components/ObjectList.vue'
import RuleEditor from './components/RuleEditor.vue'
import { AppController } from './services/AppController'
import { useAppStore } from './store/appStore'

const store = useAppStore()
const controller = new AppController()
const clickAnalyzeOn = ref(false)
const activeTab = ref<'objects' | 'rules'>('objects')
const stats = reactive({ showLogs: true })

async function onViewerReady(container: HTMLElement): Promise<void> {
  controller.init(container)
  store.log('Cesium Viewer 初始化完成')
  try {
    await controller.loadTileset()
  } catch {
    /* 日志已记录 */
  }
}

function toggleClickAnalyze(): void {
  clickAnalyzeOn.value = !clickAnalyzeOn.value
  if (clickAnalyzeOn.value) {
    controller.enableClickAnalyze()
    store.measureMode = 'none'
    store.log('点击分析模式已开启：点击模型表面即可自动识别 + 测量 + 合规审查')
  } else {
    controller.disableClickAnalyze()
    store.log('点击分析模式已关闭')
  }
}

function startMeasure(mode: 'distance' | 'area' | 'height'): void {
  store.measureMode = mode
  if (clickAnalyzeOn.value) toggleClickAnalyze()
  controller.startMeasure(mode)
  const label = mode === 'distance' ? '距离' : mode === 'area' ? '面积' : '高度'
  store.log(`手动测量-${label}：左键加点，右键结束（高度模式两点自动结束）`)
}

function flyTo(id: string): void {
  controller.flyToResult(id)
}
</script>

<template>
  <div class="layout">
    <CesiumViewer @ready="onViewerReady" />

    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <span class="logo">GeoSentry 3D</span>
      <button class="btn" :disabled="store.loading" @click="controller.loadTileset()">
        {{ store.tilesetLoaded ? '重新加载瓦片' : '加载 3D Tiles' }}
      </button>
      <button class="btn" :class="{ on: clickAnalyzeOn }" :disabled="!store.tilesetLoaded || store.analyzing" @click="toggleClickAnalyze">
        点击分析
      </button>
      <button class="btn" :disabled="!store.tilesetLoaded || store.analyzing" @click="controller.autoScan()">
        自动扫描
      </button>
      <span class="sep"></span>
      <button class="btn" :class="{ on: store.measureMode === 'distance' }" :disabled="!store.tilesetLoaded" @click="startMeasure('distance')">测距</button>
      <button class="btn" :class="{ on: store.measureMode === 'area' }" :disabled="!store.tilesetLoaded" @click="startMeasure('area')">测面</button>
      <button class="btn" :class="{ on: store.measureMode === 'height' }" :disabled="!store.tilesetLoaded" @click="startMeasure('height')">测高</button>
      <span class="sep"></span>
      <button class="btn" @click="controller.clearMeasure()">清除测量</button>
      <button class="btn danger" @click="controller.clearAnnotations()">清除标注</button>
      <span class="sep"></span>
      <button class="btn primary" :disabled="store.results.length === 0" @click="controller.exportReport('html')">HTML 报告</button>
      <button class="btn primary" :disabled="store.results.length === 0" @click="controller.exportReport('json')">JSON</button>
      <button class="btn primary" :disabled="store.results.length === 0" @click="controller.exportReport('csv')">CSV</button>
    </div>

    <!-- 加载遮罩 -->
    <div v-if="store.loading || store.analyzing" class="loading-mask">
      <div class="spinner"></div>
      <div>{{ store.loadingText || '分析中…' }}</div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats" v-if="store.results.length > 0">
      <span>对象 {{ store.summary.total }}</span>
      <span class="c-pass">合规 {{ store.summary.pass }}</span>
      <span class="c-warn">警告 {{ store.summary.warn }}</span>
      <span class="c-fail">违规 {{ store.summary.fail }}</span>
    </div>

    <!-- 右侧面板 -->
    <div class="sidebar">
      <div class="tabs">
        <button :class="{ on: activeTab === 'objects' }" @click="activeTab = 'objects'">检测结果</button>
        <button :class="{ on: activeTab === 'rules' }" @click="activeTab = 'rules'">规则引擎</button>
      </div>
      <ObjectList v-show="activeTab === 'objects'" :on-fly-to="flyTo" />
      <RuleEditor v-show="activeTab === 'rules'" />
    </div>

    <!-- 日志面板 -->
    <div class="log-panel" v-if="stats.showLogs">
      <div class="log-head" @click="stats.showLogs = false">运行日志（点击收起）</div>
      <div class="log-body">
        <div v-for="(l, i) in store.logs" :key="i">{{ l }}</div>
      </div>
    </div>
    <div v-else class="log-collapsed" @click="stats.showLogs = true">日志 ▸</div>
  </div>
</template>

<style>
html, body, #app {
  margin: 0; height: 100%; overflow: hidden;
  background: #0b1017; color: #d7e3f4;
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
}
.layout { position: relative; width: 100%; height: 100%; }

.toolbar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 10;
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 8px 10px; background: rgba(11, 16, 23, 0.88);
  border-bottom: 1px solid #263449; backdrop-filter: blur(4px);
}
.logo { font-weight: bold; color: #4d9fff; margin-right: 10px; font-size: 15px; }
.sep { width: 1px; height: 20px; background: #263449; margin: 0 4px; }

.btn {
  background: #16202e; color: #d7e3f4; border: 1px solid #31445e;
  border-radius: 5px; padding: 5px 10px; font-size: 12px; cursor: pointer;
}
.btn:hover:not(:disabled) { border-color: #4d9fff; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn.on { background: #1c3d66; border-color: #4d9fff; color: #9ecbff; }
.btn.primary { background: #143a2a; border-color: #2ea043; }
.btn.danger { border-color: #8c3a3a; }

.loading-mask {
  position: absolute; inset: 0; z-index: 30;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; background: rgba(11, 16, 23, 0.55); font-size: 14px;
}
.spinner {
  width: 34px; height: 34px; border: 3px solid #263449;
  border-top-color: #4d9fff; border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.stats {
  position: absolute; top: 52px; left: 10px; z-index: 9;
  display: flex; gap: 12px; padding: 6px 12px;
  background: rgba(11, 16, 23, 0.85); border: 1px solid #263449;
  border-radius: 6px; font-size: 12px;
}
.c-pass { color: #7ee787; } .c-warn { color: #ffd54f; } .c-fail { color: #ff9d9d; }

.sidebar {
  position: absolute; top: 52px; right: 0; bottom: 0; width: 330px; z-index: 9;
  display: flex; flex-direction: column;
  background: rgba(13, 20, 32, 0.92); border-left: 1px solid #263449;
}
.tabs { display: flex; border-bottom: 1px solid #263449; }
.tabs button {
  flex: 1; padding: 8px; background: transparent; border: none;
  color: #7a8699; cursor: pointer; font-size: 13px;
}
.tabs button.on { color: #9ecbff; border-bottom: 2px solid #4d9fff; }

.log-panel {
  position: absolute; left: 10px; bottom: 10px; z-index: 9;
  width: 460px; max-width: 45vw;
  background: rgba(13, 20, 32, 0.92); border: 1px solid #263449; border-radius: 6px;
}
.log-head { padding: 6px 10px; font-size: 12px; color: #9ecbff; cursor: pointer; border-bottom: 1px solid #263449; }
.log-body { max-height: 140px; overflow-y: auto; padding: 6px 10px; font-size: 11px; line-height: 1.7; color: #aebdd1; }
.log-collapsed {
  position: absolute; left: 10px; bottom: 10px; z-index: 9; padding: 6px 10px;
  background: rgba(13, 20, 32, 0.92); border: 1px solid #263449;
  border-radius: 6px; font-size: 12px; color: #9ecbff; cursor: pointer;
}
</style>
