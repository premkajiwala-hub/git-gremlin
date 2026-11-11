import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

const root = process.cwd()

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        input: { index: resolve(root, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      rolldownOptions: {
        input: { index: resolve(root, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    // assets/ is served as the web root, so textures load from ./textures/*.png
    // both in dev and in the packaged app.
    publicDir: resolve(root, 'assets'),
    build: {
      rolldownOptions: {
        input: {
          index: resolve(root, 'src/renderer/index.html'),
          hub: resolve(root, 'src/renderer/hub.html')
        }
      }
    }
  }
})
