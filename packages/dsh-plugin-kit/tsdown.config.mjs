/** dsh-spark-plugin-kit 构建：host 与 client 均为普通 ESM（client 会被插件 client bundle 内联，无需 ModuleLoader wrapper）。 */
const EXTERNAL = [/^@deepseek-ai\//, 'react', 'react-dom', 'zod']

/** @type {import('tsdown').UserConfig[]} */
export default [
  {
    name: 'dsh-spark-plugin-kit/host',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    dts: false,
    clean: false,
    external: EXTERNAL,
  },
  {
    name: 'dsh-spark-plugin-kit/client',
    entry: { 'client/index': 'src/client/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'neutral',
    target: 'es2022',
    dts: false,
    clean: false,
    external: EXTERNAL,
  },
]
