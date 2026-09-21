/**
 * 「纯模块」断言助手（Spec INV-14 的机械化形态）。
 *
 * 有些不变量靠**模块形状**守比靠人盯更可靠：「建议引擎只读」「口径单源」这类承诺，
 * 一旦有人顺手在里面加一次 `writeFile` 或 `ctx.emit`，评审未必看得见。这里把源码读出来
 * 做**剥注释后的字符串断言** —— 注释里解释"为什么不写库"是合法的，不算违规。
 */
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

/** 剥掉块注释与行注释（只用于「有没有这个符号」的粗判，不做语法分析）。 */
export function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '')
}

/**
 * 断言模块源码里不出现给定的符号。
 * @param url - 模块地址（`new URL('../src/x.ts', import.meta.url)`）。
 * @param forbidden - 禁止出现的符号（如 `node:fs` / `storage` / `ctx.emit`）。
 * @returns 剥注释后的源码（调用方需要时可用于进一步断言）。
 */
export async function assertPureModule(url: URL, forbidden: readonly string[]): Promise<string> {
  const code = stripComments(await readFile(url, 'utf8'))
  for (const needle of forbidden) {
    assert.equal(code.includes(needle), false, `纯模块不得出现 \`${needle}\`（${url.pathname}）`)
  }
  return code
}
