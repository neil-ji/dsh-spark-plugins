/**
 * Shared wire contract for the dsh-github connector.

 * This package is dependency-free of Node-only modules (only zod + Typert
 * types) so BOTH the host bundle and the browser client bundle can import
 * it. The host registers GITHUB_HOST_CONTRIBUTION through ctx.typert.register;
 * the client mounts GITHUB_REMOTE_CONTRIBUTION through ctx.remote.$mount.
 * Keeping descriptors here makes the two sides impossible to drift.
 */
import { z } from 'zod'
import type {
  InvocationDescriptor, RemoteResult, TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'

/** Wire view of the github config. */
export interface GithubConfigView {
  apiBase: string
  gitName: string
  gitEmail: string
  gitProxy: string
  defaultVisibility: 'private' | 'public'
  allowCreateRepo: boolean
  allowPush: boolean
  allowPull: boolean
  allowPullRequest: boolean
  allowReview: boolean
  allowPages: boolean
  allowActions: boolean
  allowIssues: boolean
  allowRelease: boolean
}

/** Wire value of the github/proxy.test health probe. */
export interface GithubProxyTestValue {
  ok: boolean
  latencyMs: number
  host: string
  error: string | null
}

/** Wire value of the github/whoami connection test. */
export interface GithubWhoamiValue {
  login: string
  name: string | null
  htmlUrl: string
  scopes: string[]
  apiBase: string
}

export const configViewSchema = z.object({
  apiBase: z.string(),
  gitName: z.string(),
  gitEmail: z.string(),
  gitProxy: z.string(),
  defaultVisibility: z.union([z.literal('private'), z.literal('public')]),
  allowCreateRepo: z.boolean(),
  allowPush: z.boolean(),
  allowPull: z.boolean(),
  allowPullRequest: z.boolean(),
  allowReview: z.boolean(),
  allowPages: z.boolean(),
  allowActions: z.boolean(),
  allowIssues: z.boolean(),
  allowRelease: z.boolean(),
})

export const proxyTestRequestSchema = z.object({
  proxy: z.string().optional(),
})

export const proxyTestValueSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number(),
  host: z.string(),
  error: z.string().nullable(),
})

export const whoamiValueSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  htmlUrl: z.string(),
  scopes: z.array(z.string()),
  apiBase: z.string(),
})

export const whoamiRequestSchema = z.object({
  draftToken: z.string().optional(),
})

export const configPatchSchema = z.object({
  patch: z.record(z.string(), z.unknown()),
})

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'github/whoami': (request: { draftToken?: string }) => Promise<RemoteResult<GithubWhoamiValue>>
    'github/proxy.test': (request: { proxy?: string }) => Promise<RemoteResult<GithubProxyTestValue>>
    'github/config.get': () => Promise<RemoteResult<GithubConfigView>>
    'github/config.set': (request: { patch: Record<string, unknown> }) => Promise<RemoteResult<GithubConfigView>>
  }
  interface TypertRemoteNamespaceMap {
    github: {
      whoami: (request: { draftToken?: string }) => Promise<RemoteResult<GithubWhoamiValue>>
      'proxy.test': (request: { proxy?: string }) => Promise<RemoteResult<GithubProxyTestValue>>
      'config.get': () => Promise<RemoteResult<GithubConfigView>>
      'config.set': (request: { patch: Record<string, unknown> }) => Promise<RemoteResult<GithubConfigView>>
    }
  }
}

/** The three Remote invocations shared by the host and client sides. */
export const GITHUB_INVOCATIONS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-github#github/proxy.test',
    service: 'github',
    namespace: 'github',
    method: 'proxy.test',
    implementation: 'proxyTestRemote',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-github#ProxyTestRequest', schema: proxyTestRequestSchema },
      },
    ],
    result: { mode: 'strict', typeSymbol: 'dsh-github#GithubProxyTestValue', schema: proxyTestValueSchema },
  },
  {
    id: 'dsh-github#github/whoami',
    service: 'github',
    namespace: 'github',
    method: 'whoami',
    implementation: 'whoamiRemote',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-github#WhoamiRequest', schema: whoamiRequestSchema },
      },
    ],
    result: { mode: 'strict', typeSymbol: 'dsh-github#GithubWhoamiValue', schema: whoamiValueSchema },
  },
  {
    id: 'dsh-github#github/config.get',
    service: 'github',
    namespace: 'github',
    method: 'config.get',
    implementation: 'configGet',
    invocation: { kind: 'direct' },
    parameters: [],
    result: { mode: 'strict', typeSymbol: 'dsh-github#GithubConfigView', schema: configViewSchema },
  },
  {
    id: 'dsh-github#github/config.set',
    service: 'github',
    namespace: 'github',
    method: 'config.set',
    implementation: 'configSet',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-github#ConfigPatch', schema: configPatchSchema },
      },
    ],
    result: { mode: 'strict', typeSymbol: 'dsh-github#GithubConfigView', schema: configViewSchema },
  },
]

/** Host-side contribution: registered with ctx.typert.register in the host bundle. */
export const GITHUB_HOST_CONTRIBUTION: TypertContribution = {
  package: 'dsh-github',
  face: 'host',
  schemas: [
    { name: 'GithubConfigView', schema: configViewSchema },
    { name: 'GithubProxyTestValue', schema: proxyTestValueSchema },
    { name: 'GithubWhoamiValue', schema: whoamiValueSchema },
    { name: 'ProxyTestRequest', schema: proxyTestRequestSchema },
    { name: 'WhoamiRequest', schema: whoamiRequestSchema },
    { name: 'ConfigPatch', schema: configPatchSchema },
  ],
  model: { services: [], events: [], objects: [] },
  invocations: [...GITHUB_INVOCATIONS],
}

/** Client-side contribution: mounted with ctx.remote.$mount in the UI bundle. */
export const GITHUB_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: 'dsh-github',
  descriptors: [...GITHUB_INVOCATIONS],
}
