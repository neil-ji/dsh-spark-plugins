/**
 * Type declarations for the `dsh-hippomemo/embed` library entry
 * (browser-only CJS bundle lib/embed.cjs, consumed by dsh-spark-dock).
 * Re-exports the generated client types; mirrors src/client/embed.ts.
 */
export { MemorySection } from './lib/types/client/MemorySection'
export type { MemorySectionProps } from './lib/types/client/MemorySection'
export { createHippomemoApi, setHippomemoEventChannel } from './lib/types/client/api'
export type { HippomemoApi, HippomemoEventChannel, HippomemoEventsFace } from './lib/types/client/api'
export { startHippomemoEvents } from './lib/types/client/start'
export { zh, en } from './lib/types/client/locales'
export type { HippomemoLocaleKey } from './lib/types/client/locales'
export declare const HIPPOMEMO_CSS: string[]
