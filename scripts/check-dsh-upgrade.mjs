#!/usr/bin/env node
/**
 * check-dsh-upgrade.mjs — dsh 升级体检（常态化破坏性改动追踪的第一道闸）。
 *
 * 思路：dsh 的每个 @deepseek-ai/dsh-* 包随 release 同步发版，版本号一致。
 * 本脚本把「当前钉版」与「npm latest」的**发布产物**（从 npm registry 拉下来的真实发布文件）
 * 逐包做 API 面 diff，并且只针对插件实际 import 的符号做存活检查，因此噪音很低：
 *   - 旧版产物：从 pnpm-workspace.yaml 的 overrides 解析钉版，registry tarball 拉取（不依赖本地安装）
 *   - 新版产物：npm latest 对应版本，registry tarball 拉取
 * 检查项：
 *   1. 插件源码 import 的命名符号是否还在新版 .d.ts 里（删符号 = 编译级破坏）
 *   2. Cordis Events 接口的事件名集合（插件用 $on/$emit 的字符串字面量必须在
 *      新版产物中仍出现，否则是静默失效的静默改名）
 *   3. 每个包的导出面变化（新增/删除/签名变更），按是否被插件用到分级
 *   4. 关键传递依赖（cordis / schemastery / cordis-plugin-loader）的版本区间是否漂移
 * 输出：控制台摘要 + 可选 Markdown 报告（docs/dsh-upgrade-reports/）。
 * 退出码：0 = 无破坏候选；1 = 发现破坏候选；2 = 检查过程出错。
 *
 * 用法：
 *   node scripts/check-dsh-upgrade.mjs            # 只打印摘要
 *   node scripts/check-dsh-upgrade.mjs --write-report   # 额外归档 Markdown 报告
 *   node scripts/check-dsh-upgrade.mjs --json     # 输出 JSON（便于 cron 消费）
 *   node scripts/check-dsh-upgrade.mjs --target 0.1.2-rc.1   # 指定目标版本（默认 npm latest）
 */

import { execFileSync } from 'node:child_process'
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, rmSync,
  readdirSync, statSync, copyFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPT_DIR, '..')
const TMP_BASE = process.env.DSH_UPGRADE_TMP || '/tmp/dsh-upgrade-check'

// 不随插件 import 走、但插件运行依赖其宿主行为的包（即使插件没直接 import 也要盯）
const HOST_WATCH = [
  'dsh-host-apiproxy',          // settings 命名空间服务、会话 API
  'dsh-host-plugin-inventory',  // 插件清单
  'dsh-cordis-host-runner',     // typert half 动态执行（new Function 门槛等）
  'dsh-client-ui-settings-plugins', // settings.plugin.item 卡片槽
  'dsh-session-projection',     // ProjectionDefinition 契约（finance 依赖）
  'dsh-session-projection-cache',
  'dsh-session-title',
  'dsh-session-persistence',
  'dsh-settings',
  'dsh-credentials',
  'dsh-typert-protocol',
  'dsh-typert-registry',
  'dsh-api-remotes',
  'dsh-client-runtime',
]
// 非 dsh 同步发版、但插件直接依赖的传递链，版本区间漂移要单独报警
const DRIFT_WATCH = ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/cordis-plugin-loader']

const argv = process.argv.slice(2)
const flags = {
  writeReport: argv.includes('--write-report'),
  json: argv.includes('--json'),
  quiet: argv.includes('--quiet'),
}
const targetIdx = argv.indexOf('--target')
const targetOverride = targetIdx >= 0 ? argv[targetIdx + 1] : undefined

/* ---------------- 小工具 ---------------- */

function sh(cmd, opts = {}) {
  try {
    return execFileSync('/bin/bash', ['-c', cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  } catch (e) {
    if (opts.allowFail) return ''
    throw new Error('command failed: ' + cmd + '\n' + (e.stderr || e.message))
  }
}

// semver 风格比较（含 -rc.N 预发布）：返回 1 / -1 / 0
function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = v.split('-')
    const nums = core.split('.').map((n) => parseInt(n, 10) || 0)
    return { nums, pre: pre || null }
  }
  const A = parse(a), B = parse(b)
  for (let i = 0; i < 3; i++) {
    if (A.nums[i] !== B.nums[i]) return A.nums[i] > B.nums[i] ? 1 : -1
  }
  if (A.pre === B.pre) return 0
  if (A.pre === null) return 1
  if (B.pre === null) return -1
  const seg = (p) => p.split('.').map((s) => (/^\d+$/.test(s) ? parseInt(s, 10) : s))
  const sa = seg(A.pre), sb = seg(B.pre)
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = sa[i], y = sb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x !== y) return (typeof x === 'number' && typeof y === 'number') ? (x > y ? 1 : -1) : (String(x) > String(y) ? 1 : -1)
  }
  return 0
}

function fetchJson(url) {
  return fetch(url, { headers: { accept: 'application/json' } }).then((r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url)
    return r.json()
  })
}

/* ---------------- 1. 读钉版 + 查 latest ---------------- */

function parsePinned() {
  const yaml = readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const pinned = {}
  let inOverrides = false
  for (const line of yaml.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('overrides:')) { inOverrides = true; continue }
    if (inOverrides && /^[a-z]/i.test(trimmed) && trimmed.endsWith(':')) { inOverrides = false; continue }
    if (!inOverrides) continue
    const m = trimmed.match(/^['"]?@deepseek-ai\/([a-z0-9-]+)['"]?:\s*['"]?([^\s'"#]+)['"]?\s*$/)
    if (m) pinned[m[1]] = m[2]
  }
  return pinned
}

function pluginImports() {
  // 扫描 packages/*/src 的 import，汇总 模块 -> 用到的命名符号
  const used = new Map() // moduleName -> Set<symbol>
  const events = new Set() // string literals in $on/$emit
  const root = path.join(ROOT, 'packages')
  if (!existsSync(root)) return { used, events }
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx|mjs)$/.test(e.name)) {
        const src = readFileSync(p, 'utf8')
        for (const m of src.matchAll(/from\s+['"]@deepseek-ai\/([a-z0-9-]+)(?:\/[a-z0-9-]+)?['"]/g)) {
          const mod = m[1]
          if (!used.has(mod)) used.set(mod, new Set())
        }
        for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]@deepseek-ai\/([a-z0-9-]+)['"]/g)) {
          for (const name of m[1].split(',')) {
            const clean = name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
            if (clean) used.get(m[2])?.add(clean)
          }
        }
        for (const m of src.matchAll(/import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s+from\s+['"]@deepseek-ai\/([a-z0-9-]+)['"]/g)) {
          used.get(m[2])?.add('default:' + m[1])
        }
        for (const m of src.matchAll(/\$on(?:ce)?\(\s*['"]([^'"]+)['"]/g)) events.add(m[1])
        for (const m of src.matchAll(/\$emit\(\s*['"]([^'"]+)['"]/g)) events.add(m[1])
      }
    }
  }
  walk(root)
  return { used, events }
}

/* ---------------- 2. 拉发布产物 ---------------- */

async function packPackage(pkg, version) {
  const dir = path.join(TMP_BASE, pkg, version)
  if (existsSync(path.join(dir, 'extracted'))) return dir
  mkdirSync(dir, { recursive: true })
  try {
    const url = 'https://registry.npmjs.org/@deepseek-ai/' + pkg + '/-/' + pkg + '-' + version + '.tgz'
    const res = await fetch(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(path.join(dir, 'pkg.tgz'), buf)
    sh('tar -xzf ' + JSON.stringify(path.join(dir, 'pkg.tgz')) + ' -C ' + JSON.stringify(dir) + ' --strip-components=1 2>/dev/null')
    writeFileSync(path.join(dir, 'extracted'), version)
    return dir
  } catch { return null }
}

// 并发池：把一批 async 任务按并发数跑完
async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length)
  let i = 0
  const worker = async () => {
    while (true) {
      const idx = i++
      if (idx >= tasks.length) return
      results[idx] = await tasks[idx]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return results
}

function listFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else { const rel = p.slice(dir.length + 1); if (!rel.endsWith('.tgz') && rel !== 'extracted') out.push(rel) }
    }
  }
  walk(dir)
  return out
}

function readAllDts(dir) {
  let out = ''
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.d.ts')) out += '\n///FILE ' + p.slice(dir.length + 1) + '\n' + readFileSync(p, 'utf8')
    }
  }
  walk(dir)
  return out
}

// 从 d.ts 提取「导出符号」集合（顶层 export）
function exportSymbols(dts) {
  const symbols = new Set()
  for (const m of dts.matchAll(/^export\s+(?:declare\s+)?(?:const|function|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm)) {
    symbols.add(m[1])
  }
  for (const m of dts.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const name of m[1].split(',')) {
      const clean = name.trim().split(/\s+as\s+/).pop().trim()
      if (clean) symbols.add(clean)
    }
  }
  for (const m of dts.matchAll(/^export\s+default\s+([A-Za-z_$][\w$]*)/gm)) symbols.add('default:' + m[1])
  for (const m of dts.matchAll(/^export\s+\{([^}]+)\}\s+from/gm)) {
    for (const name of m[1].split(',')) {
      const clean = name.trim().split(/\s+as\s+/).pop().trim()
      if (clean) symbols.add(clean)
    }
  }
  return symbols
}

// 提取 Cordis Events 接口里声明的事件名
function cordisEventNames(dts) {
  const names = new Set()
  const block = dts.match(/interface\s+Events\s*\{([\s\S]*?)\n\}/g)
  if (!block) return names
  for (const b of block) {
    for (const m of b.matchAll(/['"]([a-z0-9-]+(?:\/[a-z0-9-]+)+)['"]\s*\(/gi)) names.add(m[1])
  }
  return names
}

// 剥掉 JSDoc / 行注释（注释里的 {@link} 花括号和文本会干扰成员解析）
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

// 提取接口的成员名集合（顶层成员；嵌套对象字面量成员只记外层名）
function interfaceMembers(dts0, name) {
  const dts = stripComments(dts0)
  const out = new Set()
  const re = new RegExp('\\binterface\\s+' + name + '\\b', 'g')
  let m
  while ((m = re.exec(dts)) !== null) {
    let i = re.lastIndex
    if (dts[i] === '<') { let d = 1; i++; while (i < dts.length && d > 0) { if (dts[i] === '<') d++; else if (dts[i] === '>') d--; i++ } }
    while (i < dts.length && /\s/.test(dts[i])) i++
    if (dts.slice(i, i + 7) === 'extends') { i += 7; while (i < dts.length && dts[i] !== '{') i++ }
    if (dts[i] !== '{') continue
    let depth = 1
    i++
    let member = ''
    while (i < dts.length && depth > 0) {
      const c = dts[i]
      if (c === '{') {
        if (depth === 1) {
          const lm = member.match(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:?/)
          if (lm && lm[1] !== 'new') out.add(lm[1])
          member = ''
        }
        depth++
      } else if (c === '}') {
        depth--
        if (depth === 0) break
        member = ''
      } else if (c === ';' && depth === 1) {
        const lm = member.match(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*[:)(<]/)
        if (lm && lm[1] !== 'new') out.add(lm[1])
        member = ''
      } else if (depth === 1) member += c
      i++
    }
  }
  return out
}

/* ---------------- 3. 主流程 ---------------- */

async function main() {
  const pinned = parsePinned()
  const versions = Object.values(pinned).filter(Boolean)
  if (!versions.length) { console.error('ERROR: pnpm-workspace.yaml overrides 里没有 @deepseek-ai/dsh-* 钉版'); process.exit(2) }
  // 当前 dsh release = 大多数包钉的版本
  const freq = {}
  for (const v of versions) freq[v] = (freq[v] || 0) + 1
  const current = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]

  let latest = targetOverride
  if (!latest) {
    try {
      const meta = await fetchJson('https://registry.npmjs.org/@deepseek-ai/dsh')
      latest = (meta['dist-tags'] && meta['dist-tags'].latest) || undefined
    } catch {
      console.error('ERROR: 无法访问 npm registry，请检查网络（可用 --target 指定版本）'); process.exit(2)
    }
  }
  const target = latest
  if (!target) { console.error('ERROR: 拿不到目标版本'); process.exit(2) }

  const { used, events } = pluginImports()

  if (compareVersions(target, current) <= 0) {
    const msg = 'dsh 无新版本：当前钉版 ' + current + '，npm latest ' + latest + '（target=' + target + '）'
    if (!flags.quiet) console.log(msg)
    if (flags.json) console.log(JSON.stringify({ ok: true, current, latest, target, findings: [] }))
    process.exit(0)
  }

  if (!flags.quiet) console.log('\ndsh 升级体检：' + current + ' → ' + target + '\n（watch 包数：' + (used.size + HOST_WATCH.length) + '，来源 npm 发布产物 diff）\n')

  // 被插件 import 的包 + 宿主关键包
  const watchSet = new Set([...used.keys(), ...HOST_WATCH].filter((n) => pinned[n] !== undefined))

  const findings = [] // { level: 'BREAKING'|'WATCH'|'INFO', pkg, detail }
  const driftFindings = []
  let packFailures = 0

  const pkgList = [...watchSet].sort()
  const tasks = pkgList.map((pkg) => async () => {
    const oldV = pinned[pkg]
    if (!oldV || oldV === target) return
    const [oldDir, newDir] = await Promise.all([packPackage(pkg, oldV), packPackage(pkg, target)])
    if (!oldDir || !newDir) { packFailures++; findings.push({ level: 'WATCH', pkg, detail: '产物拉取失败（old=' + oldV + ' new=' + target + '）' }); return }

    const oldFiles = new Set(listFiles(oldDir))
    const newFiles = new Set(listFiles(newDir))
    const removedFiles = [...oldFiles].filter((f) => !newFiles.has(f) && !/^README/.test(f))
    const addedFiles = [...newFiles].filter((f) => !oldFiles.has(f) && !/^README/.test(f))

    const oldDts = readAllDts(oldDir)
    const newDts = readAllDts(newDir)
    const oldSym = exportSymbols(oldDts)
    const newSym = exportSymbols(newDts)
    const removedSym = [...oldSym].filter((s) => !newSym.has(s))
    const addedSym = [...newSym].filter((s) => !oldSym.has(s))

    // 1) 插件实际用到的符号是否还活着
    const usedSyms = used.get(pkg) || new Set()
    const missingUsed = [...usedSyms].filter((s) => !newSym.has(s))
    if (missingUsed.length) {
      findings.push({ level: 'BREAKING', pkg, detail: '插件 import 的符号在新版消失: ' + missingUsed.join(', ') })
    }
    // 1a) 插件用到的接口：成员级 diff（字段改名/删除是编译级破坏，如 ProjectionDefinition.schema→stateSchema）
    for (const sym of usedSyms) {
      if (!oldSym.has(sym) || !newSym.has(sym)) continue
      const oldM = interfaceMembers(oldDts, sym)
      const newM = interfaceMembers(newDts, sym)
      if (!oldM.size) continue
      const removedM = [...oldM].filter((x) => !newM.has(x))
      if (removedM.length) {
        findings.push({ level: 'BREAKING', pkg, detail: '插件使用的接口 ' + sym + ' 移除了成员: ' + removedM.join(', ') })
      }
      const addedM = [...newM].filter((x) => !oldM.has(x))
      if (addedM.length) {
        findings.push({ level: 'INFO', pkg, detail: '插件使用的接口 ' + sym + ' 新增成员: ' + addedM.join(', ') })
      }
    }
    // 2) Cordis Events 事件名变化
    const oldEvents = cordisEventNames(oldDts)
    const newEvents = cordisEventNames(newDts)
    const removedEvents = [...oldEvents].filter((e) => !newEvents.has(e))
    if (removedEvents.length) {
      findings.push({ level: 'WATCH', pkg, detail: 'Cordis Events 移除了事件名: ' + removedEvents.join(', ') })
    }
    // 3) 删除的导出（未被插件用到）→ 提示级
    if (removedSym.length) {
      findings.push({ level: 'WATCH', pkg, detail: '导出符号移除: ' + removedSym.join(', ') })
    }
    if (removedFiles.length || addedFiles.length) {
      findings.push({ level: 'INFO', pkg, detail: '文件变化: -' + removedFiles.length + ' +' + addedFiles.length + ' (' + [...removedFiles, ...addedFiles].slice(0, 4).join(', ') + ')' })
    }
    if (addedSym.length) {
      findings.push({ level: 'INFO', pkg, detail: '新增导出 ' + addedSym.length + ' 个: ' + addedSym.slice(0, 6).join(', ') + (addedSym.length > 6 ? '…' : '') })
    }
    if (!flags.quiet) process.stdout.write('.')
  })
  await runPool(tasks, 8)
  if (!flags.quiet && pkgList.length) process.stdout.write('\n')

  // 4) 事件字符串字面量存活检查（跨所有 watch 包的新版产物）
  if (events.size) {
    let allNew = ''
    for (const pkg of watchSet) {
      const dir = await packPackage(pkg, target)
      if (dir) allNew += readAllDts(dir)
    }
    for (const pkg of watchSet) {
      const dir = await packPackage(pkg, target)
      if (!dir) continue
      for (const f of listFiles(dir)) {
        if (f.endsWith('.js')) allNew += readFileSync(path.join(dir, f), 'utf8')
      }
    }
    for (const ev of events) {
      if (!allNew.includes(ev)) {
        findings.push({ level: 'BREAKING', pkg: '(事件)', detail: "插件 $on/$emit 用的事件 '" + ev + "' 在新版产物中不再出现" })
      }
    }
  }

  // 5) 传递依赖区间漂移
  try {
    const newDsh = await fetchJson('https://registry.npmjs.org/@deepseek-ai/dsh/' + target)
    const deps = newDsh.dependencies || {}
    for (const dep of DRIFT_WATCH) {
      if (deps[dep]) driftFindings.push({ dep, range: deps[dep] })
    }
  } catch { /* 忽略 */ }

  const breaking = findings.filter((f) => f.level === 'BREAKING')
  const watch = findings.filter((f) => f.level === 'WATCH')
  const info = findings.filter((f) => f.level === 'INFO')

  const lines = []
  lines.push('# dsh 升级体检报告  ' + current + ' → ' + target)
  lines.push('- 时间：' + new Date().toISOString())
  lines.push('- watch 包：' + [...watchSet].length + ' 个')
  lines.push('')
  if (breaking.length) {
    lines.push('## 🔴 破坏性候选（' + breaking.length + '）')
    for (const f of breaking) lines.push('- **' + f.pkg + '**：' + f.detail)
    lines.push('')
  } else {
    lines.push('## ✅ 无破坏性候选')
    lines.push('')
  }
  if (watch.length) {
    lines.push('## 🟡 需关注（' + watch.length + '）')
    for (const f of watch) lines.push('- ' + f.pkg + '：' + f.detail)
    lines.push('')
  }
  if (info.length) {
    lines.push('## ℹ️ 提示（' + info.length + '）')
    for (const f of info) lines.push('- ' + f.pkg + '：' + f.detail)
    lines.push('')
  }
  if (driftFindings.length) {
    lines.push('## 🔄 传递依赖区间（新 dsh 声明）')
    for (const f of driftFindings) lines.push('- ' + f.dep + '@' + f.range)
    lines.push('')
  }
  if (packFailures) lines.push('⚠️ ' + packFailures + ' 个包产物拉取失败，结果不完整\n')
  lines.push('> 生成：node scripts/check-dsh-upgrade.mjs；完整验证请跑 pnpm dryrun:dsh-upgrade')

  const report = lines.join('\n')
  if (flags.writeReport) {
    const dir = path.join(ROOT, 'docs', 'dsh-upgrade-reports')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, new Date().toISOString().slice(0, 10) + '_' + current + '_to_' + target + '.md')
    writeFileSync(file, report)
    if (!flags.quiet) console.log('报告已写入：' + file)
  }

  if (flags.json) {
    console.log(JSON.stringify({ ok: breaking.length === 0, current, latest, target, breaking, watch, info, drift: driftFindings }, null, 2))
  } else {
    console.log(report)
  }
  process.exit(breaking.length ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2) })