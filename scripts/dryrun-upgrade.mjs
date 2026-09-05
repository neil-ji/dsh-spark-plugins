#!/usr/bin/env node
/**
 * dryrun-upgrade.mjs — dsh 升级第二道闸：在临时目录里做一次「真升级预演」。
 *
 * check-dsh-upgrade.mjs 负责快速扫出 API 面破坏候选；本脚本负责终极验证：
 * 把 monorepo 复制到 /tmp/dsh-upgrade-dryrun，把 pnpm-workspace.yaml 的
 * @deepseek-ai/dsh-* overrides（含 minimumReleaseAgeExclude）和根 package.json
 * devDependencies 全部钉到目标版本，干净 pnpm install，然后 pnpm -r typecheck。
 * 任何插件包的编译失败都会被如实报告——这是「升级会不会崩」的最强证据。
 *
 * 用法：
 *   node scripts/dryrun-upgrade.mjs                      # 目标 = npm latest
 *   node scripts/dryrun-upgrade.mjs --target 0.1.2-rc.1  # 指定版本
 *   node scripts/dryrun-upgrade.mjs --keep               # 保留临时目录不清理
 *   node scripts/dryrun-upgrade.mjs --hold dsh-client-runtime,dsh-host-apiproxy
 *     # 混合钉版：指定包保持现钉版不升（上游漏发/已移除但本地仍需时用），可多次或逗号分隔
 * 退出码：0 = typecheck 全绿；1 = 有包编译失败；2 = 过程出错。
 * 不触碰：本仓库、~/.dsh/profiles/web（3080/3999）、全局 dsh 安装。
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPT_DIR, '..')
const WORK = process.env.DSH_DRYRUN_DIR || '/tmp/dsh-upgrade-dryrun'

const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const targetIdx = argv.indexOf('--target')
const targetOverride = targetIdx >= 0 ? argv[targetIdx + 1] : undefined
const holdPkgs = new Set(
  argv
    .flatMap((a, i) => (a === '--hold' && argv[i + 1] ? [argv[i + 1]] : []))
    .flatMap((s) => s.split(','))
    .map((s) => s.trim().replace(/^@deepseek-ai\//, ''))
    .filter(Boolean),
)

function sh(cmd, opts = {}) {
  const r = spawnSync('/bin/bash', ['-c', cmd], { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'], ...opts })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
function shOut(cmd) {
  const r = spawnSync('/bin/bash', ['-c', cmd], { encoding: 'utf8' })
  return r.stdout ? r.stdout.trim() : ''
}

async function npmLatest() {
  const r = await fetch('https://registry.npmjs.org/@deepseek-ai/dsh', { headers: { accept: 'application/json' } })
  const j = await r.json()
  return j['dist-tags'] && j['dist-tags'].latest
}

// 把 yaml 里 @deepseek-ai/dsh-* 的钉版替换成 target（overrides + minimumReleaseAgeExclude）
function rewriteYaml(yaml, target, hold) {
  const lines = yaml.split('\n')
  const out = []
  for (const line of lines) {
    if (/^\s*['"]?@deepseek-ai\/dsh-[a-z0-9-]+['"]?:\s*['"]?[^\s'"#]+['"]?\s*$/.test(line)) {
      const held = [...hold].some((h) => line.includes('@deepseek-ai/' + h + "'") || line.includes('@deepseek-ai/' + h + ':'))
      if (held) { out.push(line); continue }
      out.push(line.replace(/:\s*['"]?[^\s'"#]+['"]?\s*$/, ': ' + JSON.stringify(target)))
    } else if (/^\s*-\s+['"]?@deepseek-ai\/dsh-[a-z0-9-]+@[^'"]+['"]?\s*$/.test(line)) {
      const held = [...hold].some((h) => line.includes('@deepseek-ai/' + h + '@'))
      if (held) { out.push(line); continue }
      out.push(line.replace(/@[^'"]+['"]?\s*$/, '@' + target + (line.trimEnd().endsWith("'") ? "'" : '')))
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}

function rewriteRootPkg(json, target, hold) {
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = json[section]
    if (!deps) continue
    for (const name of Object.keys(deps)) {
      if (name.startsWith('@deepseek-ai/dsh-') && !hold.has(name.replace('@deepseek-ai/', ''))) deps[name] = target
    }
  }
  return json
}

async function main() {
  const target = targetOverride || (await npmLatest())
  if (!target) { console.error('ERROR: 拿不到目标版本（可用 --target 指定）'); process.exit(2) }

  console.log('dry-run 升级预演：钉版 → ' + target)
  console.log('工作目录：' + WORK)

  if (existsSync(WORK)) rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })

  // 1. 复制仓库（排除 node_modules/.git/lock）
  const rsync = sh('rsync -a --exclude node_modules --exclude .git --exclude pnpm-lock.yaml --exclude dist --exclude lib ' + ROOT + '/ ' + WORK + '/')
  if (rsync.status !== 0) { console.error('rsync 复制失败'); process.exit(2) }

  // 2. 重写钉版
  const yamlPath = path.join(WORK, 'pnpm-workspace.yaml')
  writeFileSync(yamlPath, rewriteYaml(readFileSync(yamlPath, 'utf8'), target, holdPkgs))
  const pkgPath = path.join(WORK, 'package.json')
  const pkgJson = rewriteRootPkg(JSON.parse(readFileSync(pkgPath, 'utf8')), target, holdPkgs)
  writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n')

  console.log('已重写 pnpm-workspace.yaml / package.json 钉版为 ' + target + (holdPkgs.size ? '（hold 不升：' + [...holdPkgs].join(', ') + '）' : ''))

  // 3. 干净安装
  console.log('\n[pnpm install] …')
  const inst = sh('cd ' + WORK + ' && set -o pipefail; pnpm install --reporter=append-only 2>&1 | tail -25', { stdio: ['ignore', 'inherit', 'inherit'] })
  if (inst.status !== 0) {
    console.error('\n❌ pnpm install 失败（网络 / 版本解析 / minimumReleaseAge 等）')
    process.exit(1)
  }
  console.log('pnpm install 完成')

  // 4. typecheck
  console.log('\n[pnpm -r typecheck] …')
  const tc = sh('cd ' + WORK + ' && set -o pipefail; pnpm -r typecheck 2>&1 | tail -60', { stdio: ['ignore', 'inherit', 'inherit'] })
  if (tc.status === 0) {
    console.log('\n✅ typecheck 全绿 —— 钉版 ' + target + ' 与当前插件源码兼容')
  } else {
    console.log('\n❌ typecheck 失败 —— 存在编译级破坏，升级前必须修复（见上方报错）')
  }
  if (keep) console.log('临时目录保留：' + WORK + '（pnpm dryrun:dsh-upgrade --keep）')
  process.exit(tc.status === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2) })