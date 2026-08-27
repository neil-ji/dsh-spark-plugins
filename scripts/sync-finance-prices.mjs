#!/usr/bin/env node
/**
 * Sync the finance plugin's non-DeepSeek price table from a community-maintained
 * pricing dataset so nobody has to hand-maintain it.
 *
 * Source: models.dev api.json (https://models.dev — open-source AI model database,
 * MIT). Chosen over LiteLLM's model_prices_and_context_window.json because its
 * provider keys (openai / anthropic / google / zai / volcengine / deepseek / …)
 * match this repo's `${provider}/${model}` vocabulary nearly 1:1, its costs are
 * already USD-per-Mtok (no per-token floats), and it carries cache_read/cache_write.
 * LiteLLM's JSON remains a viable fallback if models.dev ever goes away — swap
 * SOURCE_URL and adapt collectRows() (its entries are flat keyed, per-token USD,
 * litellm_provider field).
 *
 * What it does:
 *   1. fetch the dataset (or read `--file <path>` offline)
 *   2. convert the configured providers' chat models into finance micro-rates
 *      (USD/Mtok x --fx -> integer micros/Mtok, CNY by default)
 *   3. splice them between the FINANCE-COMMUNITY-PRICES markers inside
 *      packages/dsh-finance-bundle/cordis.patch.yml — the hand-maintained DeepSeek
 *      peak/off-peak table above the markers stays authoritative untouched
 *
 * The hand-written DeepSeek era table must keep winning over the community rows:
 * normalizeFinancePrices resolves per-model `prices` first regardless of origin,
 * and both blocks live under the same `prices:` map — keep DeepSeek keys OUT of
 * the default --providers list for that reason.
 *
 * Usage:
 *   pnpm finance:sync-prices [--dry-run] [--fx 7.2] [--file <api.json>]
 *                            [--providers openai,anthropic,...] [--dated]
 *
 * @module tools/sync-finance-prices
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const BUNDLE_YML = new URL('../packages/dsh-finance-bundle/cordis.patch.yml', import.meta.url)
export const SOURCE_URL = 'https://models.dev/api.json'
export const MARKER_BEGIN = '# >>> FINANCE-COMMUNITY-PRICES-BEGIN'
export const MARKER_END = '# <<< FINANCE-COMMUNITY-PRICES-END'
/** CNY micros per USD — override with --fx; estimates, users bill what their provider bills. */
export const DEFAULT_FX = 7.2
/** Community providers synced by default. deepseek-official stays hand-maintained (peak/off-peak). */
export const DEFAULT_PROVIDERS = ['openai', 'anthropic', 'google', 'zai', 'volcengine']
const DATED_SUFFIX = /-(\d{8})$/
/** Obvious non-token-billed variants never belong in a token price table. */
const NON_TOKEN = /(^|[._-])(tts|speech|transcribe|transcription|realtime|live-v2)($|[._-])/i
const INDENT = '          ' // entries live two levels under the patch row config

/** Case-insensitive, separator-insensitive provider name equality. */
export function normalizeProvider(name) {
  return String(name).toLowerCase().replace(/[-_.]/g, '')
}

/**
 * Convert a models.dev cost object (USD per Mtok) into finance integer micros
 * per Mtok at the given FX rate. Returns null when the entry has no usable
 * input/output pair. Cache lines are optional and simply omitted when absent.
 */
export function costToRate(cost, fx) {
  if (!cost || typeof cost !== 'object') return null
  const input = Number(cost.input)
  const output = Number(cost.output)
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null
  if (input < 0 || output < 0) return null
  const micros = usd => Math.round(usd * fx * 1_000_000)
  const rate = { inputMicrosPerMtok: micros(input), outputMicrosPerMtok: micros(output) }
  const cacheRead = Number(cost.cache_read)
  const cacheWrite = Number(cost.cache_write)
  if (Number.isFinite(cacheRead) && cacheRead >= 0) rate.cacheReadMicrosPerMtok = micros(cacheRead)
  if (Number.isFinite(cacheWrite) && cacheWrite >= 0) rate.cacheWriteMicrosPerMtok = micros(cacheWrite)
  return rate
}

/**
 * Fold a parsed models.dev document into `{provider}/{model}` price rows for the
 * requested providers. Dated release snapshots (`model-YYYYMMDD`) are dropped
 * when the undated sibling exists (pass `dated: true` to keep them); non-token
 * product variants are always dropped. Context-length tiers are ignored by
 * design — the buckets carry no context size — the base rate applies.
 */
export function collectRows(data, opts = {}) {
  const providers = (opts.providers ?? DEFAULT_PROVIDERS).map(normalizeProvider)
  const stats = { requestedMissing: [], kept: 0, droppedDated: 0, droppedNonToken: 0, droppedNoCost: 0 }
  const rows = []
  for (const [sourceProvider, entry] of Object.entries(data ?? {})) {
    if (!providers.includes(normalizeProvider(sourceProvider))) continue
    if (entry === null || typeof entry !== 'object') continue
    const models = entry.models ?? {}
    if (Object.keys(models).length === 0) continue
    for (const [modelId, model] of Object.entries(models)) {
      if (NON_TOKEN.test(modelId)) { stats.droppedNonToken += 1; continue }
      const dated = modelId.match(DATED_SUFFIX)
      if (dated && !opts.dated) {
        const base = modelId.slice(0, -dated[0].length)
        if (base in models) { stats.droppedDated += 1; continue }
      }
      const rate = costToRate(model?.cost, opts.fx ?? DEFAULT_FX)
      if (rate === null) { stats.droppedNoCost += 1; continue }
      rows.push({ modelKey: `${sourceProvider}/${modelId}`, rate })
      stats.kept += 1
    }
  }
  for (const requested of opts.providers ?? DEFAULT_PROVIDERS) {
    const norm = normalizeProvider(requested)
    if (!Object.keys(data ?? {}).some(p => normalizeProvider(p) === norm)) stats.requestedMissing.push(requested)
  }
  rows.sort((a, b) => a.modelKey.localeCompare(b.modelKey))
  return { rows, stats }
}

/** Render rows as the YAML block body (already marker-free), INDENT-prefixed. */
export function renderYamlBody(rows, meta) {
  const lines = []
  let lastProvider = ''
  for (const { modelKey, rate } of rows) {
    const provider = modelKey.slice(0, modelKey.indexOf('/'))
    if (provider !== lastProvider) {
      lines.push(`${INDENT}# ${provider}`)
      lastProvider = provider
    }
    lines.push(`${INDENT}${modelKey}:`)
    lines.push(`${INDENT}  - inputMicrosPerMtok: ${rate.inputMicrosPerMtok}`)
    if (rate.cacheReadMicrosPerMtok !== undefined) lines.push(`${INDENT}    cacheReadMicrosPerMtok: ${rate.cacheReadMicrosPerMtok}`)
    if (rate.cacheWriteMicrosPerMtok !== undefined) lines.push(`${INDENT}    cacheWriteMicrosPerMtok: ${rate.cacheWriteMicrosPerMtok}`)
    lines.push(`${INDENT}    outputMicrosPerMtok: ${rate.outputMicrosPerMtok}`)
  }
  return lines.join('\n')
}

/**
 * Replace (or insert) the marker-delimited block in the bundle YAML. When the
 * markers are absent they are appended right after the last line that belongs
 * to the finance row's `prices:` map — i.e. just before the next `- id:` row.
 */
export function splicePrices(yaml, body, meta) {
  const beginIdx = yaml.indexOf(MARKER_BEGIN)
  const endIdx = yaml.indexOf(MARKER_END)
  const head = `${INDENT}${MARKER_BEGIN} source=${meta.source} updated=${meta.updated} fx=${meta.fx}`
  const tail = `${INDENT}${MARKER_END}`
  const block = body.length > 0 ? [head, body, tail].join('\n') : [head, tail].join('\n')
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const lineStart = yaml.lastIndexOf('\n', beginIdx) === -1 ? 0 : yaml.lastIndexOf('\n', beginIdx) + 1
    const before = yaml.slice(0, lineStart)
    const newlineAfterEnd = yaml.indexOf('\n', endIdx)
    const after = newlineAfterEnd === -1 ? '' : yaml.slice(newlineAfterEnd + 1)
    return `${before}${block}\n${after}`
  }
  if (beginIdx !== -1 || endIdx !== -1) throw new Error('finance-sync: half-present markers — fix the YAML manually')
  const anchor = yaml.lastIndexOf('- id: ui-finance')
  if (anchor === -1) throw new Error('finance-sync: no insertion anchor (- id: ui-finance) found')
  return `${yaml.slice(0, anchor)}${block}\n\n${yaml.slice(anchor)}`
}

async function main(argv) {
  const flag = name => argv.includes(`--${name}`)
  const value = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1] }
  if (flag('help')) { console.log('see scripts/sync-finance-prices.mjs header docs'); return }
  const fx = Number(value('fx', String(DEFAULT_FX)))
  const providersArg = value('providers', null)
  const providers = providersArg ? providersArg.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_PROVIDERS
  const dryRun = flag('dry-run')

  let text
  if (flag('file')) {
    text = await readFile(value('file'), 'utf8')
    console.log(`source: local file ${value('file')}`)
  } else {
    const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`fetch failed: HTTP ${response.status}`)
    text = await response.text()
    console.log(`source: ${SOURCE_URL}`)
  }
  const data = JSON.parse(text)

  const { rows, stats } = collectRows(data, { providers, fx, dated: flag('dated') })
  const updated = new Date().toISOString().replace(/\.\d+Z$/, 'Z').slice(0, 16) + 'Z'
  const body = renderYamlBody(rows, { fx, updated })
  console.log(`converted ${stats.kept} models across ${new Set(rows.map(r => r.modelKey.split('/')[0])).size} providers (fx=${fx})`)
  console.log(`skipped: ${stats.droppedDated} dated snapshots, ${stats.droppedNonToken} non-token, ${stats.droppedNoCost} without cost`)
  if (stats.requestedMissing.length > 0) console.log(`requested but absent upstream: ${stats.requestedMissing.join(', ')}`)

  const current = await readFile(BUNDLE_YML, 'utf8')
  const next = splicePrices(current, body, { source: 'models.dev/api.json', updated, fx })
  if (dryRun) {
    console.log('dry-run: bundle not written; diff preview:')
    for (const line of next.split('\n')) {
      if (line.includes(MARKER_BEGIN) || line.includes(MARKER_END)) console.log(line)
    }
    return
  }
  await writeFile(BUNDLE_YML, next)
  console.log(`wrote ${path.relative(process.cwd(), BUNDLE_YML.pathname)} (${current.length} -> ${next.length} bytes)`)
  console.log('next: pnpm install:profile && restart dogfood to serve the refreshed table')
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (invokedDirectly) await main(process.argv.slice(2)).catch(error => { console.error(error?.message ?? error); process.exitCode = 1 })