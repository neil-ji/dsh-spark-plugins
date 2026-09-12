/**
 * 架构闸门（三道，全部可在 CI 里零依赖运行）：
 *
 *   1. orphans    —— workspace 孤包：`packages/*` 里的每个包都必须落在
 *                    `plugin-registry.json` 的插件 + workspace 依赖闭包内。
 *                    （退役世代 `dsh-spark-ui` 长期留在 workspace 里构建，就是这条漏的。）
 *   2. boundaries —— import 边界：按角色限制依赖边与半边职责，见 ALLOWED_EDGES / RULES。
 *   3. contracts  —— 契约漂移：wire 描述符声明的远端方法必须在宿主实现里存在；
 *                    finance 的两份手抄 manifest 必须彼此一致、与宿主成员一致。
 *                    `sourceLocation` 行号漂移默认只告警（--strict-locations 升级为失败）。
 *
 * 用法：
 *   node scripts/check-architecture.mjs [--only=orphans,boundaries,contracts] [--json] [--strict-locations]
 * 退出码：0 = 通过（可能带警告），1 = 有硬失败。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeClosure, readWorkspacePackages } from './lib/workspace.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const posix = (path) => path.split(sep).join('/')

/* ──────────────────────────── 角色与允许的依赖边 ──────────────────────────── */

/**
 * 包角色。角色决定「这个包允许依赖谁」，是整套边界规则的最小集合。
 * - app：dock（唯一允许静态 import 插件 UI 产物的包）
 * - client：出 web 客户端产物的插件半边
 * - host：宿主半边
 * - plugin-kit / ui-kit / wire：公共层叶子包，不得反向依赖任何插件
 * @param {object} pkg - package.json 内容
 */
export function inferRole(pkg) {
  if (pkg.name === 'dsh-spark-dock') return 'app'
  if (pkg.name === 'dsh-ui-kit') return 'ui-kit'
  if (pkg.name === 'dsh-spark-plugin-kit') return 'plugin-kit'
  if (String(pkg.name).endsWith('-wire')) return 'wire'
  if (pkg.dsh?.client?.platform !== undefined) return 'client'
  return 'host'
}

/** 角色 → 允许依赖的角色。`undefined` = 不限制（只有 app）。 */
export const ALLOWED_EDGES = {
  app: undefined,
  client: ['plugin-kit', 'ui-kit', 'wire', 'host'],
  host: ['wire', 'plugin-kit'],
  'plugin-kit': [],
  wire: [],
  'ui-kit': [],
}

/** 宿主编译期绝不允许出现的运行时依赖（会被打进宿主 lib/index.js）。 */
const HOST_FORBIDDEN = [
  { match: (spec) => spec === 'react' || spec === 'react-dom', code: 'host-react', valueOnly: true },
  { match: (spec) => spec === 'dsh-ui-kit', code: 'host-ui-kit', valueOnly: true },
  { match: (spec) => /^@deepseek-ai\/dsh-client-/.test(spec), code: 'host-platform-client', valueOnly: false },
  { match: (spec) => /^dsh-[^/]+\/(client|embed)$/.test(spec), code: 'host-client-entry', valueOnly: false },
]

/** wire 包必须保持协议纯净：只有 zod + typert 协议类型。 */
const WIRE_FORBIDDEN = [
  { match: (spec) => spec === 'react' || spec === 'react-dom', code: 'wire-react' },
  { match: (spec) => spec === '@deepseek-ai/cordis' || spec.startsWith('@deepseek-ai/cordis/'), code: 'wire-cordis' },
  { match: (spec) => /^@deepseek-ai\/dsh-client-/.test(spec), code: 'wire-platform-client' },
]

/* ──────────────────────────── import 解析 ──────────────────────────── */

/**
 * 去掉块注释与行注释：注释里写 `import { X } from 'dsh-ui-kit'` 是做文档说明，
 * 不是依赖（ui-kit 的 icons.tsx 就有一处），扫源码时必须先剥掉。
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const index = line.indexOf('//')
      if (index < 0) return line
      const head = line.slice(0, index)
      return head.includes("'") || head.includes('"') ? line : head
    })
    .join('\n')
}

/** `import type` / `export type` 前缀；inline `{ type A }` 保守地按 value 处理。 */
const FROM_RE = /\b(import|export)\s+(type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/g
const SIDE_EFFECT_RE = /\bimport\s*['"]([^'"]+)['"]/g
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g

/**
 * 提取一个源文件里的全部模块 specifier。
 * 用正则而不是 AST：`from` / 裸 `import` / `require` 三种写法都要覆盖，
 * 且多行 import 必须能匹配（所以不能按行匹配）。返回 `typeOnly` 标记，
 * 因为 `import type` 在构建期被完全擦除，不构成运行时耦合。
 * @param {string} rawSource
 * @returns {{spec: string, typeOnly: boolean}[]}
 */
export function collectImports(rawSource) {
  const source = stripComments(rawSource)
  const out = []
  for (const match of source.matchAll(FROM_RE)) out.push({ spec: match[3], typeOnly: match[2] !== undefined })
  for (const match of source.matchAll(SIDE_EFFECT_RE)) out.push({ spec: match[1], typeOnly: false })
  for (const match of source.matchAll(REQUIRE_RE)) out.push({ spec: match[1], typeOnly: false })
  return out
}

/** 半边判定：`src/client/**` 之外都算宿主半边（含 src/index.ts 与 *.remote-client.ts）。 */
export function halfOf(file) {
  return /(^|\/)src\/client\//.test(posix(file)) ? 'client' : 'host'
}

/** 这些角色没有「宿主半边」概念（纯客户端库 / 应用 / 契约包）。 */
const NO_HOST_HALF = new Set(['app', 'ui-kit'])

/**
 * 单个文件的边界检查（纯函数，便于单测）。
 * @param {{pkg: string, role: string, file: string, imports: {spec: string, typeOnly: boolean}[], roleOf: (name: string) => string | undefined}} input
 * @returns {{code: string, pkg: string, file: string, detail: string}[]}
 */
export function checkFileBoundaries({ pkg, role, file, imports, roleOf }) {
  const violations = []
  const half = halfOf(file)
  const push = (code, detail) => violations.push({ code, pkg, file, detail })
  for (const entry of imports) {
    const spec = entry.spec
    if (spec.startsWith('.') || spec.startsWith('node:')) continue
    // workspace 包名（含子路径，如 dsh-spark-plugin-kit/client）
    const bare = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    if (bare === pkg) continue // 自引用（包内想走公开入口）不算跨包依赖
    const targetRole = roleOf(bare)
    if (targetRole !== undefined) {
      const allowed = ALLOWED_EDGES[role]
      // 跨宿主依赖：type-only 属于编译期契约引用（如 npm 用 GitHubService 类型），放行；
      // 运行时（value）跨宿主依赖必须显式建模，不能靠 import 偷渡。
      const typeOnlyHostEdge = entry.typeOnly && role === 'host' && targetRole === 'host'
      if (allowed !== undefined && !allowed.includes(targetRole) && !typeOnlyHostEdge) {
        push('edge/' + role + '->' + targetRole, `${pkg} 不允许依赖 ${bare}（${targetRole}）：${spec}`)
      }
      // 插件 UI 产物的入口只允许 app 组装；<lib>/client 只允许 client 半边消费。
      // 只对 workspace 包生效 —— @deepseek-ai/dsh-client-*/client 是平台子路径。
      if (role !== 'app' && /\/embed$/.test(spec)) {
        push('embed-outside-app', `只有 app（dock）可以 import 插件 UI 产物：${spec}`)
      }
      if (role !== 'app' && role !== 'client' && /\/client$/.test(spec)) {
        push('client-entry-outside-client', '只有 client 半边可以 import <pkg>/client：' + spec)
      }
    }
    if (half === 'host' && !NO_HOST_HALF.has(role)) {
      for (const rule of HOST_FORBIDDEN) {
        if (!rule.valueOnly || !entry.typeOnly) {
          if (rule.match(spec)) push(rule.code, `宿主半边 import 了客户端专属依赖：${spec}`)
        }
      }
    }
    if (role === 'ui-kit' && spec.startsWith('@deepseek-ai/')) {
      push('ui-kit-platform', `ui-kit 必须零平台依赖（零 cordis）：${spec}`)
    }
    if (role === 'wire') {
      for (const rule of WIRE_FORBIDDEN) {
        if (rule.match(spec)) push(rule.code, `wire 必须保持协议纯净：${spec}`)
      }
    }
    // F7：dock 的 fairy 层是**播报呈现层** —— 只消费 kit 的播报总线（共享库允许），
    // 不得 import 任何领域契约（`*-wire`）或别的插件 UI，否则「文案归模块」又被拉回壳里。
    if (/(^|\/)dsh-spark-dock\/src\/client\/fairy\//.test(file)) {
      const sharedLib = bare === 'dsh-spark-plugin-kit' || bare === 'dsh-ui-kit'
      if (!sharedLib && (/^dsh-[^/]+-wire$/.test(spec) || /^dsh-[^/]+\/(client|embed)$/.test(spec))) {
        push('fairy-domain-import', `fairy 呈现层不得 import 领域契约 / 插件 UI：${spec}`)
      }
    }
  }
  return violations
}

/* ──────────────────────────── 文件遍历 ──────────────────────────── */

function walkSource(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'tests' || entry.name === 'test') continue
      walkSource(full, base, out)
    } else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/* ──────────────────────────── 1. 孤包 ──────────────────────────── */

/**
 * 找出既不在 plugin-registry.json、也不在 registry 插件 workspace 依赖闭包里的包。
 * @param {string} root
 */
export function findOrphanPackages(root) {
  const packages = readWorkspacePackages(root)
  const { closure } = computeClosure(root, packages)
  const orphans = []
  for (const [name, record] of packages) {
    if (!closure.has(name)) orphans.push({ name, rel: record.rel, reason: '不在 registry 闭包内（既非插件也非其依赖）' })
  }
  return { orphans, total: packages.size, closureSize: closure.size }
}

/* ──────────────────────────── 2. 边界 ──────────────────────────── */

/**
 * 扫描全部 workspace 包的 src，按角色/半边规则检查 import。
 * @param {string} root
 */
export function findBoundaryViolations(root) {
  const packages = readWorkspacePackages(root)
  const roleByName = new Map()
  for (const [name, record] of packages) roleByName.set(name, inferRole(record.pkg))
  const roleOf = (name) => roleByName.get(name)
  const violations = []
  let files = 0
  let imports = 0
  for (const [name, record] of packages) {
    const role = roleByName.get(name)
    for (const file of walkSource(join(record.dir, 'src'))) {
      files += 1
      const source = readFileSync(file, 'utf8')
      const specs = collectImports(source)
      imports += specs.length
      violations.push(...checkFileBoundaries({
        pkg: name,
        role,
        file: posix(relative(root, file)),
        imports: specs,
        roleOf,
      }))
    }
  }
  return { violations, files, imports, roles: [...roleByName].map(([name, role]) => ({ name, role })) }
}

/* ──────────────────────────── 3. 契约 ──────────────────────────── */

/**
 * wire 描述符 → 宿主实现的映射表。新增插件时在这里登记一处即可获得契约闸门。
 *
 * ADR-005 / P5 之后**每份契约只有一个源文件**（`dsh-*-wire` 或插件自带的
 * `src/wire.ts`）：host 与 client 两侧都从它 import，不再有「第二份手抄产物」
 * 可以漂移。闸门因此改为校验「同一份 wire 文件内部自洽」——
 * 描述符方法集必须与 `model.services[].members` 一致。
 */
export const CONTRACTS = [
  { id: 'github', wire: 'packages/dsh-github-wire/src/index.ts', host: 'packages/dsh-github/src/github-service.ts' },
  { id: 'npm', wire: 'packages/dsh-npm-wire/src/index.ts', host: 'packages/dsh-npm/src/npm-service.ts' },
  { id: 'spark-events', wire: 'packages/dsh-spark-wire/src/index.ts', host: 'packages/dsh-spark/src/events-service.ts' },
  { id: 'hippomemo-events', wire: 'packages/dsh-hippomemo/src/wire.ts', host: 'packages/dsh-hippomemo/src/events-service.ts' },
  { id: 'finance', wire: 'packages/dsh-finance-wire/src/index.ts', host: 'packages/dsh-finance/src/index.ts' },
]

/**
 * 从描述符/清单源码里抽出「声明的远端方法」。
 * 网关取实现名的规则是 `descriptor.implementation ?? descriptor.method`，
 * 所以这里也按同一规则落 implementation 字段。
 * @param {string} source
 * @returns {{method: string, implementation: string}[]}
 */
export function extractDeclarations(source) {
  const out = []
  const re = /method:\s*'([^']+)'(?:,\s*\n\s*implementation:\s*'([^']+)')?/g
  for (const match of source.matchAll(re)) out.push({ method: match[1], implementation: match[2] ?? match[1] })
  return out
}

/**
 * 抽出 method → sourceLocation 的映射（窗口匹配，避免跨到下一条描述符）。
 * @param {string} source
 * @returns {{method: string, file: string, line: number}[]}
 */
export function extractSourceLocations(source) {
  const out = []
  const re = /method:\s*'([^']+)'[\s\S]{0,2000}?sourceLocation:\s*\{\s*file:\s*'([^']+)',\s*line:\s*(\d+)/g
  for (const match of source.matchAll(re)) out.push({ method: match[1], file: match[2], line: Number(match[3]) })
  return out
}

/** 抽出 typert manifest 的 `members: [{ name: 'x' }]` 名称集合。 */
export function extractMembers(source) {
  const out = []
  const re = /members:\s*\[([\s\S]*?)\n\s*\]/g
  for (const block of source.matchAll(re)) {
    for (const member of block[1].matchAll(/name:\s*'([^']+)'/g)) out.push(member[1])
  }
  return out
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 宿主实现里是否存在该方法名（词边界匹配）。 */
export function implementsMethod(hostSource, name) {
  return new RegExp('\\b' + escapeRe(name) + '\\b').test(hostSource)
}

/** 找到方法定义所在行号（1-based，跳过注释行；找不到返回 null）。 */
export function implementationLine(hostSource, name) {
  const lines = hostSource.split('\n')
  const re = new RegExp('^\\s*(?:async\\s+)?' + escapeRe(name) + '\\s*[(<]')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue
    if (re.test(line)) return index + 1
  }
  return null
}

/**
 * 契约漂移检查。
 * @param {string} root
 * @param {{strictLocations?: boolean}} [options]
 */
export function findContractDrift(root, options = {}) {
  const failures = []
  const warnings = []
  const results = []
  for (const contract of CONTRACTS) {
    const wirePath = join(root, contract.wire)
    if (!existsSync(wirePath)) {
      failures.push({ contract: contract.id, code: 'wire-missing', detail: `找不到描述符文件 ${contract.wire}` })
      continue
    }
    const wireSource = readFileSync(wirePath, 'utf8')
    const hostSource = readFileSync(join(root, contract.host), 'utf8')
    const declared = extractDeclarations(wireSource)
    const missing = declared.filter((entry) => !implementsMethod(hostSource, entry.implementation))
    for (const entry of missing) {
      failures.push({
        contract: contract.id,
        code: 'implementation-missing',
        detail: `描述符声明 ${entry.method}（实现 ${entry.implementation}），但 ${contract.host} 里找不到该实现`,
      })
    }
    // 单源内部自洽：同一份 wire 文件里声明了反射 members 时，它必须与
    // descriptors 的方法集完全一致（手写的 declaration 块最容易在这里脱节）。
    const methods = declared.map((entry) => entry.method).sort()
    const members = extractMembers(wireSource).sort()
    if (members.length > 0 && members.join(',') !== methods.join(',')) {
      failures.push({
        contract: contract.id,
        code: 'manifest-member-drift',
        detail: `${contract.wire} 的 members 与 descriptors 不一致：${members.join(',')} vs ${methods.join(',')}`,
      })
    }
    // sourceLocation 行号：默认告警，--strict-locations 升级为失败
    for (const location of extractSourceLocations(wireSource)) {
      const targetPath = join(root, location.file)
      if (!existsSync(targetPath)) {
        failures.push({ contract: contract.id, code: 'location-file-missing', detail: `sourceLocation 指向不存在的文件 ${location.file}` })
        continue
      }
      const targetSource = readFileSync(targetPath, 'utf8')
      const actual = implementationLine(targetSource, location.method)
      const declaredLine = location.line
      const content = targetSource.split('\n')[declaredLine - 1] ?? ''
      const ok = content.includes(location.method) || (actual !== null && actual === declaredLine)
      if (!ok) {
        const detail = `sourceLocation 行号漂移：${location.method} 声明 ${location.file}:${declaredLine}，实际在第 ${actual ?? '?'} 行`
        if (options.strictLocations === true) {
          failures.push({ contract: contract.id, code: 'location-stale', detail })
        } else {
          warnings.push({ contract: contract.id, code: 'location-stale', detail })
        }
      }
    }
    results.push({ contract: contract.id, declared: declared.length, methods: declared.map((entry) => entry.method) })
  }
  return { failures, warnings, results }
}

/* ──────────────────────────── 4. inject 面覆盖 ──────────────────────────── */

/**
 * 客户端半边用到的平台服务 → 必须写进该包 `export const inject`。
 *
 * 为什么单列一道：真宿主实测，插件用到 `ctx.slots` 而 inject 里没写，宿主会以
 * `cannot get property "slots" without inject` 让**整条 loader entry** 失败
 * （不是只丢那个模块）；`remote.credentials` 同理（面板渲染成加载失败）。
 * ADR-003 之前这些服务由 dock 代持，搬回插件后容易漏。
 */
const CLIENT_SERVICE_USES = [
  { service: 'slots', re: /\b(?:any)?[Cc]tx\.slots\b|\.slots\.inject\(/ },
  { service: 'locale', re: /\b(?:any)?[Cc]tx\.locale\b/ },
  { service: 'settingsScope', re: /\b(?:any)?[Cc]tx\.settingsScope\b|this\.ctx\.settingsScope\b/ },
  { service: 'remote.credentials', re: /\bremote\.credentials\./ },
  { service: 'remote', re: /\bremote\.\$mount\b|\bremote\.\$on\b|\bremote\.\$stream\b|\bremote\.[a-z]/ },
]

/** 从 client 入口源码里读出 `export const inject = [...]` 的成员。 */
export function extractInjectList(source) {
  const match = /export\s+const\s+inject\s*=\s*\[([^\]]*)\]/.exec(source)
  if (match === null) return null
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1])
}

/**
 * 检查每个带 `dsh.client` 的包：client 半边用到的服务是否都在 inject 里声明。
 * @param {string} root
 */
export function findInjectGaps(root) {  const packages = readWorkspacePackages(root)
  const violations = []
  let checked = 0
  for (const [name, record] of packages) {
    if (record.pkg.dsh?.client?.platform === undefined) continue
    const entryPath = join(record.dir, 'src/client/index.ts')
    if (!existsSync(entryPath)) continue
    const declared = extractInjectList(readFileSync(entryPath, 'utf8'))
    if (declared === null) {
      violations.push({ pkg: name, code: 'inject-missing', detail: `${name} 的 client 入口没有 export const inject` })
      continue
    }
    const used = new Set()
    for (const file of walkSource(join(record.dir, 'src/client'))) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const use of CLIENT_SERVICE_USES) {
        if (use.re.test(source)) used.add(use.service)
      }
    }
    checked += 1
    for (const service of used) {
      // `remote.credentials` 同时要求 `remote`（平台按服务分别授权）。
      if (!declared.includes(service)) {
        violations.push({
          pkg: name,
          code: 'inject-gap',
          detail: `${name} 的 client 半边用到 ctx.${service}，但 inject=[${declared.join(', ')}] 里没有它`,
        })
      }
    }
  }
  return { violations, checked }
}

/* ──────────────────────────── 5. 单产物（P4） ──────────────────────────── */

/**
 * P4 不变量：**一个插件只有一份客户端产物**（`lib/client.js` 平台 loader 形态）。
 *
 * 历史上每包还额外产出 `lib/embed.cjs`（给 dock 内嵌的第二产物，评审 F6）；
 * ADR-003 之后 dock 不再 import 任何插件 UI，第二产物已删除。这条闸门防止回潮：
 * `exports` 里不得再出现 `./embed`，`files` 里不得再列 `embed.cjs`，
 * `build.mjs` / `tsdown.config.mjs` 里也不得再构建 embed 入口。
 * （`src/client/embed.ts` 允许存在 —— 它只是组件级预览画布的**源码 barrel**。）
 *
 * @param {string} root
 */
export function findSecondProducts(root) {
  const packages = readWorkspacePackages(root)
  const violations = []
  let checked = 0
  for (const [name, record] of packages) {
    const exportsMap = record.pkg.exports ?? {}
    const files = Array.isArray(record.pkg.files) ? record.pkg.files : []
    checked += 1
    if (Object.prototype.hasOwnProperty.call(exportsMap, './embed')) {
      violations.push({ pkg: name, code: 'embed-export', detail: `${name} 仍导出 ./embed（第二产物已退役，见 P4/F6）` })
    }
    for (const entry of files) {
      if (String(entry).includes('embed')) {
        violations.push({ pkg: name, code: 'embed-file', detail: `${name} 的 files 仍列 embed 产物：${entry}` })
      }
    }
    for (const config of ['build.mjs', 'tsdown.config.mjs']) {
      const path = join(record.dir, config)
      if (!existsSync(path)) continue
      const source = stripComments(readFileSync(path, 'utf8'))
      if (/entryPoints:\s*\{[^}]*embed|entry:\s*\{[^}]*embed\s*:/.test(source)) {
        violations.push({ pkg: name, code: 'embed-build', detail: `${name} 的 ${config} 仍在构建 embed 入口` })
      }
    }
  }
  return { violations, checked }
}

/* ──────────────── 7. 禁止把 window 自定义事件当页内总线（F11） ──────────────── */

/**
 * 插件代码不得用 `window` 自定义事件当**页内总线**（评审 F11）。
 *
 * 为什么单列一道：`window` 事件是全局的、无类型的、且不随组件卸载自动撤销。
 * finance 曾用 `dsh-finance-dsh-override-changed` / `dsh-finance-open-config`
 * 在同一棵 React 树里传信号 —— 发送方与接收方都是 `FinanceCard` 的后代或它自己，
 * 于是「谁该刷新」变成靠全局广播约定，而不是靠 props 或共享 controller。
 * ADR-005 要求刷新策略收敛，所以把这条路封掉：
 *   - 跨插件/跨模块 → kit 的播报总线、SnapshotStore，或 typert stream；
 *   - 同一棵树内   → props / 共享 controller。
 *
 * 只认 `dsh-*` 前缀的自定义事件名：`resize` / `keydown` / `pointerdown` / `abort`
 * 这些浏览器原生事件不在管辖范围。
 *
 * @param {string} root
 */
export function findWindowBusUsage(root) {
  const packages = readWorkspacePackages(root)
  const violations = []
  let files = 0
  for (const [name, record] of packages) {
    for (const file of walkSource(join(record.dir, 'src'))) {
      files += 1
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const match of source.matchAll(/new CustomEvent\(\s*['"](dsh-[^'"]+)['"]/g)) {
        violations.push({
          pkg: name,
          file: posix(relative(root, file)),
          code: 'window-bus',
          detail: `${name} 用 window 自定义事件当页内总线：new CustomEvent('${match[1]}')`,
        })
      }
      for (const match of source.matchAll(/(?:add|remove)EventListener\(\s*['"](dsh-[^'"]+)['"]/g)) {
        violations.push({
          pkg: name,
          file: posix(relative(root, file)),
          code: 'window-bus',
          detail: `${name} 订阅 window 自定义事件当页内总线：'${match[1]}'`,
        })
      }
    }
  }
  return { violations, files }
}

/* ──────────────────────────── CLI ──────────────────────────── */

function parseArgs(argv) {
  const options = { only: ['orphans', 'boundaries', 'contracts', 'injects', 'products', 'windowbus'], json: false, strictLocations: false }
  for (const arg of argv) {
    if (arg === '--json') options.json = true
    else if (arg === '--strict-locations') options.strictLocations = true
    else if (arg.startsWith('--only=')) options.only = arg.slice('--only='.length).split(',').filter(Boolean)
  }
  return options
}

export function runChecks(root, options = {}) {
  const only = options.only ?? ['orphans', 'boundaries', 'contracts', 'injects', 'products', 'windowbus']
  const report = { orphans: null, boundaries: null, contracts: null, injects: null, products: null, windowbus: null, failures: 0, warnings: 0 }
  if (only.includes('orphans')) {
    const result = findOrphanPackages(root)
    report.orphans = result
    report.failures += result.orphans.length
  }
  if (only.includes('boundaries')) {
    const result = findBoundaryViolations(root)
    report.boundaries = result
    report.failures += result.violations.length
  }
  if (only.includes('contracts')) {
    const result = findContractDrift(root, { strictLocations: options.strictLocations === true })
    report.contracts = {
      ...result,
      failureCount: result.failures.length,
      warningCount: result.warnings.length,
    }
    report.failures += result.failures.length
    report.warnings += result.warnings.length
  }
  if (only.includes('injects')) {
    const result = findInjectGaps(root)
    report.injects = result
    report.failures += result.violations.length
  }
  if (only.includes('products')) {
    const result = findSecondProducts(root)
    report.products = result
    report.failures += result.violations.length
  }
  if (only.includes('windowbus')) {
    const result = findWindowBusUsage(root)
    report.windowbus = result
    report.failures += result.violations.length
  }
  return report
}

function main(argv) {
  const options = parseArgs(argv)
  const report = runChecks(ROOT, options)
  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.failures > 0 ? 1 : 0
    return
  }
  console.log('══ 架构闸门（孤包 / 边界 / 契约 / 注入面 / 单产物 / 页内总线） ══')
  if (report.orphans !== null) {
    const { orphans, total, closureSize } = report.orphans
    if (orphans.length === 0) console.log(`  ok    workspace 孤包        0 个（${total} 个包全在 registry 闭包内，闭包 ${closureSize} 个）`)
    for (const orphan of orphans) console.log(`  FAIL  孤包                 ${orphan.name}（${orphan.rel}）：${orphan.reason}`)
  }
  if (report.boundaries !== null) {
    const { violations, files, imports } = report.boundaries
    if (violations.length === 0) console.log(`  ok    依赖边界            0 处违规（扫描 ${files} 个文件 / ${imports} 条 import）`)
    for (const violation of violations) console.log(`  FAIL  ${violation.code.padEnd(20)} ${violation.detail}`)
  }
  if (report.contracts !== null) {
    const failures = report.contracts.failures ?? []
    const warnings = report.contracts.warnings ?? []
    for (const failure of failures) console.log(`  FAIL  契约漂移[${failure.contract}]     ${failure.detail}`)
    for (const warning of warnings) console.log(`  warn  契约漂移[${warning.contract}]     ${warning.detail}`)
    const totalDeclared = (report.contracts.results ?? []).reduce((sum, entry) => sum + entry.declared, 0)
    if (failures.length === 0) {
      console.log(`  ok    契约漂移            0 处硬漂移（${totalDeclared} 条远端方法声明全部有实现；${warnings.length} 处告警）`)
    }
  }
  if (report.injects !== null) {
    const { violations, checked } = report.injects
    if (violations.length === 0) console.log(`  ok    inject 面覆盖        ${checked} 个 client 插件用到的服务都写进了 inject`)
    for (const violation of violations) console.log(`  FAIL  ${violation.code.padEnd(20)} ${violation.detail}`)
  }
  if (report.products !== null) {
    const { violations, checked } = report.products
    if (violations.length === 0) console.log(`  ok    单产物（P4）         ${checked} 个包都只有一份客户端产物（无 ./embed 导出 / 构建 / files）`)
    for (const violation of violations) console.log(`  FAIL  ${violation.code.padEnd(20)} ${violation.detail}`)
  }
  if (report.windowbus !== null) {
    const { violations, files } = report.windowbus
    if (violations.length === 0) console.log(`  ok    window 事件总线     0 处（扫描 ${files} 个源文件，无 dsh-* 自定义事件）`)
    for (const violation of violations) console.log(`  FAIL  ${violation.code.padEnd(20)} ${violation.detail}（${violation.file}）`)
  }
  const verdict = report.failures > 0 ? 'FAIL' : 'PASS'
  console.log(`\n合计：硬失败 ${report.failures} 处 · 告警 ${report.warnings} 处\n结果：${verdict}`)
  if (report.warnings > 0) {
    console.log('（sourceLocation 行号漂移：描述符里的行号是生成器产物，手抄必然漂；单源 wire 不该带它）')
  }
  process.exitCode = report.failures > 0 ? 1 : 0
}

if (process.argv[1] !== undefined && posix(process.argv[1]).endsWith('scripts/check-architecture.mjs')) main(process.argv.slice(2))
