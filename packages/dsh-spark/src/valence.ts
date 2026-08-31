/**
 * Phase 6 valence heuristics (pure logic, no cordis).
 *
 * The amygdala layer of the cognitive model watches user messages for
 * strong emotional signals (anger, frustration, emphasis) and, when
 * detected, extracts the latent preference encoded in the message
 * (e.g. "you moron, why did you change file X" → preference: do not
 * modify file X without asking). The extracted preference is then
 * persisted as a HippoMemo kind='preference' record so it can
 * participate in the cognitive-filter recall.
 *
 * Pure heuristics — no LLM — keep the cost at zero per message. The
 * LLM-backed version (semantic preference extraction) is Phase 6.5.
 */

/** Score emotional intensity in [0, 1]. Pure heuristics. */
export function detectIntensity(text: string): number {
  if (text.length === 0) return 0
  let score = 0
  // 1) ALL CAPS runs: 2+ consecutive uppercase letters.
  const capsRuns = text.match(/[A-Z]{2,}/g)
  if (capsRuns !== null) score += Math.min(0.4, capsRuns.length * 0.1)
  // 2) Exclamation marks.
  const bangs = (text.match(/[!！]/g) ?? []).length
  score += Math.min(0.3, bangs * 0.1)
  // 3) Question marks (interrogative frustration).
  const qs = (text.match(/[?？]/g) ?? []).length
  score += Math.min(0.15, qs * 0.05)
  // 4) Strong Chinese frustration markers.
  const cns = (text.match(/[你您]怎么|[你您]为什么|[你您]凭什么|[他她它]怎么搞的|搞什么|什么破玩意|搞砸了/g) ?? []).length
  score += Math.min(0.5, cns * 0.25)
  // 5) Strong English frustration markers.
  const ens = (text.match(/\b(why|wtf|damn|shit|idiot|moron|stupid|broken)\b/gi) ?? []).length
  score += Math.min(0.4, ens * 0.2)
  return Math.min(1, score)
}

/**
 * Extract latent preferences from a high-intensity user message.
 * Returns an array of {verb, target, kind} candidates.
 *
 * kind ∈ 'do-not' | 'always' | 'never'
 *   do-not: user is forbidding something (high priority)
  *   always: user is asserting a regular preference
  *   never:  user is forbidding a regular action
 */
export interface PreferenceCandidate {
  kind: 'do-not' | 'always' | 'never'
  /** The action or subject being constrained. Free-form short text. */
  target: string
  /** Verbatim source phrase for traceability. */
  source: string
}

const STOP = new Set([
  'a', 'an', 'and', 'or', 'the', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by',
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '的', '了', '是', '在', '和', '与',
  '啊', '吗', '呢', '吧', '嘛', '哦', '呀',
])

/** Tokenize for preference extraction: keep words and CJK runs. */
function tokenize(text: string): string[] {
  const out: string[] = []
  let buf = ''
  const flushWord = (): void => {
    const w = buf.toLowerCase().trim()
    buf = ''
    if (w.length > 0 && !STOP.has(w)) out.push(w)
  }
  for (const ch of text) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      buf += ch
    } else {
      flushWord()
      if (/[\u4e00-\u9fa5]/.test(ch)) out.push(ch)
    }
  }
  flushWord()
  return out
}

/**
 * Pick the target subject from the raw captured phrase. The captured
 * phrase from the regex is already a coherent unit (e.g. 'run tests before
 * commit' or '先更新文档') — we just trim, strip trailing stopword-like
 * fragments, and cap at 60 chars to keep memory titles readable.
 */
function pickTarget(raw: string): string {
  let t = raw.trim().replace(/^[\s,，。！？\.!\?;:]+/, '').replace(/[\s,，。！？\.!\?;:]+$/, '')
  // Drop trailing stopwords that often trail an extracted target.
  const stopTail = /\s+(?:now|today|please|马上|现在|请|啊|吧|呢|嘛|哦|呀|谢谢)$/i
  t = t.replace(stopTail, '')
  if (t.length > 60) t = t.slice(0, 60).trim()
  return t
}

export function extractPreferences(text: string): PreferenceCandidate[] {
  const out: PreferenceCandidate[] = []
  const lower = text.toLowerCase()

  // Pattern 1: 'don't / do not / 别 / 不要 + verb-target'
  // End-marker (?:-|[\s\.\!\?，。！？]|$)) is optional so messages without
  // punctuation still match.
  const doNotPatterns: RegExp[] = [
    /\bdo(?:n't| not)\s+([a-z][a-z\s'-]{2,40}?)(?=\s*[\.\!\?,;]|$)/gi,
    /\bdon't\s+([a-z][a-z\s'-]{2,40}?)(?=\s*[\.\!\?,;]|$)/gi,
    /别\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
    /不要\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
    /别碰\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
    /别动\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
  ]
  for (const pattern of doNotPatterns) {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      const captured = (m[1] ?? '').trim()
      const target = pickTarget(captured)
      if (target.length > 0) {
        out.push({ kind: 'do-not', target, source: m[0] })
      }
    }
  }

  // Pattern 2: 'always / 总是 / 一直 + verb-target'
  const alwaysPatterns: RegExp[] = [
    /\balways\s+([a-z][a-z\s'-]{2,40}?)(?=\s*[\.\!\?,;]|$)/gi,
    /总是\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
    /一直\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
  ]
  for (const pattern of alwaysPatterns) {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      const captured = (m[1] ?? '').trim()
      const target = pickTarget(captured)
      if (target.length > 0) out.push({ kind: 'always', target, source: m[0] })
    }
  }

  // Pattern 3: 'never / 从不 / 从来不 + verb-target'
  const neverPatterns: RegExp[] = [
    /\bnever\s+([a-z][a-z\s'-]{2,40}?)(?=\s*[\.\!\?,;]|$)/gi,
    /从不\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
    /从来不\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
  ]
  for (const pattern of neverPatterns) {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      const captured = (m[1] ?? '').trim()
      const target = pickTarget(captured)
      if (target.length > 0) out.push({ kind: 'never', target, source: m[0] })
    }
  }

  // Dedup: same (kind, target) → keep first.
  const seen = new Set<string>()
  const deduped: PreferenceCandidate[] = []
  for (const c of out) {
    const key = c.kind + '|' + c.target.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(c)
  }
  return deduped
}

/**
 * Compose a HippoMemo-style preference record from a candidate.
 * Title is short, content holds the source phrase for traceability.
 */
export interface HippoPreferenceInput {
  kind: 'preference'
  title: string
  content: string
  tags: string[]
  scope: 'global' | 'workspace' | 'project'
  workspacePath: string | null
  globalProven: boolean
  importance: number
}

export function candidateToHippoPreference(
  candidate: PreferenceCandidate,
  workspacePath: string | null = null,
): HippoPreferenceInput {
  const verbLabel = candidate.kind === 'do-not' ? "Don't" : candidate.kind === 'always' ? 'Always' : 'Never'
  return {
    kind: 'preference',
    title: verbLabel + ' ' + candidate.target,
    content: candidate.source,
    tags: ['preference', 'valence-mined', candidate.kind],
    scope: 'global',  // preference crystallizes to global (user-level) by default
    workspacePath,
    globalProven: false,  // not yet seen cross-workspace
    importance: 0.7,  // mined preferences start strong
  }
}

/**
 * Decay: blend intensity over time. Older high-intensity signals fade.
 * Returns importance in [0, 1]. Phase 6 MVP uses simple time-decay;
 * Phase 6.5 can replace with explicit "preference decay" config.
 */
export function decayImportance(baseImportance: number, ageDays: number): number {
  const decay = Math.exp(-ageDays / 30)  // 30-day half-ish decay
  return baseImportance * (0.4 + 0.6 * decay)  // never drops below 40%
}
