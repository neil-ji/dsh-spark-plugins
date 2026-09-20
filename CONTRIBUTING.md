# 贡献指南（CONTRIBUTING）

本仓库是 DSH（DeepSeek Harness）第三方插件 monorepo。**动手前必须先读完
[AGENTS.md](./AGENTS.md)** —— 那是本仓库一切 AI Agent 与人类贡献者的统一研发规范唯一真源，
本文件不重复其内容，只讲「怎么把改动合进来」。

## 快速开始

```bash
pnpm install
pnpm build        # 构建全部包
pnpm typecheck    # 类型检查
pnpm test         # 单元测试（各包 vitest + 根 vitest）
```

想直接看界面而**不装 dsh**：

```bash
pnpm preview          # http://127.0.0.1:5180/  仿真 dsh web 外壳 + 真悬浮球
pnpm preview:verify    # 预览自检（123 项）
```

## 收尾前必跑（与 CI 同口径）

`build` 与 `typecheck` **不要并行**（typecheck 会读到半写的 `lib/` 产物，产生假
TS2307/TS2339），严格按顺序：

```bash
pnpm -r build && pnpm -r typecheck && pnpm test
pnpm check:all         # 架构 / 价格 / 对比度 / token / 版本 五道闸门
pnpm preview:verify    # 预览保真
```

动了 host、注册面或 stream 的改动，另需真宿主验收（见 AGENTS.md §1.2）：

```bash
pnpm sandbox:install && pnpm sandbox:up
node dev-harness/real-host-check.mjs    # 退出码必须为 0
```

## 提交规范

Conventional Commits，scope 用包短名（`finance` / `dock` / `kit` / `wire` …）：

```
feat(finance): 额度触达检测与窗口归因
fix(dock): 修复悬浮球视口重吸附
docs(agents): 更新收尾 checklist
```

**改插件 `src` 的 commit 必须同时 bump 该包 version** —— `check:version-bump` 会逐
commit 比对（剥离注释后逐字节比较），漏 bump 直接失败。纯注释/测试改动可免 bump。

破坏性改动加 `!`，并在 body 写清迁移路径。

## 两条硬规矩（最常踩）

1. **禁止用 `window` 当页内事件总线**：`packages/*/src` 里出现
   `new CustomEvent('dsh-*')` / `addEventListener('dsh-*')` 会被架构闸门硬失败。
   跨端事件一律走宿主 cordis `emit/on` + typert stream（AGENTS.md §2.4）。

2. **「面板能渲染」证明不了任何架构承诺**：网关在端点未注册时会静默退回 SRC 兜底，
   UI 照样能跑。任何注册类改动必须以 `/__dev/probe` 的 typert 注册面断言为准
   （endpoints / descriptors / resultMode === 'strict'）。

## dsh 升级

dsh 上游迭代很快，**只保证与最新版 dsh 兼容**。升级前跑两道闸：

```bash
pnpm check:dsh-upgrade      # 快检：API 面 diff + 符号存活，报告归档 docs/dsh-upgrade-reports/
pnpm dryrun:dsh-upgrade     # 真验：临时目录钉新版本 + 干净安装 + build + typecheck
```

完整流程见 [docs/UPGRADE-PROTOCOL.md](./docs/UPGRADE-PROTOCOL.md)。

> 第二道闸是真破坏的**唯一**可靠抓手。实测它抓到过 `assistant/chunk` 会话事件在
> 0.1.5-rc.2 被移除（TS2678 + event 收窄成 `never`）—— 第一道闸只报「导出符号移除」，
> 报不出这类事件联合的成员删除。

## 评审项

架构决策以评审项编号（F* / P* / W* / ADR-*）追踪，验收报告落
`docs/architecture-acceptance-*.md`。关闭评审项必须写清**关闭口径**（解决了哪条腿），
禁止一条 commit 宣称关掉两条腿。

## 许可

贡献即表示同意以 [MIT](./LICENSE) 许可发布。