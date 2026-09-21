/**
 * hippomemo client styles — v3 architecture (4-quadrant + brain strip).
 * Principles:
 *  1. 直连 --spk-* 语义 token；**不用宿主别名（--dsw- 前缀）**（真宿主里这些名字由宿主
 *     自己定义，取值与 ui-kit 的桥接层不同，闸门与预览都测不到 —— acc-20260917 的 PCQA-007/016）。
 *  2. Single brand accent: preference is the only kind tinted blue; rest grayscale.
 *  3. Visual weight: brain strip > quadrants > list rows > meta grey.
 *  4. Every rule scoped under [data-plugin="dsh-hippomemo"] to avoid leakage.
 *  5. CSS-only content-visibility for long lists; reduced-motion animation toggle.
 *  Design-language scale (v3.1):
 *  - Radius: 6 (inner控件) / 8 (inputs) / 10 (containers) / 999 (tags)。
 *  - Font size: 10 (tag) / 11 (meta) / 12 (body-minor) / 13 (body) / 16 (page title)。
 *  - Spacing: 4 的倍数 (2 仅用于 tag 垂直内边距)。
 *  - Tag: 唯一基准 .hippomemo-tag + 语义修饰 -neutral/-brand/-success/-warn/-error/-mono。
 *  - Surface: 容器卡片共享 :is() 基规则；嵌套 surface 覆写 background: transparent。
 *  - !important 仅保留于 brain-dot 覆盖 StateDot 内联色（ui-kit 无 props 通道），其余禁用。
 */
export const HIPPOMEMO_CSS = [
  /* 面板内容列：横向内边距归壳（dock .dock-body 已是 var(--spk-pad-panel)），
     模块自己那 2px 会让页级分栏比火花窄 4px（PCQA-006）；纵向 4px 同理让分栏下沉 4px。
     分栏→内容的间距改走 --spk-gap-page（PCQA-007 的三档 0/12/14 收成一档）。 */
  '[data-plugin="dsh-hippomemo"] .hippomemo-section { display: flex; flex-direction: column; gap: var(--spk-gap-page); padding: 0 0 24px; color: var(--spk-label); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-tab { display: flex; flex-direction: column; gap: 12px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-title { margin: 0; font-size: var(--spk-text-xl); line-height: 26px; font-weight: 600; letter-spacing: -0.01em; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-intro { margin: 0; font-size: var(--spk-text-sm); line-height: 18px; color: var(--spk-label-2, var(--spk-label)); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-tabs { align-self: flex-start; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }',
  /* 进化页顶部操作行（财务形制）：运行身份在左、动作按钮在右。 */
  '[data-plugin="dsh-hippomemo"] .hippomemo-evolve-head { justify-content: space-between; }',
  /* 工具栏重做：筛选折叠面板 + 活跃筛选 chips */
  '[data-plugin="dsh-hippomemo"] .hippomemo-filters { border: 1px solid var(--spk-border); border-radius: var(--spk-radius-md); background: var(--spk-layer-2); margin-top: 8px; }',
  /* 2026-09：details/summary + 字符 ▸ 已退役，折叠统一 ui-kit Disclosure（标准 chevron）。
     这里只覆写 Disclosure 头部的密度与字重，使其与工具栏其他控件同形。 */
  '[data-plugin="dsh-hippomemo"] .hippomemo-filters > button { padding: 8px 12px; font-size: var(--spk-text-sm); font-weight: 600; color: var(--spk-label-2); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-filters > button:hover { background: var(--spk-hover); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-filters { border-radius: var(--spk-radius-md); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-filters-badge { min-width: 16px; height: 16px; border-radius: 8px; padding: 0 4px; background: var(--spk-brand, #3d5af0); color: var(--spk-on-brand); font-size: var(--spk-text-xs); font-weight: 700; line-height: 16px; text-align: center; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-filters-body { display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 12px 8px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-filter-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: var(--spk-radius-full); border: 1px solid var(--spk-border); background: var(--spk-layer-2); color: var(--spk-label-2); font-size: var(--spk-text-xs); cursor: pointer; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-chip:hover { color: var(--spk-label); border-color: var(--spk-border-2, var(--spk-border)); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-chip[aria-label] span { font-size: var(--spk-text-sm); color: var(--spk-label-3); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-chip-clear { border-style: dashed; color: var(--spk-label-3); }',
  /* Surface 基规则 —— 卡面 chrome 已统一由 ui-kit Card 提供（2026-09 结构统一，
     卡面容器迁 Card/variant=inset），这里只剩**非卡面**的内容面：列表行与详情正文。
     不得再给任何新类手写 border/radius/background 三件套 —— 那是在重造 Card。 */
  '[data-plugin="dsh-hippomemo"] :is(.hippomemo-todo-item, .hippomemo-pref-strip, .hippomemo-detail-content) { border: 1px solid var(--spk-border); border-radius: var(--spk-radius-md); background: var(--spk-surface-card); }',
  /* 卡片题由 ui-kit Card.title 提供（--spk-text-title 14px/600）；
     panel-count 保留：它现在是 Card actions 槽里的计数徽标。 */
  '[data-plugin="dsh-hippomemo"] .hippomemo-panel-count { margin-left: auto; font-size: var(--spk-text-xs); line-height: 16px; color: var(--spk-label-3, var(--spk-label-2)); font-variant-numeric: tabular-nums; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-strip { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px dashed var(--spk-border); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-region { display: inline-flex; align-items: center; gap: 8px; padding: 4px var(--spk-space-3); border-radius: var(--spk-radius-full); border: 1px solid transparent; background: transparent; color: inherit; font: inherit; font-size: var(--spk-text-sm); line-height: 18px; cursor: pointer; transition: background 160ms, border-color 160ms; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-region:hover { background: var(--spk-hover); border-color: var(--spk-label-3, var(--spk-border)); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-name { font-weight: 500; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-val { font-size: var(--spk-text-xs); color: var(--spk-label-3, var(--spk-label-2)); font-variant-numeric: tabular-nums; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-spacer { flex: 1; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-chev { transition: transform 160ms; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-chev-up { transform: rotate(180deg); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-narration { display: flex; align-items: center; gap: 8px; font-size: var(--spk-text-sm); line-height: 18px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-narration-lbl { color: var(--spk-label-3); font-size: var(--spk-text-xs); flex: none; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-narration-txt { color: var(--spk-label-2, var(--spk-label)); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-expand { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; padding-top: 8px; border-top: 1px solid var(--spk-border); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-card-desc { font-size: var(--spk-text-xs); line-height: 16px; color: var(--spk-label-2, var(--spk-label)); margin: 0 0 4px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-card-role { font-size: var(--spk-text-xs); line-height: 16px; color: var(--spk-label-3); }',
  /* Focus 可见性：手写交互控件统一 focus-visible 描边（ui-kit Button 自带，无需重复） */
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-region:focus-visible, [data-plugin="dsh-hippomemo"] .hippomemo-select:focus-visible, [data-plugin="dsh-hippomemo"] .hippomemo-chip:focus-visible, [data-plugin="dsh-hippomemo"] .hippomemo-filters > button:focus-visible { outline: 2px solid var(--spk-brand-fg, #2f46c8); outline-offset: 2px; }',
  '@keyframes hippomemo-pulse-pfc { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--spk-acc-hippomemo, #2563EB) 55%, transparent); } 100% { box-shadow: 0 0 0 14px transparent; } }',
  '@keyframes hippomemo-pulse-amy { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--spk-error, #DC2626) 55%, transparent); } 100% { box-shadow: 0 0 0 16px transparent; } }',
  '@keyframes hippomemo-pulse-hippo { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--spk-acc-github, #7C3AED) 55%, transparent); } 100% { box-shadow: 0 0 0 14px transparent; } }',
  '@keyframes hippomemo-pulse-cortex { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--spk-label-3, #64748B) 45%, transparent); } 100% { box-shadow: 0 0 0 12px transparent; } }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-region-anim-pfc .hippomemo-brain-dot { animation: hippomemo-pulse-pfc 0.9s ease-out; border-radius: 50%; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-region-anim-amy .hippomemo-brain-dot { animation: hippomemo-pulse-amy 0.9s ease-out; border-radius: 50%; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-region-anim-hippo .hippomemo-brain-dot { animation: hippomemo-pulse-hippo 0.9s ease-out; border-radius: 50%; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-region-anim-cortex .hippomemo-brain-dot { animation: hippomemo-pulse-cortex 0.9s ease-out; border-radius: 50%; }',
  '@media (prefers-reduced-motion: reduce) {\n    [data-plugin="dsh-hippomemo"] .hippomemo-brain-region-anim-pfc .hippomemo-brain-dot,\n    [data-plugin="dsh-hippomemo"] .hippomemo-brain-region-anim-amy .hippomemo-brain-dot,\n    [data-plugin="dsh-hippomemo"] .hippomemo-brain-region-anim-hippo .hippomemo-brain-dot,\n    [data-plugin="dsh-hippomemo"] .hippomemo-brain-region-anim-cortex .hippomemo-brain-dot { animation: none; }\n  }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-quadrant-empty { display: flex; align-items: center; gap: 8px; color: var(--spk-label-3); font-size: var(--spk-text-sm); line-height: 18px; margin: 0; padding: 8px 0; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-todo-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-todo-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: transparent; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-todo-icon { width: 22px; height: 22px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; flex: none; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-todo-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-todo-title { font-size: var(--spk-text-md); line-height: 20px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-todo-desc { display: flex; flex-wrap: wrap; gap: 8px 8px; align-items: center; font-size: var(--spk-text-xs); line-height: 16px; color: var(--spk-label-3, var(--spk-label-2)); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-todo-reason { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 360px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-todo-meta { color: var(--spk-label-3); font-variant-numeric: tabular-nums; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-todo-act { flex: none; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-recall-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-recall-item { display: flex; flex-direction: column; gap: 2px; padding: 8px 8px; border-radius: 6px; border-left: 3px solid var(--spk-border-2, transparent); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-recall-item-injected { border-left-color: var(--spk-brand, #2563EB); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-recall-item-suppressed { border-left-color: var(--spk-warn, #D97706); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-recall-item-cited { border-left-color: var(--spk-success, #16A34A); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-recall-when { font-size: var(--spk-text-xs); color: var(--spk-label-3); font-variant-numeric: tabular-nums; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-recall-what { font-size: var(--spk-text-md); line-height: 20px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-recall-m { font-weight: 500; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-recall-sub { color: var(--spk-label-2, var(--spk-label)); font-size: var(--spk-text-sm); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-strip { overflow: hidden; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-list { list-style: none; padding: 0; margin: 0; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-row { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--spk-border); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-row:last-child { border-bottom: none; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-row-confirmed { background: color-mix(in srgb, var(--spk-success, #16A34A) 4%, transparent); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-body { flex: 1; min-width: 0; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-text { font-size: var(--spk-text-md); line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-stats { display: flex; flex-wrap: wrap; gap: 0 8px; align-items: center; font-size: var(--spk-text-xs); line-height: 16px; color: var(--spk-label-3); margin-top: 2px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-hit { color: var(--spk-success, #16A34A); font-weight: 500; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-decay { color: var(--spk-warn, #D97706); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-ops { display: flex; gap: 4px; flex: none; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-op-confirm:hover { background: color-mix(in srgb, var(--spk-success, #16A34A) 12%, transparent); color: var(--spk-success, #16A34A); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pref-op-forget:hover { background: color-mix(in srgb, var(--spk-error, #DC2626) 12%, transparent); color: var(--spk-error, #DC2626); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-search { flex: 1; min-width: 160px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-search-grow { flex: 1 1 220px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-select { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 112px; height: var(--spk-control-h, 32px); padding: 0 8px 0 var(--spk-space-3); border: 1px solid var(--spk-border); border-radius: 8px; background: var(--spk-layer-2); color: var(--spk-label-2); font: inherit; font-size: var(--spk-text-sm); line-height: 1.4; cursor: pointer; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-select:hover { background: var(--spk-hover); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-select-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-select-chevron { display: inline-flex; color: var(--spk-label-3); transition: transform 160ms ease; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-select-open .hippomemo-select-chevron { transform: rotate(180deg); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-list { display: flex; flex-direction: column; gap: 8px; }',
  /* meta 行的安静文本（重要性 / 时间）：可收缩省略，间距由 ListRow meta 槽 gap 撑开。 */
  '[data-plugin="dsh-hippomemo"] .hippomemo-row-meta-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-icon-btn-danger:hover { background: color-mix(in srgb, var(--spk-error, #DC2626) 14%, transparent); color: var(--spk-error, #DC2626); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-tag { font-size: var(--spk-text-xs); line-height: 16px; padding: 1px 8px; flex: none; font-weight: 500; text-transform: none; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-tag .hippomemo-tag-icon { display: inline-flex; color: inherit; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-tag-neutral { background: var(--spk-layer-2, var(--spk-layer-2)); color: var(--spk-label-2); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-tag-brand { background: color-mix(in srgb, var(--spk-brand, #3d5af0) 10%, transparent); color: var(--spk-brand-fg, #2f46c8); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-tag-success { color: var(--spk-success, #16A34A); background: color-mix(in srgb, var(--spk-success, #16A34A) 10%, transparent); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-tag-warn { color: var(--spk-warn, #D97706); background: color-mix(in srgb, var(--spk-warn, #D97706) 10%, transparent); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-tag-error { background: var(--spk-error-soft, rgba(220,38,38,.10)); color: var(--spk-error, #DC2626); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-tag-mono { color: var(--spk-acc-github-fg, var(--spk-acc-github, #5b21b6)); background: color-mix(in srgb, var(--spk-acc-github, #7C3AED) 10%, transparent); font-family: var(--spk-font-mono, ui-monospace, monospace); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-kind-preference { background: color-mix(in srgb, var(--spk-brand, #3d5af0) 10%, transparent); color: var(--spk-brand-fg, #2f46c8); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-kind-insight, [data-plugin="dsh-hippomemo"] .hippomemo-kind-fact, [data-plugin="dsh-hippomemo"] .hippomemo-kind-decision, [data-plugin="dsh-hippomemo"] .hippomemo-kind-constraint { color: var(--spk-label-2); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-status-archived, [data-plugin="dsh-hippomemo"] .hippomemo-status-superseded { color: var(--spk-label-3); text-decoration: line-through; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-status-candidate { color: var(--spk-warn); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-proven-yes { color: var(--spk-success); font-weight: 500; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-proven-no { color: var(--spk-label-2); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-status, [data-plugin="dsh-hippomemo"] .hippomemo-empty { color: var(--spk-label-2); font-size: var(--spk-text-sm); line-height: 18px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-status-loading { animation: hippomemo-status-pulse 1.4s ease-in-out infinite; }',
  '@keyframes hippomemo-status-pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }',
  '@media (prefers-reduced-motion: reduce) { [data-plugin="dsh-hippomemo"] .hippomemo-status-loading { animation: none; } }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-error { color: var(--spk-error); font-size: var(--spk-text-md); line-height: 20px; }',
  /* 分页一行放下（2026-09 用户反馈）：不换行，meta 超宽走省略号让位给控件。 */
  '[data-plugin="dsh-hippomemo"] .hippomemo-pager { display: flex; flex-wrap: nowrap; gap: 8px; align-items: center; justify-content: space-between; border-top: 1px solid var(--spk-border); padding-top: 12px; margin-top: 12px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pager-meta { font-size: var(--spk-text-sm); color: var(--spk-label-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pager-controls { display: flex; flex-wrap: nowrap; gap: 4px; align-items: center; flex-shrink: 0; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-pager-gap { color: var(--spk-label-3); padding: 0 2px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-detail-modal-body { display: flex; flex-direction: column; gap: 12px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-detail-modal-footer { display: flex; justify-content: flex-end; gap: 8px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-detail-pills { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }',
  /* 内滚退役（2026-09 用户反馈「滚动条与 modal 滚动条紧贴」）：ui-kit Modal 已有
     max-height + body 内滚，这里再滚就是两条滚动条叠在同一个边缘。正文块只保留
     面底与阅读排版，高度放开，滚动单源归 modal body。 */
  '[data-plugin="dsh-hippomemo"] .hippomemo-detail-content { margin: 0; padding: 12px 14px; white-space: pre-wrap; font-size: var(--spk-text-md); line-height: 1.7; overflow-wrap: anywhere; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-tag-list { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-tag-label { font-size: var(--spk-text-sm); color: var(--spk-label-2); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-form-hint { font-size: var(--spk-text-xs); color: var(--spk-label-3); line-height: 16px; }',
  /* 字段行：行距 14px（相邻行不再贴着），label 走 xs/label-3 小标签层级，
     值是主体 —— dt/dd 的视觉权重差让两列栅格可扫（2026-09 用户反馈）。 */
  '[data-plugin="dsh-hippomemo"] .hippomemo-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px 20px; margin: 0; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-fact { display: flex; flex-direction: column; gap: 4px; min-width: 0; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-fact dt { font-size: var(--spk-text-xs); line-height: 16px; color: var(--spk-label-3); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-fact dd { margin: 0; font-size: var(--spk-text-md); line-height: 20px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-fact-spark { color: var(--spk-brand-fg); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-source-spark-pill { display: inline-flex; align-items: center; gap: 4px; color: var(--spk-brand-fg); font-size: var(--spk-text-sm); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-source-spark-id { font-family: var(--spk-font-mono, ui-monospace, monospace); font-size: var(--spk-text-xs); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-row-spark { display: inline-flex; color: var(--spk-brand-fg); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-lineage { margin-top: 8px; border-top: 1px solid var(--spk-border); padding-top: 8px; display: flex; flex-direction: column; gap: 8px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-lineage-title { font-size: var(--spk-text-sm); font-weight: 600; margin: 0; display: flex; align-items: center; gap: 8px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-lineage-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: var(--spk-text-sm); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-lineage-node { padding: 4px var(--spk-space-3); border-radius: 8px; border: 1px solid var(--spk-border); font-size: var(--spk-text-xs); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-lineage-spark { color: var(--spk-acc-github-fg, #5b21b6); border-color: var(--spk-acc-github, #7C3AED); background: color-mix(in srgb, var(--spk-acc-github, #7C3AED) 10%, transparent); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-lineage-crystal { color: var(--spk-label-2); background: var(--spk-layer-2); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-lineage-hippo { color: var(--spk-label); border-color: var(--spk-border-2, var(--spk-border)); background: var(--spk-layer-1, var(--spk-layer-2)); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-lineage-arrow { color: var(--spk-label-3); font-size: var(--spk-text-xs); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-lineage-note { font-size: var(--spk-text-xs); color: var(--spk-label-3); margin: 0; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-related { display: flex; flex-direction: column; gap: 8px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-related-label { font-size: var(--spk-text-sm); color: var(--spk-label-2); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-related-list { display: flex; flex-direction: column; gap: 4px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-related-title { font-weight: 600; font-size: var(--spk-text-md); line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-related-meta { font-size: var(--spk-text-sm); color: var(--spk-label-2); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-edit-modal-body { display: flex; flex-direction: column; gap: 12px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-edit-modal-footer { display: flex; justify-content: flex-end; gap: 8px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-form-label { display: flex; flex-direction: column; gap: 4px; font-size: var(--spk-text-sm); line-height: 18px; color: var(--spk-label-2); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-button-danger { color: var(--spk-error) !important; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-panel { display: flex; flex-direction: column; gap: 12px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-meta { display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: var(--spk-text-sm); line-height: 18px; color: var(--spk-label-2); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-chart-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-chart-card-wide { grid-column: 1 / -1; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-chart-title { font-size: var(--spk-text-md); line-height: 20px; font-weight: 600; }',
  /* 2026-09 重构：`.hippomemo-evolve-report` / `.hippomemo-evolve-block-title` /
     `.hippomemo-pref-head*` 已随「卡内套卡」的形制一起废弃 —— 复核结论与动作各是一张
     `section-card`，组名走卡头；偏好清单直接由卡头带出。CSS 一并删掉，免得留下第二套卡。 */
  '[data-plugin="dsh-hippomemo"] .hippomemo-evolve-review, [data-plugin="dsh-hippomemo"] .hippomemo-evolve-actions { display: flex; flex-direction: column; gap: 8px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-evolve-verdict, [data-plugin="dsh-hippomemo"] .hippomemo-evolve-action { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--spk-text-md); line-height: 20px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-evolve-verdict-id, [data-plugin="dsh-hippomemo"] .hippomemo-evolve-action-id { flex: none; font-family: var(--spk-font-mono, ui-monospace, monospace); font-size: var(--spk-text-sm); color: var(--spk-label-3); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-evolve-verdict-reason, [data-plugin="dsh-hippomemo"] .hippomemo-evolve-action-reason { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-verdict-keep { color: var(--spk-success); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-verdict-noise { color: var(--spk-warn); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card { list-style: none; border: 1px solid var(--spk-border); border-radius: var(--spk-radius-md); background: var(--spk-surface-card); transition: border-color 160ms, background 160ms; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card:hover { border-color: var(--spk-label-3, var(--spk-border)); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-open { background: var(--spk-surface-card); border-color: var(--spk-label-3); }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-body { border-top: 1px solid var(--spk-border); margin: 0 14px; padding: 4px 0 12px; display: flex; flex-direction: column; gap: 12px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-readonly { color: var(--spk-label-3); margin: 8px 0 0; font-size: var(--spk-text-sm); line-height: 18px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-field { flex-direction: column; gap: 4px; display: flex; margin-top: 8px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-field-head { align-items: center; gap: 8px; display: flex; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-field-label { color: var(--spk-label-2); flex: 1; font-size: var(--spk-text-sm); line-height: 18px; font-weight: 500; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-field-badges { align-items: center; gap: 8px; display: flex; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-field-input { width: 100%; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-field-foot { align-items: center; gap: 8px; display: flex; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-hint { color: var(--spk-label-3); flex: 1; margin: 0; font-size: var(--spk-text-xs); line-height: 16px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-choice-row { align-items: center; gap: 8px; flex-wrap: wrap; display: flex; margin-top: 4px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-choice-active { background: var(--spk-brand); color: var(--spk-on-brand); border-color: var(--spk-brand); font-weight: 600; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-advanced { border-top: 1px dashed var(--spk-border); margin-top: 4px; padding-top: 8px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-advanced-name { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-footer { border-top: 1px solid var(--spk-border); justify-content: flex-end; align-items: center; gap: 8px; margin-top: 12px; padding-top: 8px; display: flex; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-card-failed { min-width: 0; color: var(--spk-error); flex: 1; margin: 0; font-size: var(--spk-text-sm); line-height: 18px; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-dot-pfc { color: var(--spk-acc-hippomemo, #3b82f6) !important; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-dot-amy { color: var(--spk-error, #c62828) !important; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-dot-hippo { color: var(--spk-acc-github, #8b5cf6) !important; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-brain-dot-cortex { color: var(--spk-label-3, #5f6a7d) !important; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-todo-icon-warn { color: var(--spk-warn, #9a3412) !important; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-todo-icon-info { color: var(--spk-brand-fg, #2f46c8) !important; }',
  '[data-plugin="dsh-hippomemo"] .hippomemo-todo-icon-danger { color: var(--spk-error, #c62828) !important; }',
  // ---- portal modal 高度约束 ----
  // ui-kit Modal portal 到 document.body，dialog 无 data-plugin 祖先；hippomemo-*
  // 类名全局唯一，无前缀规则安全。dialog 限高 + 内部内容（hippomemo-modal-scope）
  // 独立滚动：header/footer 恒可见，长内容（记忆正文/编辑表单）在 scope 内滚动，
  // 不再撑破视口。detail 正文不再自带内滚 —— 滚动单源归 modal body。
  // 2026-09 修复「来源溯源溢出 modal 下边缘」：旧方案 body 预算锚定 100vh-230px，
  // 而 dialog 封顶 720px 且不裁剪，高视口下 header+body+footer 总高超过 720 → 底部溢出。
  // 改为 dialog 自身 flex-column：header/footer 恒可见且不收缩，body 独占剩余空间内滚，
  // 总高永远收敛在 max-height 内。
  '.hippomemo-detail-modal, .hippomemo-edit-modal { display: flex; flex-direction: column; max-height: min(720px, calc(100vh - 40px)); }',
  '.hippomemo-detail-modal > header, .hippomemo-edit-modal > header, .hippomemo-detail-modal > footer, .hippomemo-edit-modal > footer { flex: none; }',
  // modal 内唯一直接子 div 就是 ui-kit body；header/footer 是语义元素，不会被命中
  '.hippomemo-detail-modal > div, .hippomemo-edit-modal > div { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; }',
  '.hippomemo-detail-modal .hippomemo-modal-scope, .hippomemo-edit-modal .hippomemo-modal-scope { flex: 1 1 auto; max-height: none; min-height: 0; overflow-y: auto; }',
].join('\n')
