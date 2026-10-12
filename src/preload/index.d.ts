import type { XmtApi } from './index'

declare global {
  interface Window {
    xmt: XmtApi
  }
}

export {}
