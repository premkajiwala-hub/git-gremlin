import type { GremlinApi } from '../preload/index'

declare global {
  interface Window {
    gremlin: GremlinApi
  }
}

export {}
