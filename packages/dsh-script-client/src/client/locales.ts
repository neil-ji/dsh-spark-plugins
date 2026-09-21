/** 脚本沉淀库 pane 与 dock chrome 的文案（zh + en）。 */
export const zh = {
  dockLabel: '脚本',
  dockName: '脚本',
  dockSub: '沉淀下来的多步操作 · 调用一次即计量',
  setupFailed: '脚本模块装配失败：宿主未提供 remote。重载插件后重试。',
  scriptsTitle: '脚本目录',
  unitScripts: '个',
  scriptsEmpty: '还没有脚本',
  scriptsEmptyHint: '常见多步操作会被自动沉淀为可复用脚本。',
  loading: '加载中…',
  stepUnit: '步',
  invokeCountUnit: '调用',
  invokeCountSuffix: '次',
  successRate: '成功率',
  invoke: '调用',
  invoking: '调用中…',
  invokedScript: '已调用',
  invokeFailed: '调用失败',
}

export const en = {
  dockLabel: 'Scripts',
  dockName: 'Scripts',
  dockSub: 'Stored multi-step procedures · invocation-metered',
  setupFailed: 'The script module failed to assemble: the host provides no remote. Reload the plugin and retry.',
  scriptsTitle: 'Script catalog',
  unitScripts: 'scripts',
  scriptsEmpty: 'No scripts yet',
  scriptsEmptyHint: 'Frequent multi-step procedures get captured as reusable scripts.',
  loading: 'Loading…',
  stepUnit: 'steps',
  invokeCountUnit: 'invoked',
  invokeCountSuffix: 'times',
  successRate: 'Success rate',
  invoke: 'Invoke',
  invoking: 'Invoking…',
  invokedScript: 'Invoked',
  invokeFailed: 'Invoke failed',
}

export type ScriptKey = keyof typeof zh
