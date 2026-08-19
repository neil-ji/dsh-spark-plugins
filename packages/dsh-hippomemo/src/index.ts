/**
 * dsh-hippomemo Host entry.
 */
import { MemoryService } from './memory-service.ts'

export { MemoryService } from './memory-service.ts'
export type { HippomemoConfig } from './memory-service.ts'
export { hippomemoDomainSpec } from './spec.ts'
export { MemoryCore, normalizeRecord, splitTags, tokenize } from './memory-core.ts'
export { buildExtractionPrompt, candidateToInput, collectTurnMessages, extractTextFromBlocks, parseCandidateMemories } from './memory-extract.ts'
export type * from './types.ts'

export default MemoryService
