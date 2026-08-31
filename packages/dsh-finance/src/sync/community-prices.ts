/**
 * Runtime community-prices sync: USD/Mtok → integer CNY micros/Mtok, filter
 * dated/non-token/cost-less rows, key by `${provider}/${model}`. Pure functions
 * over a parsed models.dev document — no DSH imports so the host service can
 * fetch + shape at runtime, the build-script can splice YAML, and tests can
 * iterate without spinning up Cordis. The CLI script at
 * `scripts/sync-finance-prices.mjs` is the sibling implementation kept in
 * loose sync via mirror-tests; drift there is caught by
 * `tests/community-prices.test.ts`'s snapshot assertions.
 *
 * Source: models.dev/api.json (open-source AI model database, MIT). Each
 * provider entry has a `models: Record<modelId, { cost?: { input, output,
 * cache_read?, cache_write? } }>`; provider keys are unchanged across versions.
 *
 * @module dsh-spark-finance/sync
 */

/** The upstream dataset the runtime and CLI both pull from. */
export const SOURCE_URL = 'https://models.dev/api.json'

/** Bundle-patch YAML markers bracketing the auto-managed community block. */
export const MARKER_BEGIN = '# >>> FINANCE-COMMUNITY-PRICES-BEGIN'
export const MARKER_END = '# <<< FINANCE-COMMUNITY-PRICES-END'

/** CNY micros per USD — overridable per call (CLI: --fx). Maintenance estimate. */
export const DEFAULT_FX = 7.2

/** Default provider list the runtime and CLI both iterate. */
export const DEFAULT_PROVIDERS = ['openai', 'anthropic', 'google', 'zai', 'volcengine'] as const

/**
 * Dated-release suffix (8-digit YYYYMMDD): `model-20250901`. The host prefers
 * the undated sibling and drops the dated snapshot unless the caller forces
 * `dated: true`.
 */
const DATED_SUFFIX = /-(\d{8})$/

/** Non-token product variants: TTS / realtime / transcription etc. */
const NON_TOKEN = /(^|[._-])(tts|speech|transcribe|transcription|realtime|live-v2)($|[._-])/i

/** Case-insensitive, separator-insensitive provider name equality. */
export function normalizeProvider(name: string): string {
  return String(name).toLowerCase().replace(/[-_.]/g, '')
}

/** One finance micro-rate line for a single model. Cache fields optional. */
export interface CommunityPriceRate {
  inputMicrosPerMtok: number
  outputMicrosPerMtok: number
  cacheReadMicrosPerMtok?: number
  cacheWriteMicrosPerMtok?: number
}

/** One row kept after filter passes: modelKey + final rate. */
export interface CommunityPriceRow {
  modelKey: string
  rate: CommunityPriceRate
}

/** Stats reported back from collectRows for the UI / CLI summary line. */
export interface CommunityPriceStats {
  requestedProviders: readonly string[]
  requestedMissing: readonly string[]
  kept: number
  droppedDated: number
  droppedNonToken: number
  droppedNoCost: number
  /** Provider set actually written (a subset of requestedProviders ∩ upstream). */
  providers: readonly string[]
}

/** Options forwarded to collectRows. */
export interface CollectRowsOptions {
  /** Filter to these providers; defaults to `DEFAULT_PROVIDERS`. */
  providers?: readonly string[]
  /** CNY micros per USD. Defaults to `DEFAULT_FX`. */
  fx?: number
  /** When true, dated snapshots are kept even when an undated sibling exists. */
  dated?: boolean
}

/**
 * Convert a models.dev cost object (USD per Mtok) into finance integer micros
 * per Mtok at the given FX rate. Returns null when the entry has no usable
 * input/output pair (missing, NaN, or non-finite). Cache lines are optional
 * and simply omitted when absent.
 */
export function costToRate(cost: unknown, fx: number): CommunityPriceRate | null {
  if (!cost || typeof cost !== 'object') return null
  const input = Number((cost as { input?: unknown }).input)
  const output = Number((cost as { output?: unknown }).output)
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null
  if (input < 0 || output < 0) return null
  const toMicros = (usd: number): number => Math.round(usd * fx * 1_000_000)
  const rate: CommunityPriceRate = {
    inputMicrosPerMtok: toMicros(input),
    outputMicrosPerMtok: toMicros(output),
  }
  const cacheRead = Number((cost as { cache_read?: unknown }).cache_read)
  const cacheWrite = Number((cost as { cache_write?: unknown }).cache_write)
  if (Number.isFinite(cacheRead) && cacheRead >= 0) {
    rate.cacheReadMicrosPerMtok = toMicros(cacheRead)
  }
  if (Number.isFinite(cacheWrite) && cacheWrite >= 0) {
    rate.cacheWriteMicrosPerMtok = toMicros(cacheWrite)
  }
  return rate
}

/**
 * Fold a parsed models.dev document into `{provider}/{model}` price rows for
 * the requested providers. Dated release snapshots (model-YYYYMMDD) are dropped
 * when the undated sibling exists — pass `dated: true` to keep them.
 * Non-token product variants are always dropped. Result rows are sorted
 * deterministically by modelKey so a re-run matches byte-for-byte.
 */
export function collectRows(
  data: unknown,
  opts: CollectRowsOptions = {},
): { rows: readonly CommunityPriceRow[]; stats: CommunityPriceStats } {
  const requested = opts.providers ?? DEFAULT_PROVIDERS
  const fx = opts.fx ?? DEFAULT_FX
  const normalizedRequested = requested.map(normalizeProvider)
  const requestedMissingLocal: string[] = []
  const providersLocal: string[] = []
  const stats = {
    requestedProviders: [...requested],
    requestedMissing: requestedMissingLocal as readonly string[],
    kept: 0,
    droppedDated: 0,
    droppedNonToken: 0,
    droppedNoCost: 0,
    providers: providersLocal as readonly string[],
  } satisfies CommunityPriceStats
  const rows: CommunityPriceRow[] = []
  if (!data || typeof data !== 'object') {
    requestedMissingLocal.length = 0
    requestedMissingLocal.push(...requested)
    return { rows, stats }
  }
  const upstream = data as Record<string, unknown>
  const providerSets = new Set<string>()
  for (const [sourceProvider, entry] of Object.entries(upstream)) {
    if (!normalizedRequested.includes(normalizeProvider(sourceProvider))) continue
    if (!entry || typeof entry !== 'object') continue
    const models = (entry as { models?: unknown }).models
    if (!models || typeof models !== 'object') continue
    providerSets.add(sourceProvider)
    for (const [modelId, model] of Object.entries(models as Record<string, unknown>)) {
      if (NON_TOKEN.test(modelId)) {
        stats.droppedNonToken += 1
        continue
      }
      const dated = modelId.match(DATED_SUFFIX)
      if (dated && !opts.dated) {
        const base = modelId.slice(0, -dated[0].length)
        if (base in (models as Record<string, unknown>)) {
          stats.droppedDated += 1
          continue
        }
      }
      const rate = costToRate((model as { cost?: unknown })?.cost, fx)
      if (rate === null) {
        stats.droppedNoCost += 1
        continue
      }
      rows.push({ modelKey: `${sourceProvider}/${modelId}`, rate })
      stats.kept += 1
    }
  }
  for (const requestedName of requested) {
    const norm = normalizeProvider(requestedName)
    const found = Object.keys(upstream).some(p => normalizeProvider(p) === norm)
    if (!found) requestedMissingLocal.push(requestedName)
  }
  rows.sort((a, b) => a.modelKey.localeCompare(b.modelKey))
  providersLocal.length = 0
  providersLocal.push(...[...providerSets].sort())
  return { rows, stats }
}

/**
 * Fetch the upstream dataset and convert it. Returns a sync bundle: the rows
 * for the in-memory layer + the stats for the UI / CLI summary. Throws on
 * non-2xx HTTP, network failure, or unparseable JSON — the @Remote method
 * catches and converts to `ok: false` without altering the layer.
 */
export async function fetchCommunityPrices(
  options: CollectRowsOptions = {},
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ rows: readonly CommunityPriceRow[]; stats: CommunityPriceStats }> {
  const response = await fetchImpl(SOURCE_URL, { signal: signal ?? AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`finance: community sync HTTP ${response.status} from ${SOURCE_URL}`)
  const text = await response.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (cause) {
    throw new Error(`finance: community sync JSON parse failed: ${(cause as Error).message}`)
  }
  return collectRows(data, options)
}
