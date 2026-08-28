/**
 * npm release page store: joins the npm Remote namespace (status.get,
 * package.check, trust.status, launch.script) into one page snapshot. All
 * methods are read-only or generate plain-text scripts — the UI performs no
 * writes, mirroring the connector's "npm credentials never enter the plugin"
 * design.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type {
  NpmLaunchScriptView, NpmPackageInfoView, NpmStatusView, NpmTokenStatusView,
  NpmTrustStatusView,
} from 'dsh-connector-npm-wire'

/** The mounted npm Remote namespace (created by ctx.remote.$mount). */
type NpmNamespace = TypertRemoteNamespaceMap['npm']

/** Page snapshot. */
export interface NpmUiState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  statusView: NpmStatusView | undefined
  /** Last single-package check (launch wizard). */
  check: NpmPackageInfoView | undefined
  /** Last trust status query (launch wizard). */
  trust: NpmTrustStatusView | undefined
  /** Generated first-release human script. */
  script: NpmLaunchScriptView | undefined
  /** Granular access token status (credential ref). */
  token: NpmTokenStatusView | undefined
}

/** Human text for a rejected wire/remote call. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Page controller (one per settings surface). */
export class NpmUiStore {
  readonly store: SnapshotStore<NpmUiState> = createSnapshotStore<NpmUiState>({
    status: 'idle', error: null, statusView: undefined,
    check: undefined, trust: undefined, script: undefined, token: undefined,
  })

  private generation = 0

  constructor(private readonly npm: NpmNamespace) {}

  /** Refetch only after the page has loaded once. */
  refreshIfLoaded(): void {
    if (this.store.getSnapshot().status === 'idle') return
    void this.load()
  }

  /** Load the registry + kit package status panel. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const result = await this.npm['status.get']()
      if (!result.ok) throw new Error(result.error.message)
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.error = null
        s.statusView = result.value
      })
      let token: NpmTokenStatusView | undefined
      try {
        const tokenResult = await this.npm['token.status']()
        if (tokenResult.ok) token = tokenResult.value
      } catch {
        token = undefined
      }
      if (generation === this.generation) this.store.update((s) => { s.token = token })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = messageOf(error)
      })
    }
  }

  /** Check one package name availability + metadata. */
  async checkPackage(name: string): Promise<string | undefined> {
    try {
      const result = await this.npm['package.check']({ name })
      if (!result.ok) return result.error.message
      this.store.update((s) => { s.check = result.value })
      return undefined
    } catch (error) {
      return messageOf(error)
    }
  }

  /** Query trust status for one package. */
  async queryTrust(pkg: string): Promise<string | undefined> {
    try {
      const result = await this.npm['trust.status']({ pkg })
      if (!result.ok) return result.error.message
      this.store.update((s) => { s.trust = result.value })
      return undefined
    } catch (error) {
      return messageOf(error)
    }
  }

  /** Generate the first-release human script (npm publish + npm trust). */
  async generateScript(args: {
    pkg: string
    repository: string
    dir?: string
    workflowFile?: string
  }): Promise<string | undefined> {
    try {
      const result = await this.npm['launch.script'](args)
      if (!result.ok) return result.error.message
      this.store.update((s) => { s.script = result.value })
      return undefined
    } catch (error) {
      return messageOf(error)
    }
  }
}
