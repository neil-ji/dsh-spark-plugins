/**
 * Shared wire contract for the dsh-npm connector (npm one-click launch UI).

 * Dependency-free of Node-only modules (only zod + Typert types) so BOTH the
 * host bundle (dsh-npm) and the browser client bundle (dsh-npm-ui) can import
 * it. The host registers NPM_HOST_CONTRIBUTION through ctx.typert.register;
 * the client mounts NPM_REMOTE_CONTRIBUTION through ctx.remote.$mount.

 * All Remote methods are READ-ONLY or generate plain-text scripts — npm
 * publishing is executed by the agent through a configured granular access
 * token (credential ref, never rendered back) or falls back to CI via OIDC.
 * This UI displays token status only and performs no write side effects.
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

/** Trust status for one package (account-private, so returns a check URL). */
export interface NpmTrustStatusView {
  pkg: string
  exists: boolean
  verified: boolean
  checkUrl: string
  detail: string
}

/** Generated first-release human script (npm publish + npm trust, 2FA). */
export interface NpmLaunchScriptView {
  status: 'generated'
  script: string
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

export const packageCheckRequestSchema = z.object({
  name: z.string(),
})

export const trustStatusRequestSchema = z.object({
  pkg: z.string(),
})

export const trustStatusValueSchema = z.object({
  pkg: z.string(),
  exists: z.boolean(),
  verified: z.boolean(),
  checkUrl: z.string(),
  detail: z.string(),
})

export const launchScriptRequestSchema = z.object({
  pkg: z.string(),
  repository: z.string(),
  dir: z.string().optional(),
  workflowFile: z.string().optional(),
})

export const launchScriptValueSchema = z.object({
  status: z.literal('generated'),
  script: z.string(),
})

export const tokenStatusValueSchema = z.object({
  configured: z.boolean(),
  source: z.string(),
  login: z.string().nullable(),
  detail: z.string().nullable(),
})

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'npm/status.get': () => Promise<RemoteResult<NpmStatusView>>
    'npm/package.check': (request: { name: string }) => Promise<RemoteResult<NpmPackageInfoView>>
    'npm/trust.status': (request: { pkg: string }) => Promise<RemoteResult<NpmTrustStatusView>>
    'npm/launch.script': (request: { pkg: string; repository: string; dir?: string; workflowFile?: string }) => Promise<RemoteResult<NpmLaunchScriptView>>
    'npm/token.status': () => Promise<RemoteResult<NpmTokenStatusView>>
  }
  interface TypertRemoteNamespaceMap {
    npm: {
      'status.get': () => Promise<RemoteResult<NpmStatusView>>
      'package.check': (request: { name: string }) => Promise<RemoteResult<NpmPackageInfoView>>
      'trust.status': (request: { pkg: string }) => Promise<RemoteResult<NpmTrustStatusView>>
      'launch.script': (request: { pkg: string; repository: string; dir?: string; workflowFile?: string }) => Promise<RemoteResult<NpmLaunchScriptView>>
      'token.status': () => Promise<RemoteResult<NpmTokenStatusView>>
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
    id: 'dsh-npm#npm/package.check',
    service: 'npm',
    namespace: 'npm',
    method: 'package.check',
    implementation: 'packageCheckRemote',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-npm#PackageCheckRequest', schema: packageCheckRequestSchema },
      },
    ],
    result: { mode: 'strict', typeSymbol: 'dsh-npm#NpmPackageInfoView', schema: packageInfoSchema },
  },
  {
    id: 'dsh-npm#npm/trust.status',
    service: 'npm',
    namespace: 'npm',
    method: 'trust.status',
    implementation: 'trustStatusRemote',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-npm#TrustStatusRequest', schema: trustStatusRequestSchema },
      },
    ],
    result: { mode: 'strict', typeSymbol: 'dsh-npm#NpmTrustStatusView', schema: trustStatusValueSchema },
  },
  {
    id: 'dsh-npm#npm/launch.script',
    service: 'npm',
    namespace: 'npm',
    method: 'launch.script',
    implementation: 'launchScriptRemote',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-npm#LaunchScriptRequest', schema: launchScriptRequestSchema },
      },
    ],
    result: { mode: 'strict', typeSymbol: 'dsh-npm#NpmLaunchScriptView', schema: launchScriptValueSchema },
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
]

/** Host-side contribution: registered with ctx.typert.register in dsh-npm. */
export const NPM_HOST_CONTRIBUTION: TypertContribution = {
  package: 'dsh-npm',
  face: 'host',
  schemas: [
    { name: 'NpmPackageInfoView', schema: packageInfoSchema },
    { name: 'NpmStatusView', schema: statusViewSchema },
    { name: 'NpmTrustStatusView', schema: trustStatusValueSchema },
    { name: 'NpmLaunchScriptView', schema: launchScriptValueSchema },
    { name: 'NpmTokenStatusView', schema: tokenStatusValueSchema },
    { name: 'PackageCheckRequest', schema: packageCheckRequestSchema },
    { name: 'TrustStatusRequest', schema: trustStatusRequestSchema },
    { name: 'LaunchScriptRequest', schema: launchScriptRequestSchema },
  ],
  model: { services: [], events: [], objects: [] },
  invocations: [...NPM_INVOCATIONS],
}

/** Client-side contribution: mounted with ctx.remote.$mount in dsh-npm-ui. */
export const NPM_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: 'dsh-npm',
  descriptors: [...NPM_INVOCATIONS],
}
