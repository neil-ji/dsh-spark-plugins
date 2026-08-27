/**
 * dsh-hippomemo build:
 *  - tsdown 产出 host 侧（lib/*.js）与 client 侧（lib/client.js.tmp，见
 *    tsdown.config.mjs）
 *  - 本脚本在 tsdown 结束后把 client.js.tmp 原子 rename 成 lib/client.js：
 *    rename 在同一文件系统内是原子操作，读方（dsh web /plugins/... 路由）
 *    永远看到完整的旧文件或完整的新文件，不会遇到空/半截窗口。
 */
import { execSync } from 'node:child_process'
import { existsSync, renameSync } from 'node:fs'

execSync('tsdown', { stdio: 'inherit' })

const tmp = 'lib/client.js.tmp'
if (!existsSync(tmp)) throw new Error('build: expected tsdown to emit ' + tmp)
renameSync(tmp, 'lib/client.js')
