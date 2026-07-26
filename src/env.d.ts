/// <reference types="vite/client" />

/** 构建期注入（见 vite.config.ts define） */
declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
