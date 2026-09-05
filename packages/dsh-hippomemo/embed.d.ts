/**
 * Type declarations for the `dsh-hippomemo/embed` library entry
 * (browser-only CJS bundle lib/embed.cjs, consumed by dsh-spark-dock).
 * Re-exports the generated client types; mirrors src/client/embed.ts.
 */
export { MemorySection } from './lib/types/client/MemorySection'
export type { MemorySectionProps } from './lib/types/client/MemorySection'
export { createHippomemoApi } from './lib/types/client/api'
export type { HippomemoApi } from './lib/types/client/api'
export { zh, en } from './lib/types/client/locales'
export type { HippomemoLocaleKey } from './lib/types/client/locales'
export declare const HIPPOMEMO_CSS: string[]
