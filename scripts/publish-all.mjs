#!/usr/bin/env node
/**
 * 按依赖序发布全部插件包到 npm。
 *
 * 前置：
 *   1. npm login 已完成（浏览器 2FA 按提示确认）
 *   2. 已跑过 pnpm -r build（publish 只打包 files 字段声明的产物）
 *   3. 所有内部依赖用 workspace:* —— pnpm publish 会自动替换成实际版本
 *
 * 用法：
 *   pnpm publish:all            # 正式发布
 *   pnpm publish:all --dry-run  # 只看 tarball 内容，不上传
 */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 依赖序：被依赖者先发
const ORDER = [
  'dsh-ui-kit',
  'dsh-plugin-kit',
  'dsh-github-wire',
  'dsh-npm-wire',
  'dsh-github-ui',
  'dsh-npm-ui',
  'dsh-finance',
  'dsh-finance-client',
  'dsh-github',
  'dsh-npm',
  'dsh-finance-bundle',
]

const dry = process.argv.includes('--dry-run')
const root = fileURLToPath(new URL('..', import.meta.url))
const failed = []

for (const dir of ORDER) {
  const label = 'packages/' + dir
  console.log(`\n=== publish ${label} ${dry ? '(dry-run)' : ''} ===`)
  try {
    execSync(('pnpm publish --no-git-checks --access public ' + (dry ? '--dry-run' : '')).trim(), {
      cwd: root + label,
      stdio: 'inherit',
    })
  } catch {
    failed.push(label)
  }
}

if (failed.length) {
  console.error('\n以下包发布失败（通常是重名/网络/2FA 超时），修好后单独重发：\n  ' + failed.join('\n  '))
  process.exit(1)
}
console.log('\n全部发布完成 ✅')
