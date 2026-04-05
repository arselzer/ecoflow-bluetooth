/// <reference types="vite/client" />
/// <reference types="@types/web-bluetooth" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
