<script setup lang="ts">
import { useAppStore } from '../store/appStore'

const props = defineProps<{ onFlyTo: (id: string) => void }>()
const store = useAppStore()

const TYPE_LABEL: Record<string, string> = {
  door: '门', window: '窗', building: '建筑', fence: '围栏',
  pole: '杆体', road: '道路', tree: '树木', ground: '地面', unknown: '未知'
}

function statusClass(s: string): string {
  return s === 'FAIL' ? 'st-fail' : s === 'WARN' ? 'st-warn' : 'st-pass'
}
</script>

<template>
  <div class="panel">
    <h3>检测对象（{{ store.results.length }}）</h3>
    <div v-if="store.results.length === 0" class="empty">
      暂无结果。加载瓦片后，点击模型表面进行分析，或使用自动扫描。
    </div>
    <div
      v-for="r in store.results"
      :key="r.objectId"
      class="obj-item"
      :class="{ active: store.selectedId === r.objectId }"
      @click="store.select(r.objectId); props.onFlyTo(r.objectId)"
    >
      <div class="obj-head">
        <span class="badge" :class="statusClass(r.compliance.status)">{{ r.compliance.status }}</span>
        <b>{{ TYPE_LABEL[r.objectType] ?? r.objectType }}</b>
        <span class="conf">{{ (r.confidence * 100).toFixed(0) }}%</span>
      </div>
      <div class="dims">
        {{ r.bbox.length.toFixed(2) }} × {{ r.bbox.width.toFixed(2) }} × {{ r.bbox.height.toFixed(2) }} m
      </div>
      <ul v-if="r.compliance.violations.length" class="viol">
        <li v-for="(v, i) in r.compliance.violations" :key="i">
          {{ v.rule }}：实测 {{ v.actual }}，要求 {{ v.expected }}
        </li>
      </ul>
      <div v-if="Object.keys(r.compliance.derived).length" class="derived">
        推导：{{ Object.entries(r.compliance.derived).map(([k, v]) => `${k}=${v}`).join('，') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { padding: 10px; overflow-y: auto; flex: 1; }
h3 { margin: 4px 0 10px; font-size: 14px; color: #9ecbff; }
.empty { color: #7a8699; font-size: 12px; line-height: 1.8; }
.obj-item {
  background: #16202e; border: 1px solid #263449; border-radius: 6px;
  padding: 8px; margin-bottom: 8px; cursor: pointer; font-size: 12px;
}
.obj-item.active, .obj-item:hover { border-color: #4d9fff; }
.obj-head { display: flex; align-items: center; gap: 8px; }
.badge { padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; }
.st-fail { background: #e53935; color: #fff; }
.st-warn { background: #fbc02d; color: #222; }
.st-pass { background: #43a047; color: #fff; }
.conf { margin-left: auto; color: #7a8699; }
.dims { color: #aebdd1; margin-top: 4px; }
.viol { margin: 6px 0 0; padding-left: 16px; color: #ff9d9d; }
.derived { margin-top: 4px; color: #ffd54f; }
</style>
