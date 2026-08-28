/**
 * Shared wire contract for the dsh-npm connector (npm release management UI).

 * Dependency-free of Node-only modules (only zod + Typert types) so BOTH the
 * host bundle (dsh-npm) and the browser client bundle (dsh-npm-ui) can import
 * it. The host registers NPM_HOST_CONTRIBUTION through ctx.typert.register;
 * the client mounts NPM_REMOTE_CONTRIBUTION through ctx.remote.$mount.

 * All Remote methods are READ-ONLY or produce plain-text scripts — npm
 * publishing is executed by the agent through a configured granular access
 * token (credential ref NPM_TOKEN, resolved per operation, never rendered
 * back). The Web UI tests a draft token before saving (npm/token.test, the
 * value crosses the wire one way and is never persisted), then stores the
 * token into the credential seam through the standard credentials API.
 */
import { z } from 'zod'
import type {
  InvocationDescriptor, RemoteResult, TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'

/** The four packages this kit publishes (order = dependency topology). */
export const NPM_KIT_PACKAGES = [
  'dsh-connector-wire',
  'dsh-connector-github-ui',
  'dsh-connector-github',
  'dsh-connector-npm',
] as const

/** One package's registry metadata projection. */
export interface NpmPackageInfoView {
  name: string
  exists: boolean
  latest: string | null
  description: string | null
}

/** Registry + kit package status snapshot for the status panel. */
export interface NpmStatusView {
  ok: boolean
  registry: string
  error: string | null
  packages: NpmPackageInfoView[]
}

/** One OIDC trusted-publisher configuration entry (registry trust endpoint). */
export interface NpmTrustEntryView {
  id: string
  type: string
  claims: Record<string, unknown>
  permissions: string[]
}

/** Trust status for one package: read through the configured token when
 * possible, otherwise returns the exact npmjs.com URL to check. */
export interface NpmTrustStatusView {
  pkg: string
  exists: boolean
  /** true when the trust list was read through the token (empty list = verified none). */
  verified: boolean
  /** Trusted-publisher entries when verified. */
  trusts: NpmTrustEntryView[]
  checkUrl: string
  detail: string
}

/** Granular access token status (credential ref resolved, never the value). */
export interface NpmTokenStatusView {
  /** true when the credential ref resolved to a non-empty token. */
  configured: boolean
  /** The credential-ref name (e.g. NPM_TOKEN). */
  source: string
  /** whoami login when the token authenticates; null otherwise. */
  login: string | null
  /** Human hint: what works now, or how to set the token up. */
  detail: string | null
}

/** Connection test for a draft token (before saving) or the stored token. */
export interface NpmTokenTestView {
  /** true when whoami answered with a username. */
  ok: boolean
  /** The npm account the token authenticates as; null on failure. */
  login: string | null
  /** Human hint when the test failed. */
  detail: string | null
}

export const packageInfoSchema = z.object({
  name: z.string(),
  exists: z.boolean(),
  latest: z.string().nullable(),
  description: z.string().nullable(),
})

export const statusViewSchema = z.object({
  ok: z.boolean(),
  registry: z.string(),
  error: z.string().nullable(),
  packages: z.array(packageInfoSchema),
})

export const tokenStatusValueSchema = z.object({
  configured: z.boolean(),
  source: z.string(),
  login: z.string().nullable(),
  detail: z.string().nullable(),
})

export const tokenTestRequestSchema = z.object({
  draftToken: z.string().optional(),
})

export const tokenTestValueSchema = z.object({
  ok: z.boolean(),
  login: z.string().nullable(),
  detail: z.string().nullable(),
})

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'npm/status.get': () => Promise<RemoteResult<NpmStatusView>>
    'npm/token.status': () => Promise<RemoteResult<NpmTokenStatusView>>
    'npm/token.test': (request: { draftToken?: string }) => Promise<RemoteResult<NpmTokenTestView>>
  }
  interface TypertRemoteNamespaceMap {
    npm: {
      'status.get': () => Promise<RemoteResult<NpmStatusView>>
      'token.status': () => Promise<RemoteResult<NpmTokenStatusView>>
      'token.test': (request: { draftToken?: string }) => Promise<RemoteResult<NpmTokenTestView>>
    }
  }
}

/** The Remote invocations shared by the host and client sides. */
export const NPM_INVOCATIONS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-npm#npm/status.get',
    service: 'npm',
    namespace: 'npm',
    method: 'status.get',
    implementation: 'statusRemote',
    invocation: { kind: 'direct' },
    parameters: [],
    result: { mode: 'strict', typeSymbol: 'dsh-npm#NpmStatusView', schema: statusViewSchema },
  },
  {
    id: 'dsh-npm#npm/token.status',
    service: 'npm',
    namespace: 'npm',
    method: 'token.status',
    implementation: 'tokenStatusRemote',
    invocation: { kind: 'direct' },
    parameters: [],
    result: { mode: 'strict', typeSymbol: 'dsh-npm#NpmTokenStatusView', schema: tokenStatusValueSchema },
  },
  {
    id: 'dsh-npm#npm/token.test',
    service: 'npm',
    namespace: 'npm',
    method: 'token.test',
    implementation: 'tokenTestRemote',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-npm#TokenTestRequest', schema: tokenTestRequestSchema },
      },
    ],
    result: { mode: 'strict', typeSymbol: 'dsh-npm#NpmTokenTestView', schema: tokenTestValueSchema },
  },
]

/** Host-side contribution: registered with ctx.typert.register in dsh-npm. */
export const NPM_HOST_CONTRIBUTION: TypertContribution = {
  package: 'dsh-npm',
  face: 'host',
  schemas: [
    { name: 'NpmPackageInfoView', schema: packageInfoSchema },
    { name: 'NpmStatusView', schema: statusViewSchema },
    { name: 'NpmTokenStatusView', schema: tokenStatusValueSchema },
    { name: 'NpmTokenTestView', schema: tokenTestValueSchema },
    { name: 'TokenTestRequest', schema: tokenTestRequestSchema },
  ],
  model: { services: [], events: [], objects: [] },
  invocations: [...NPM_INVOCATIONS],
}

/** Client-side contribution: mounted with ctx.remote.$mount in dsh-npm-ui. */
export const NPM_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: 'dsh-npm',
  descriptors: [...NPM_INVOCATIONS],
}