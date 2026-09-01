/**
 * storage-domain declaration for HippoMemo.
 *
 * The domain name doubles as the storage-json unit name, so the durable file
 * is `$DSH_HOME/storages/hippomemo.json` under the web profile defaults.
 *
 * Version stays 2 on purpose: the JSON backend rejects a stored version that
 * differs from the descriptor, while a descriptor table missing from an older
 * file is initialized empty. Adding the citations table (and new record fields
 * with defaults) therefore migrates existing files without a version bump.
 */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { CitationRecord, MemoryId, MemoryRecord } from './types.ts'

const memoryId = z.string().min(1).transform(value => value as MemoryId)

/**
 * Self-healing loader for the bounded string lists (`searchTerms`/`tags`).
 * Records written before these caps existed can carry a single
 * whitespace-joined mega-term, which otherwise makes the whole storage
 * domain unopenable at boot (one bad record bricks every fresh launch).
 * Splitting on whitespace / truncating / deduping here means read paths
 * always succeed AND every later write-back persists the sanitized form.
 * Non-array shapes are passed through untouched so genuine corruption still
 * surfaces as a normal validation error.
 */
export function healBoundedStringList(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  const MAX_LEN = 50
  const MAX_ITEMS = 32
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue // scalar corruption -> let zod report it
    for (const part of item.split(/\s+/)) {
      if (part.length === 0) continue
      out.push(part.length > MAX_LEN ? part.slice(0, MAX_LEN) : part)
    }
    if (out.length >= MAX_ITEMS) break
  }
  return Array.from(new Set(out)).slice(0, MAX_ITEMS)
}

const memoryRecord = z.object({
  id: memoryId,
  kind: z.enum(['insight', 'decision', 'fact', 'preference', 'constraint']),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20_000),
  tags: z.preprocess(healBoundedStringList, z.array(z.string().min(1).max(50)).max(32).default([])),
  scope: z.enum(['global', 'workspace', 'project']).default('global'),
  workspacePath: z.string().nullable().default(null),
  globalProven: z.boolean().default(false),
  seenWorkspaces: z.array(z.string()).max(64).default([]),
  importance: z.number().min(0).max(1).default(0.5),
  status: z.enum(['active', 'archived', 'superseded', 'candidate']).default('active'),
  sourceSessionId: z.string().min(1),
  sourceAgentId: z.string().optional(),
  sourceTurn: z.number().int().nonnegative().optional(),
  revision: z.number().int().nonnegative().default(1),
  updatedBy: z.enum(['human', 'agent', 'system']).default('system'),
  supersedes: memoryId.nullable().default(null),
  supersededBy: memoryId.nullable().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
  expiresAt: z.number().nullable().default(null),
  relatedIds: z.array(memoryId).max(16).default([]),
  searchTerms: z.preprocess(healBoundedStringList, z.array(z.string().min(1).max(50)).max(32).default([])),
  recallCount: z.number().int().nonnegative().default(0),
  lastRecalledAt: z.number().nullable().default(null),
  citationCount: z.number().int().nonnegative().default(0),
  lastCitedAt: z.number().nullable().default(null),
  /** Provenance: id of the spark crystallized into this memory (Phase 2 reverse link). Optional; null for memories not from a spark. */
  sourceSparkId: z.string().nullable().default(null),
}) satisfies z.ZodType<MemoryRecord>

const citationRecord = z.object({
  id: memoryId,
  memoryId,
  sessionId: z.string().min(1),
  kind: z.enum(['id-ref', 'link']),
  ts: z.number(),
  snippet: z.string().max(400).optional(),
}) satisfies z.ZodType<CitationRecord>

export const hippomemoDomainSpec = defineDomain({
  name: 'hippomemo',
  version: 2,
  tables: {
    memories: domainTable<MemoryId, MemoryRecord>(memoryRecord),
    citations: domainTable<MemoryId, CitationRecord>(citationRecord),
  },
})
