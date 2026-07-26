<script setup lang="ts">
import { onMounted, ref } from 'vue'

const emit = defineEmits<{ ready: [container: HTMLElement] }>()
const containerRef = ref<HTMLElement | null>(null)

onMounted(() => {
  if (containerRef.value) emit('ready', containerRef.value)
})
</script>

<template>
  <div ref="containerRef" class="cesium-container"></div>
</template>

<style scoped>
.cesium-container {
  position: absolute;
  inset: 0;
}
</style>
