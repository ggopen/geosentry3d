<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAppStore } from '../store/appStore'
import { DEFAULT_RULES, RuleEngine, type Rule } from '../rules/RuleEngine'

const DEFAULT_SNAPSHOT = JSON.parse(JSON.stringify(DEFAULT_RULES)) as Rule[]

const store = useAppStore()
const text = ref(JSON.stringify(store.rules, null, 2))
const message = ref('')
const msgOk = ref(true)

watch(
  () => store.rules,
  (rules) => {
    text.value = JSON.stringify(rules, null, 2)
  }
)

function apply(): void {
  try {
    const parsed = JSON.parse(text.value) as Rule[]
    if (!Array.isArray(parsed)) throw new Error('规则必须是数组')
    const engine = new RuleEngine(parsed)
    const errors = engine.validate()
    if (errors.length > 0) {
      msgOk.value = false
      message.value = errors.map((e) => `[${e.rule}] ${e.error}`).join('；')
      return
    }
    store.setRules(parsed)
    store.log(`已更新规则集（${parsed.length} 条）`)
    msgOk.value = true
    message.value = '规则已生效'
  } catch (e) {
    msgOk.value = false
    message.value = (e as Error).message
  }
}

function reset(): void {
  store.setRules(JSON.parse(JSON.stringify(DEFAULT_SNAPSHOT)) as Rule[])
}
</script>

<template>
  <div class="rule-editor">
    <h3>规则引擎（DSL）</h3>
    <p class="hint">
      支持：door.width &gt;= 0.9 ｜ fence.height &lt;= 2.2 ｜ AND / OR ｜
      count(window) &gt; 4 ｜ IF building.height &gt; 30 THEN fireLevel = Level1
    </p>
    <textarea v-model="text" spellcheck="false"></textarea>
    <div class="row">
      <button class="btn primary" @click="apply">应用规则</button>
      <button class="btn" @click="reset">恢复默认</button>
    </div>
    <div v-if="message" class="msg" :class="{ ok: msgOk }">{{ message }}</div>
  </div>
</template>

<style scoped>
.rule-editor { padding: 10px; border-top: 1px solid #263449; }
h3 { margin: 4px 0 6px; font-size: 14px; color: #9ecbff; }
.hint { font-size: 11px; color: #7a8699; line-height: 1.6; margin: 0 0 8px; }
textarea {
  width: 100%; height: 180px; box-sizing: border-box;
  background: #0d1420; color: #d7e3f4; border: 1px solid #263449;
  border-radius: 6px; font-family: monospace; font-size: 11px; padding: 8px;
  resize: vertical;
}
.row { display: flex; gap: 8px; margin-top: 8px; }
.msg { margin-top: 6px; font-size: 12px; color: #ff9d9d; }
.msg.ok { color: #7ee787; }
</style>
