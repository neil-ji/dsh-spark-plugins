#!/usr/bin/env node
/**
 * 本地自用开发流水线：构建全部 workspace 包 -> 安装到 web profile。
 * 用法:
 *   node scripts/dev.mjs           # build + install-profile
 *   node scripts/dev.mjs --run     # 之后前台启动 dsh --profile web --port 3999
 */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const run = process.argv.includes('--run')

console.log('[dev] 1/2 构建全部 workspace 包 ...')
execSync('pnpm -r build', { cwd: ROOT, stdio: 'inherit' })

console.log('[dev] 2/2 安装到 web profile ...')
execSync('node scripts/install-profile.mjs', { cwd: ROOT, stdio: 'inherit' })

console.log('[dev] 完成。')
if (run) {
  console.log('[dev] 启动 dogfood: dsh --profile web --port 3999（Ctrl-C 退出）')
  execSync('dsh --profile web --port 3999', { cwd: ROOT, stdio: 'inherit' })
} else {
  console.log('[dev] 启动 dogfood: dsh --profile web --port 3999')
}
