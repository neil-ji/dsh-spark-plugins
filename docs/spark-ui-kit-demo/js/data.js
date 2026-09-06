/* js/data.js — demo 数据与模块定义（纯数据，无 DOM） */

window.SparkDemo = window.SparkDemo || {};

/* 设计基元色板（v3：中性冷灰 + DSH 品牌蓝，与 spark-dock-preview 同源） */
SparkDemo.SWATCHES = [
  { name: "n-950 / bg", light: "#0b0e14", dark: "#0b0e14" },
  { name: "n-900", light: "#171c27", dark: "#171c27" },
  { name: "n-850", light: "#232b3a", dark: "#232b3a" },
  { name: "n-800", light: "#2d3749", dark: "#2d3749" },
  { name: "n-500 / muted", light: "#667085", dark: "#667085" },
  { name: "n-300", light: "#b3b9c4", dark: "#b3b9c4" },
  { name: "n-150 / border", light: "#e4e7ec", dark: "#e4e7ec" },
  { name: "n-50 / bg", light: "#f6f7f9", dark: "#f6f7f9" },
  { name: "spark-500", light: "#4d6bfe", dark: "#4d6bfe" },
  { name: "spark-400", light: "#6d85fe", dark: "#6d85fe" },
  { name: "spark-300", light: "#93a8ff", dark: "#93a8ff" },
  { name: "spark-700", light: "#2f46c8", dark: "#2f46c8" },
];

/* ListRow 数据（五模块） */
SparkDemo.LIST_ROWS = [
  {
    title: "把「验收 demo 先于铺组件」沉淀为流程约束",
    meta: "Hippomemo · HippoInsight · confidence 0.92",
    acc: "var(--spk-acc-hippomemo)",
    time: "09-07",
    badge: { text: "已结晶", cls: "pill--success" },
  },
  {
    title: "AAPL 182.52 ▲ +1.8% 触发自选提醒",
    meta: "Finance · 提醒推送",
    acc: "var(--spk-acc-finance)",
    time: "09-07",
    badge: { text: "已推送", cls: "" },
  },
  {
    title: "dsh-ui-kit v2.0-rc 发布至 npm",
    meta: "npm · dist-tag latest",
    acc: "var(--spk-acc-npm)",
    time: "09-06",
    badge: { text: "完成", cls: "pill--success" },
  },
  {
    title: "PR #42「SegmentedControl 弹簧位移」待 review",
    meta: "GitHub · dsh-spark-plugins",
    acc: "var(--spk-acc-github)",
    time: "09-06",
    badge: { text: "待办", cls: "pill--warn" },
  },
  {
    title: "早期 token 桥接实验方案（已废弃）",
    meta: "Hippomemo · archived",
    acc: "var(--spk-acc-hippomemo)",
    time: "09-01",
    badge: { text: "归档", cls: "" },
    archived: true,
  },
];

/* Disclosure 数据 */
SparkDemo.DISCLOSURES = [
  {
    name: "Spark 捕获",
    desc: "情景流实时入库 · SSE",
    acc: "var(--spk-acc-spark)",
    body: "捕获窗口 20:00–23:00 · 去重阈值 0.86 · 每日上限 500 条。原始 spark 保留 30 天，未结晶自动降权。",
  },
  {
    name: "Crystallize 结晶策略",
    desc: "spark → 三种材质的中心操作",
    acc: "var(--spk-acc-hippomemo)",
    body: "候选簇 ≥ 3 条 spark 且语义相似度 ≥ 0.78 时生成候选，逐条 resolve 后正式执行；支持 7 天撤销窗口。",
  },
  {
    name: "Cognitive Filter 注入抑制",
    desc: "前额叶：主动抑制机械注入",
    acc: "var(--spk-acc-github)",
    body: "对低相关（score < 0.4）记忆主动抑制注入，本期注入量较桥接版下降 42%，上下文预算回归目标区间。",
  },
];

/* Sparkline 数据（近 30 天记忆总量） */
SparkDemo.SPARKLINE = [
  980, 992, 1001, 1015, 1010, 1032, 1048, 1041, 1063, 1078,
  1092, 1085, 1104, 1121, 1136, 1130, 1148, 1167, 1159, 1181,
  1196, 1214, 1208, 1231, 1249, 1262, 1258, 1271, 1279, 1284,
];

/* Toast 文案 */
SparkDemo.TOASTS = {
  success: { acc: "var(--spk-success)", html: "<strong>已结晶</strong> 3 条 spark 合并为 1 条 HippoInsight。" },
  error: { acc: "var(--spk-error)", html: "<strong>Token 已失效</strong> 请在凭据卡中重新授权。" },
  info: { acc: "var(--spk-info)", html: "<strong>提示</strong> 7 天内可在「候选」页撤销本次结晶。" },
};
