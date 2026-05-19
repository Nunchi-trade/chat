import { defineConfig } from 'vite'

const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'chat'
const base = process.env.GITHUB_ACTIONS ? `/${repo}/` : '/'

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    outDir: 'dist'
  },
  optimizeDeps: {
    esbuildOptions: { target: 'es2022', supported: { bigint: true } }
  }
})
