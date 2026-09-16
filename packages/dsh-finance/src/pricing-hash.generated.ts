/**
 * 生成物 —— 禁止手改（scripts/gen-finance-prices.mjs）。
 *
 * host 加载 releaseBase 价格表后计算 sha256 并与本常量比对：不一致即"基础表被本地修改"
 * （FINANCE-PRICING-SPEC.md INV-5）。哈希锚点必须在 lib 里，不能与数据同处可写配置。
 */
export const FINANCE_PRICES_HASH = 'df687075e3441902c05950d3cf98a88363816560b26b659c8ab127a1ea85f4fa'
export const FINANCE_PRICES_SOURCE = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
export const FINANCE_PRICES_UPDATED = '2026-09-16T05:34:40.802Z'
