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
 *
 * 2026-09-23 增补（F7 挖掘管线修复）：`substanceTokens` / `boilerplateTokens` /
 * `jaccardWithout` —— 「两条火花像不像」这件事必须剔除**池级模板 token**，
 * 否则模板化产出的标题会让任意两条都互相「像」（实测 146/148 条 link 提议是纯伪影）。
 * 这三个函数同时服务 `proposals.ts` 的 link 判定与 valence 捕获前的跨会话去重。
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

/**
 * 「实质面」token：标题 + 正文，**不含 tags**，标题不重复加权。
 *
 * 与召回用的 `documentTokens` 的差别是**刻意的，不是漂移**（2026-09-23 写明）：
 *  - 召回问的是「这条火花和**用户这句话**有关系吗」。查询不是池成员，tags 是
 *    显式主题词，命中它们是好事，所以算进去。
 *  - link 问的是「**这两条火花**是同一个想法吗」。tags 是显式共享标签——那是
 *    `proposals.ts` 的 cluster 提议的职责；再算一遍等于同一份证据计两次。
 *
 * 实测（2026-09-23，18 条模板化火花池）：标题单算 46/153 对过 0.5 阈值、
 * `documentTokens` 面 72/153、**实质面 23/153**——tags 与标题模板前缀是主要放大源。
 */
export function substanceTokens(doc: { title: string; content: string }): string[] {
  return [...tokenize(doc.title), ...tokenize(doc.content)]
}

/** 池小于该规模时不启用模板抑制（见 `boilerplateTokens`）。 */
export const MIN_DOCS_FOR_BOILERPLATE = 5
/**
 * 默认的模板判定比例：出现在池里**过半**文档的 token 视为样板文字。
 *
 * 0.5 不是拍的，是量出来的。基准取 2026-09-23 的**清理前实库**（55 条，含 40 条
 * valence 挖掘）与**同一库剔除挖掘后的健康池**（14 条 active），候选窗口都是面板序前 30：
 *
 * | ratio | 污染池 link（旧口径 134） | 健康池 link | 污染池抑制 token 数 |
 * |---|---|---|---|
 * | 0.4 | 3 | 0 | 7（开始误伤实词） |
 * | **0.5** | **1** | **0** | **6** |
 * | 0.6 | 9 | 0 | 5 |
 * | 0.7 | 62 | 0 | 3 |
 *
 * 阈值越低越狠（健康池在各档都不误伤，因为它本来就没有模板）。0.5 在污染池上把
 * 134 条打到 1 条，同时**健康池抑制 0 个 token** —— 语义上也最直白：
 * **过半文档都有的 token 不具区分度**。
 */
export const DEFAULT_BOILERPLATE_DF_RATIO = 0.5

export interface BoilerplateOptions {
  /** 出现比例阈值，默认 {@link DEFAULT_BOILERPLATE_DF_RATIO}。 */
  ratio?: number
  /** 池规模下限，默认 {@link MIN_DOCS_FOR_BOILERPLATE}。 */
  minDocs?: number
}

/**
 * 池级**模板 token**（样板文字）：在超过 `ratio` 比例的文档里都出现的 token。
 *
 * 动机（2026-09-23 实测）：valence 挖掘出的标题共享模板前缀「用户偏好：Don't」，
 * `tokenize` 后 6 个 token 里占 5 个，于是**任意两条**的标题 Jaccard 都落在
 * 0.50~0.71 —— 库里 148 条 link 提议中 146 条剥掉前缀后真实相似度是 **0.00**。
 * 共享得越广的 token，区分度越低。
 *
 * 关键性质：**在健康池上是 no-op**。实测把清理前实库（55 条）剔除全部 valence
 * 挖掘记录后当池，ratio 0.5 下**抑制 0 个 token、link 判定逐对零变化**；只有池本身
 * 被模板淹没时才会咬。DF 只是池统计量，不需要（也不该）引入 IDF 权重或向量检索
 * （v2 §10 Non-goals）。
 *
 * 池小于 `minDocs` 时返回空集：那时任何共享词都会 DF=1.0，抑制掉会让 N=2 的池
 * 永远不比中——而「只有两条火花」正是 link 的主要用途。治病不能治出新病。
 */
export function boilerplateTokens(
  docs: readonly (readonly string[])[],
  options: BoilerplateOptions = {},
): ReadonlySet<string> {
  const ratio = options.ratio ?? DEFAULT_BOILERPLATE_DF_RATIO
  const minDocs = options.minDocs ?? MIN_DOCS_FOR_BOILERPLATE
  const out = new Set<string>()
  if (docs.length < minDocs || ratio <= 0) return out
  const df = new Map<string, number>()
  for (const tokens of docs) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  }
  for (const [token, count] of df) {
    if (count / docs.length > ratio) out.add(token)
  }
  return out
}

/** Jaccard，但先剔除 `excluded` 里的 token；剔除后任一为空返回 0。 */
export function jaccardWithout(
  a: readonly string[],
  b: readonly string[],
  excluded: ReadonlySet<string>,
): number {
  if (excluded.size === 0) return jaccard(a, b)
  return jaccard(a.filter(t => !excluded.has(t)), b.filter(t => !excluded.has(t)))
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
