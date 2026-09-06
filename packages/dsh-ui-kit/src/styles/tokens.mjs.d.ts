/**
 * 声明 build/build.mjs 生成的 dist/styles/tokens.mjs（Spark token 层自注入模块）。
 * 该模块在 import 时把文件内的 token 层写入 document.head，并导出已用值
 * sparkTokenLayer（持有副作用）与 sparkTokenCss（token CSS 字符串，供 rolldown
 * 打包的消费者显式走 injectPluginStyle 注入），保证 esbuild 与 rolldown 都不剪掉。
 */
export declare const sparkTokenLayer: true
export declare const sparkTokenCss: string
