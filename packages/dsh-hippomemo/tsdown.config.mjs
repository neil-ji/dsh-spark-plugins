/**
 * Build config for dsh-hippomemo.
 *
 * Node entries are ordinary ESM plugins. The client entry is a browser bundle
 * shaped exactly as the dsh client module loader expects:
 * window.__ModuleLoader__.load({ id, factory: (require) => ... }).
 */

const EXTERNAL_HOST = [
  /^@deepseek-ai\/dsh-/,
  /^@deepseek-ai\/cordis/,
  /^@deepseek-ai\/schemastery/,
  'react',
  'react-dom',
  'zod',
]

/** @type {import('tsdown').UserConfig[]} */
export default [
  {
    name: 'dsh-hippomemo/host',
    entry: {
      index: 'src/index.ts',
      tool: 'src/tool.ts',
      context: 'src/context.ts',
      extractor: 'src/extractor.ts',
      terms: 'src/memory-terms.ts',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    fixedExtension: false,
    external: EXTERNAL_HOST,
  },
  {
    name: 'dsh-hippomemo/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2020',
    dts: false,
    clean: false,
    external: ['react', 'react-dom', /^@deepseek-ai\/dsh-client-/],
    // dsh-plugin-kit 是纯库（无 dsh.client 声明、非 loader entry），tsdown 默认把
    // dependencies external 化会让 client 在运行时 require 落空（HARNESS 报
    // "missed the module table"）；显式内联，与其他 client 插件一致只 external 平台模块。
    deps: { alwaysBundle: [/^dsh-plugin-kit/] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-hippomemo", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
