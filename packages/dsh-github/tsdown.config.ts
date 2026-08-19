import { defineConfig } from 'tsdown'

/** Bundle the compiled node half into lib/index.js (ESM). */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
