import clsx from 'clsx'
// 副作用导入：把 Spark token 层（--spk-*/--dsw-*）注入 document.head。
// 必须带出 sparkTokenLayer 并作为已用值引用——仅裸副作用 import 时 rolldown/rollup
// 会因无法证明该模块有顶层副作用而整棵剪掉，esbuild 也只在 sideEffects=true 时保留；
// "已用值"模式对两个 bundler 都保留。若 token 层丢了，页面 --spk-* 为 empty → 组件全被冲淡。
// 模块由 build/build.mjs 生成 dist/styles/tokens.mjs（幂等，id=dsh-ui-kit/tokens）。
import { sparkTokenLayer } from './styles/tokens.mjs'

export { clsx as cx }

// 引用一次，防止任何 bundler 把该副作用 import 视为未使用而剪掉。
void sparkTokenLayer
