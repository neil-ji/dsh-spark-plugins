#!/usr/bin/env node
/**
 * check-finance-price-drift.mjs — A5 上游漂移检测（**定时任务**用，故意不进 check:all）。
 *
 * 为什么单独一条腿：厂商"调价"没有事件驱动（新增模型有人抢着提 PR，调价没人盯），
 * models.dev 的 deepseek-v4-pro 曾经滞后一个月。所以这里主动拉厂商页与已提交的
 * 价格序列对比：**变了就当红**，提示"该跑生成器并发布新价格表了"。
 *
 * 用法：node scripts/check-finance-price-drift.mjs
 * 退出码：0 = 与上游一致；1 = 有漂移 / 上游不可达（不可达也要红，避免静默继续用旧价）。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEEPSEEK_PRICING_URL,
  parseDeepSeekPricingPage,
  snapshotToEras,
} from '../packages/dsh-finance/src/sync/vendor/deepseek-pricing.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERIES_PATH = path.join(ROOT, 'packages/dsh-finance-bundle/prices.series.json')

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item)).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'null'
}

const latestRate = (eras) => (eras.length === 0 ? undefined : eras[eras.length - 1].rate)

let html
try {
  const response = await fetch(DEEPSEEK_PRICING_URL, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  html = await response.text()
} catch (error) {
  console.error('A5 FAIL 上游不可达：' + DEEPSEEK_PRICING_URL + ' — ' + (error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
  process.exit()
}

const fresh = snapshotToEras(parseDeepSeekPricingPage(html), { effectiveFrom: Date.now() })
const series = JSON.parse(readFileSync(SERIES_PATH, 'utf8'))
const drift = []
for (const [key, eras] of Object.entries(fresh)) {
  const committed = series.prices?.[key]
  if (committed === undefined) { drift.push(key + ' 未收录'); continue }
  if (stableJson(latestRate(committed)) !== stableJson(eras[0].rate)) drift.push(key + ' 上游已变更')
}

if (drift.length === 0) {
  console.log('A5 ok  与厂商页一致（' + Object.keys(fresh).length + ' 个 key）')
  process.exitCode = 0
} else {
  console.log('A5 FAIL 检测到漂移：' + JSON.stringify(drift))
  console.log('        处置：node scripts/gen-finance-prices.mjs 生成新纪元 → bump → 发布')
  process.exitCode = 1
}
