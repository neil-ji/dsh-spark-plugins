## 改了什么

<!-- 一两句话说清动机与结果，不要复述 diff。 -->

## 关联评审项

<!-- 架构决策以编号追踪（F* / P* / W* / ADR-*）；关闭评审项要写清关闭口径。 -->

## 收尾 Checklist（AGENTS.md §5）

- [ ] `pnpm -r build` → `pnpm -r typecheck` → `pnpm -r test` **顺序执行**，全绿
- [ ] `pnpm check:all` 全 PASS
- [ ] 改了发布输入（`src/**`、构建配置、清单）→ **同一个 commit 里 bump 了该包 version**
- [ ] UI 改动 → `pnpm preview:verify`（和 `pnpm check:contrast`）通过
- [ ] 动了 host / 注册面 / stream → `pnpm sandbox:install` + 重启宿主 + `real-host-check.mjs` 退出码 0，**且断言了注册面（不止看渲染）**
- [ ] commit 符合 Conventional Commits，scope 用包短名
- [ ] 新增的反模式防线加进了对应闸门脚本，而不是只写文档

## 破坏性改动

<!-- 有 `!` 的话，在这里写迁移路径。没有可删掉本节。 -->
