/**
 * 火花的语义召回（v2 §4.4，P13）—— **单一真源**，不抄第二份。
 *
 * 为什么单独成文件：`proposals.ts` 原本自带一版 `tokenize` / `jaccard`（涌现的
 * 去重与关联判定用它）。召回和涌现必须**同一个相似度口径**，否则「面板说两条像、
 * 召回说它们不像」这种漂移只有用户能发现（原则 6：契约用中性词，推导态只有一个
 * 计算者）。所以 tokenize / jaccard 提到这里，`proposals.ts` 反向 import。
 *
 * 口径：token Jaccard（latin 词 + CJK bigram）。**不引入向量检索**
 * （v2 §10 Non-goals），因此本模块零依赖、纯函数、可脱离 cordis 单测。
 */
import type { SparkView } from 'dsh-spark-wire'

/**
 * 切词：latin/数字按词，CJK 按**滑窗 bigram**（单字 run 兜底为 unigram）。
 *
 * 2026-09-21 修正（v1 遗留 bug）：旧实现把连续的汉字**累积进同一个 token**
 * （'火花召回路' → ['火花召回路']），于是「火花召回」查不到「火花语义召回」——
 * CJK 召回实际上一直不工作。真 bigram 才让中文火花互相可召回；这也是
 * `proposals.ts` 的 link 判定同时受益的一处修正（它用同一份口径）。
 *
 * 口径改动会同时影响召回与涌现：改这里必须两侧测试一起看。
 */
export function tokenize(s: string): string[] {
  const out: string[] = []
  let latin = ''
  let cjk = ''
  const flushLatin = (): void => {
    const w = latin.toLowerCase().trim()
    latin = ''
    if (w.length > 0) out.push(w)
  }
  const flushCjk = (): void => {
    if (cjk.length === 0) return
    if (cjk.length === 1) out.push(cjk)
    else for (let i = 0; i + 1 < cjk.length; i += 1) out.push(cjk.slice(i, i + 2))
    cjk = ''
  }
  for (const ch of s) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      flushCjk()
      latin += ch
    } else if (/[\u4e00-\u9fa5]/.test(ch)) {
      flushLatin()
      cjk += ch
    } else {
      flushLatin()
      flushCjk()
    }
  }
  flushLatin()
  flushCjk()
  return out
}

/** 两个 token 集合的 Jaccard 相似度；任一为空返回 0。 */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a)
  const B = new Set(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter += 1
  const union = A.size + B.size - inter
  return union === 0 ? 0 : inter / union
}

/** 召回打分的文本面：标题权重更高（标题重复两次 ≈ 命中标题比命中正文更像）。 */
function documentTokens(spark: SparkView): string[] {
  return [...tokenize(spark.title), ...tokenize(spark.title), ...tokenize(spark.content), ...tokenize(spark.tags.join(' '))]
}

export interface RelevantSpark {
  spark: SparkView
  score: number
}

export interface SelectRelevantOptions {
  /** 最多返回几条。 */
  limit?: number
  /**
   * 低于该分数视为不相关（默认 0.05：Jaccard 对短查询天然偏小）。
   * **零重合永远不算相关**（`score > 0` 是硬条件）—— `minScore: 0` 的语义是
   * 「任意重合即可」，不是「返回全量」。
   */
  minScore?: number
}

/**
 * 按查询召回相关火花（纯函数）。
 *
 * 排序判据必须**确定**：分数降序 → 更新时间降序 → id 升序，否则同一批候选在
 * 不同进程里注入顺序不同，模型看到的背景会漂。
 */
export function selectRelevant(
  sparks: readonly SparkView[],
  query: string,
  options: SelectRelevantOptions = {},
): RelevantSpark[] {
  const limit = options.limit ?? 3
  const minScore = options.minScore ?? 0.05
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0 || limit <= 0) return []
  return sparks
    .map(spark => ({ spark, score: jaccard(documentTokens(spark), queryTokens) }))
    .filter(entry => entry.score > 0 && entry.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.spark.updatedAt !== a.spark.updatedAt) return b.spark.updatedAt - a.spark.updatedAt
      return a.spark.id.localeCompare(b.spark.id)
    })
    .slice(0, limit)
}
