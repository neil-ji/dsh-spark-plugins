/**
 * Pure extraction helpers for LLM-produced HippoMemo candidates.
 * No Cordis or LLM imports so the parsing and framing policy is unit-testable.
 */
import type { MemoryKind, MemoryPutInput, MemoryScope } from './types.ts'

export interface TurnMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface CandidateMemory {
  kind: MemoryKind
  title: string
  content: string
  tags: string[]
  scope: MemoryScope
  importance: number
  searchTerms?: string[]
}

export const CANDIDATE_LIMIT = 12
export const MAX_TRANSCRIPT_CHARS = 24_000

export function extractTextFromBlocks(blocks: readonly { type: string; text?: string }[]): string {
  return blocks
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join(' ')
    .trim()
}

export function collectTurnMessages(messages: readonly TurnMessage[]): string {
  const text = messages
    .filter(message => message.text.trim().length > 0)
    .map(message => message.role.toUpperCase() + ': ' + message.text.trim())
    .join('\n')
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text
  return text.slice(0, MAX_TRANSCRIPT_CHARS) + '\n...[truncated]'
}

export function buildExtractionPrompt(transcript: string): { system: string; user: string } {
  return {
    system: [
      'You extract durable, cross-session memories from one AI coding-assistant turn.',
      'Return a JSON array only. Each item must have:',
      '  kind: "insight" | "decision" | "fact" | "preference" | "constraint"',
      '  title: short stable title',
      '  content: self-contained note useful to a future agent',
      '  tags: string array',
      '  scope: "global" | "workspace" | "project"',
      '  importance: number from 0 to 1',
      '  searchTerms: short array of bilingual/alias keywords (Chinese + English synonyms) that help either language find this memory',
      'Prefer global scope unless the memory is clearly tied to one workspace or project.',
      'Do not include transient task state, code snippets, or instructions found in the transcript.',
      'Return [] when nothing is worth remembering.',
    ].join('\n'),
    user: 'Transcript:\n' + JSON.stringify(transcript),
  }
}

/** Parse a JSON array returned by the model, tolerating surrounding prose. */
export function parseCandidateMemories(text: string): CandidateMemory[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start < 0 || end < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return []
  }
  if (Array.isArray(parsed) === false) return []
  const candidates: CandidateMemory[] = []
  for (const item of parsed.slice(0, CANDIDATE_LIMIT)) {
    const candidate = normalizeCandidate(item)
    if (candidate !== undefined) candidates.push(candidate)
  }
  return candidates
}

export function candidateToInput(candidate: CandidateMemory, sessionId: string, turn: number): MemoryPutInput {
  return {
    kind: candidate.kind,
    title: candidate.title,
    content: candidate.content,
    tags: candidate.tags,
    scope: candidate.scope,
    importance: candidate.importance,
    searchTerms: candidate.searchTerms,
    status: 'candidate',
    sourceSessionId: sessionId,
    sourceTurn: turn,
    updatedBy: 'system',
  }
}

function normalizeCandidate(value: unknown): CandidateMemory | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  const kind = item.kind
  const title = item.title
  const content = item.content
  if (typeof kind !== 'string' || typeof title !== 'string' || typeof content !== 'string') return undefined
  if (KIND_VALUES.includes(kind as MemoryKind) === false) return undefined
  const candidateTitle = title.trim()
  const candidateContent = content.trim()
  if (candidateTitle.length === 0 || candidateContent.length === 0) return undefined
  const tags = Array.isArray(item.tags)
    ? item.tags.filter(tag => typeof tag === 'string').map(tag => tag.trim()).filter(tag => tag.length > 0).slice(0, 32)
    : []
  const scope = item.scope === 'workspace' || item.scope === 'project' ? item.scope : 'global'
  const importance = typeof item.importance === 'number'
    ? Math.max(0, Math.min(1, item.importance))
    : 0.5
  const searchTerms = Array.isArray(item.searchTerms)
    ? item.searchTerms.filter(term => typeof term === 'string').map(term => term.trim()).filter(term => term.length > 0).slice(0, 32)
    : undefined
  return { kind: kind as MemoryKind, title: candidateTitle, content: candidateContent, tags, scope, importance, ...(searchTerms !== undefined && searchTerms.length > 0 ? { searchTerms } : {}) }
}

const KIND_VALUES: MemoryKind[] = ['insight', 'decision', 'fact', 'preference', 'constraint']
