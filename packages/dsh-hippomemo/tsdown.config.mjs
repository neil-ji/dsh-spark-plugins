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
      evolve: 'src/memory-evolve.ts',
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
    // 0.1.2: client-store 等新客户端包内联进 bundle；只有模块表种子里的平台包 external。
    external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
    // dsh-spark-plugin-kit 是纯库（无 dsh.client 声明、非 loader entry），tsdown 默认把
    // dependencies external 化会让 client 在运行时 require 落空（HARNESS 报
    // "missed the module table"）；显式内联，与其他 client 插件一致只 external 平台模块。
    // zod：事件契约（`src/wire.ts`）的逐项 codec 要用它，客户端 `$mount` 描述符是
    // **运行时**依赖 —— 不内联就会在浏览器里 require("zod") 落空（实测报错同上）。
    deps: { alwaysBundle: [/^dsh-spark-plugin-kit/, /^dsh-ui-kit/, /^lucide-react/, /^zod/] },
    // client.js 先写到临时名，由 build.mjs 在 tsdown 结束后原子 rename 成
    // lib/client.js——避免构建过程中读方（dsh web 的 /plugins/... 路由）看到
    // 空/半截文件（此前实测过 build 窗口内会短暂出现空文件）。
    outputOptions: {
      entryFileNames: 'client.js.tmp',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-hippomemo", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
  // 注：本包曾额外产出 client-embed（lib/embed.cjs，给 dock 内嵌的第二份产物）。
  // ADR-003 之后 dock 不再 import 任何插件 UI，插件走 client.js 自注册 —— 已删除
  // （评审 F6 / P4）。组件级预览画布改吃 src/client/embed.ts 这个**源码 barrel**。
]
