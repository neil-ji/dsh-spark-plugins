import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// The demo consumes the BUILT artifact through the published subpaths, exactly
// like a third-party consumer would (aliases stand in for the npm package).
export default defineConfig({
  root: path.resolve(__dirname, '..', 'demo'),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^dsh-ui-kit\/tokens\.css$/, replacement: path.resolve(__dirname, '..', 'dist/styles/tokens.css') },
      { find: /^dsh-ui-kit\/katex\.css$/, replacement: path.resolve(__dirname, '..', 'dist/katex/katex.min.css') },
      { find: /^dsh-ui-kit$/, replacement: path.resolve(__dirname, '..', 'dist/index.js') },
    ],
  },
  build: {
    outDir: 'dist',
  },
})
