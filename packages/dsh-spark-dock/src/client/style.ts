/**
 * CSS for the Spark Dock ball + panel. Injected once at mount (style[data-plugin-css]).
 * Scoped under [data-plugin="dsh-spark-dock"] mirrors the demo preview (docs/spark-dock-preview).
 * Note: shell.overlay is click-through — every interactive surface here opts back in
 * with pointer-events: auto.
 */
export const DOCK_CSS = [
  '[data-plugin="dsh-spark-dock"] { pointer-events: auto; font-family: var(--dsw-font-family, -apple-system, "PingFang SC", sans-serif); }',

  /* 悬浮球 —— 2026-09 视觉主题重构：
   * 球身 = 平台底色 + 火花暖色径向渐变；玻璃高光 = inset 顶部亮线 + backdrop blur；
   * 品牌光晕 = ::before 径向 halo（呼吸）+ ::after hover 光环（preview 版回归）。
   * mood 染光：--ball-glow 随 Fairy 情绪换色（alert→warn），全部 transform/opacity 动画。 */
  '[data-plugin="dsh-spark-dock"] .dock-ball { --ball-glow: var(--spk-acc-spark, #d97706); position: fixed; width: var(--dock-ball, 48px); height: var(--dock-ball, 48px); border-radius: 50%; display: grid; place-items: center; z-index: 9000; background: radial-gradient(118% 118% at 30% 20%, color-mix(in srgb, var(--ball-glow) 24%, var(--dsw-alias-bg-module-platform)) 0%, var(--dsw-alias-bg-module-platform) 62%); border: 1px solid color-mix(in srgb, var(--ball-glow) 34%, var(--dsw-alias-border-l1)); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 8px 24px rgba(10,18,38,.32), 0 0 18px color-mix(in srgb, var(--ball-glow) 20%, transparent), inset 0 1px 0 rgba(255,255,255,.14), inset 0 0 0 1px rgba(255,255,255,.05); color: var(--dsw-alias-label-primary, #fff); cursor: pointer; touch-action: none; transition: transform 200ms cubic-bezier(.34,1.56,.64,1), box-shadow 240ms ease, border-color 240ms ease; }',
  '[data-plugin="dsh-spark-dock"] .dock-ball::before { content: ""; position: absolute; inset: -8px; border-radius: 50%; pointer-events: none; background: radial-gradient(closest-side, color-mix(in srgb, var(--ball-glow) 32%, transparent), transparent 74%); opacity: .45; animation: dock-ball-halo 4.6s ease-in-out infinite; }',
  '[data-plugin="dsh-spark-dock"] .dock-ball::after { content: ""; position: absolute; inset: -5px; border-radius: 50%; pointer-events: none; border: 1px solid var(--ball-glow); opacity: 0; transform: scale(.85); transition: opacity 200ms ease-out, transform 200ms ease-out; }',
  '[data-plugin="dsh-spark-dock"] .dock-ball:hover { transform: scale(1.06); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball:hover::after { opacity: .55; transform: scale(1); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball:active { transform: scale(.94); transition-duration: 90ms; }',
  '[data-plugin="dsh-spark-dock"] .dock-ball.dragging { cursor: grabbing; transform: scale(1.1); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball.dragging::before { opacity: .8; animation-play-state: paused; }',
  /* 面板打开：halo 驻留 + 呼吸暂停，球读作「已激活」而非持续吸引注意 */
  '[data-plugin="dsh-spark-dock"] .dock-ball[aria-expanded="true"]::before { opacity: .7; animation-play-state: paused; }',
  /* mood 染光：换 --ball-glow 即可同时驱动渐变/边框/halo/投影 */
  '[data-plugin="dsh-spark-dock"] .dock-ball.mood-alert { --ball-glow: var(--dsw-alias-state-warn-primary, #f59e0b); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball.mood-sad { --ball-glow: color-mix(in srgb, var(--dsw-alias-label-tertiary, #8a93a6) 70%, var(--spk-acc-spark, #d97706)); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball svg { width: 24px; height: 24px; overflow: visible; filter: drop-shadow(0 1px 2px rgba(10,18,38,.35)); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; }',
  '@keyframes dock-ball-halo { 0%,100% { opacity: .45; transform: scale(1); } 50% { opacity: .75; transform: scale(1.06); } }',
  '@media (prefers-reduced-motion: reduce) { [data-plugin="dsh-spark-dock"] .dock-ball, [data-plugin="dsh-spark-dock"] .dock-ball::before { animation: none; } [data-plugin="dsh-spark-dock"] .fairy-face, [data-plugin="dsh-spark-dock"] .fairy-face .ahoge { animation: none; } }',
  '[data-plugin="dsh-spark-dock"] .dock-badge { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; border-radius: 9px; padding: 0 5px; background: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-label-primary-foreground, #fff); font: 700 11px/18px var(--dsw-font-family, inherit); text-align: center; box-shadow: 0 0 0 2px var(--dsw-alias-bg-module-platform); }',

  /* 面板 —— 结构：flex row = 左 rail(56px) + 右主列 */
  '[data-plugin="dsh-spark-dock"] .dock-panel { position: fixed; z-index: 9100; width: var(--dock-panel-w, 616px); max-width: calc(100vw - 32px); height: var(--dock-panel-h, 680px); max-height: calc(100vh - 32px); display: flex; flex-direction: row; background: var(--dsw-alias-bg-module-platform); border: 1px solid var(--dsw-alias-border-l1); border-radius: 20px; box-shadow: var(--dsw-shadow-lv3, 0 16px 48px rgba(10,18,38,.28)); overflow: hidden; color: var(--dsw-alias-label-primary, #fff); opacity: 0; transform: scale(.94); pointer-events: none; transition: transform 220ms cubic-bezier(.34,1.56,.64,1), opacity 220ms ease; }',
  '[data-plugin="dsh-spark-dock"] .dock-panel.open { opacity: 1; transform: scale(1); pointer-events: auto; }',

  /* 左侧图标模块栏（activity rail）——用抬起面而非 layer-2：
     layer-2 是「凹陷/轨道」色，亮色下与面板 platform 几乎同色，且模块 accent 文字压上去只有 1.9-3.7:1。 */
  '[data-plugin="dsh-spark-dock"] .dock-rail { width: 56px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 0; background: var(--dsw-alias-surface-l1); border-right: 1px solid var(--dsw-alias-border-l1); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; position: relative; border: none; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; transition: background 160ms ease, color 160ms ease; }',
  '[data-plugin="dsh-spark-dock"] .dock-tab svg { width: 19px; height: 19px; }',
  '[data-plugin="dsh-spark-dock"] .dock-tab:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
  /* 激活项：文字/图标走 accent 的文字态档，指示条走实色档 */
  '[data-plugin="dsh-spark-dock"] .dock-tab.active { color: var(--accent-fg, var(--dsw-alias-brand-foreground)); background: color-mix(in srgb, var(--accent-fg, var(--dsw-alias-brand-foreground)) 12%, transparent); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab.active::before { content: ""; position: absolute; left: -8px; top: 50%; transform: translateY(-50%); width: 3px; height: 20px; border-radius: 0 3px 3px 0; background: var(--accent); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }',

  /* 右侧主列：模块头 / 子页 / 内容 */
  '[data-plugin="dsh-spark-dock"] .dock-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }',
  '[data-plugin="dsh-spark-dock"] .dock-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-head .titles { min-width: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-head .name { font-size: 15px; font-weight: 700; line-height: 1.3; color: var(--dsw-alias-label-primary); }',
  '[data-plugin="dsh-spark-dock"] .dock-head .sub { font-size: 12px; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-head .spacer { flex: 1; }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn { position: relative; width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: transparent; border: none; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn::before { content: ""; position: absolute; inset: -5px; }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn svg { width: 15px; height: 15px; }',

  /* 模块内子页 tab 已统一为 ui-kit SegmentedControl（fullWidth），原 .subtabbar 样式移除 */
  '[data-plugin="dsh-spark-dock"] .subtabbar { margin-bottom: 10px; }',

  /* 通用内容件（卡片/行/pill/按钮/表单） */
  '[data-plugin="dsh-spark-dock"] .dock-stack { display: flex; flex-direction: column; gap: 10px; }',
  /* 卡片 surface 火花基线：radius 12 / padding 12 14 / 抬起面（与 ui-kit Card 同规） */
  '[data-plugin="dsh-spark-dock"] .dock-card { background: var(--dsw-alias-surface-l1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 12px 14px; }',
  '[data-plugin="dsh-spark-dock"] .dock-card.list { padding: 4px; }',
  '[data-plugin="dsh-spark-dock"] .dock-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; }',
  '[data-plugin="dsh-spark-dock"] .dock-row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '[data-plugin="dsh-spark-dock"] .dock-row .grow { flex: 1; min-width: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-row .ttl { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-plugin="dsh-spark-dock"] .dock-row .meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-plugin="dsh-spark-dock"] .dock-row.off .ttl { text-decoration: line-through; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .cryst { color: var(--dsw-alias-state-success-primary); font-weight: 600; }',
  '[data-plugin="dsh-spark-dock"] .dock-pill { position: relative; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 9px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); cursor: pointer; }',
  /* 热区扩容：pill 视觉小，命中区向外扩 4px（≥ 触控下限的兜底） */
  '[data-plugin="dsh-spark-dock"] .dock-pill::before { content: ""; position: absolute; inset: -4px; border-radius: 999px; }',
  '[data-plugin="dsh-spark-dock"] .dock-pill:disabled { opacity: .55; cursor: default; }',
  '[data-plugin="dsh-spark-dock"] .dock-pill.on { background: var(--accent-fg, var(--dsw-alias-brand-foreground)); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }',
  '[data-plugin="dsh-spark-dock"] .dock-modbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
  '[data-plugin="dsh-spark-dock"] .dock-btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px; border-radius: 16px; border: none; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary)); color: var(--dsw-alias-label-primary-foreground, #fff); font: 600 13px/1 var(--dsw-font-family, inherit); cursor: pointer; }',
  '[data-plugin="dsh-spark-dock"] .dock-btn:hover { filter: brightness(1.08); }',
  '[data-plugin="dsh-spark-dock"] .dock-btn:disabled { opacity: .55; cursor: default; }',
  '[data-plugin="dsh-spark-dock"] .dock-field { width: 100%; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; color: var(--dsw-alias-label-primary); font: 400 13px/1.4 var(--dsw-font-family, inherit); padding: 8px 10px; margin-bottom: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-field:focus-visible { outline: 2px solid var(--accent, var(--dsw-alias-brand-primary)); outline-offset: 1px; }',
  '[data-plugin="dsh-spark-dock"] .dock-field::placeholder { color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] textarea.dock-field { resize: vertical; }',
  '[data-plugin="dsh-spark-dock"] .dock-fieldrow { display: flex; align-items: center; gap: 6px; }',
  '[data-plugin="dsh-spark-dock"] .dock-fieldrow .grow { flex: 1; min-width: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-fieldrow .dock-field { margin-bottom: 0; }',
  '[data-plugin="dsh-spark-dock"] select.dock-field.sel { width: auto; }',
  '[data-plugin="dsh-spark-dock"] .dock-error { padding: 8px 10px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; color: var(--dsw-alias-state-error-primary); font-size: 12px; }',
  '[data-plugin="dsh-spark-dock"] .dock-ok { padding: 8px 10px; border: 1px solid var(--dsw-alias-state-success-primary); border-radius: 8px; color: var(--dsw-alias-state-success-primary); font-size: 12px; }',
  '[data-plugin="dsh-spark-dock"] .dock-sdot { width: 9px; height: 9px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); display: inline-block; flex: none; }',
  '[data-plugin="dsh-spark-dock"] .dock-sdot.done { background: var(--dsw-alias-state-success-primary); }',
  '[data-plugin="dsh-spark-dock"] .dock-sdot.warn { background: var(--dsw-alias-state-warn-primary); }',
  '[data-plugin="dsh-spark-dock"] .dock-sdot.error { background: var(--dsw-alias-state-error-primary); }',
  '[data-plugin="dsh-spark-dock"] .dock-row .amount { font-size: 13px; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }',
  '[data-plugin="dsh-spark-dock"] .dock-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-btn.ghost { background: transparent; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }',
  '[data-plugin="dsh-spark-dock"] .dock-btn.ghost:hover { color: var(--dsw-alias-label-primary); }',
  '[data-plugin="dsh-spark-dock"] .dock-scopes { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin: 6px 0 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-hline { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 6px 0 2px; }',
  '[data-plugin="dsh-spark-dock"] .dock-hline b { font-size: 12px; font-weight: 700; color: var(--dsw-alias-label-primary); }',

  /* ── Fairy 表情层（docs/spark-dock-preview fairy.css 子集） ── */
  '[data-plugin="dsh-spark-dock"] .fairy-face { width: 46px; height: 46px; overflow: visible; color: var(--dsw-alias-label-primary, #fff); animation: dock-bob 3.4s ease-in-out infinite; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face .ahoge { transform-origin: 24px 9px; animation: dock-ahoge 2.8s ease-in-out infinite; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face .eyes-happy, [data-plugin="dsh-spark-dock"] .fairy-face .mouth-open, [data-plugin="dsh-spark-dock"] .fairy-face .mouth-frown, [data-plugin="dsh-spark-dock"] .fairy-face .acc-think { display: none; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face .blush { opacity: 0; }',
  '@keyframes dock-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.3px); } }',
  '@keyframes dock-ahoge { 0%,100% { transform: rotate(-9deg); } 50% { transform: rotate(9deg); } }',
  /* happy/cheer：弧形笑眼 + 腮红 + 弹跳 */
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-happy .eyes-normal, [data-plugin="dsh-spark-dock"] .fairy-face.mood-cheer .eyes-normal { display: none; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-happy .eyes-happy, [data-plugin="dsh-spark-dock"] .fairy-face.mood-cheer .eyes-happy { display: block; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-happy .blush, [data-plugin="dsh-spark-dock"] .fairy-face.mood-cheer .blush { opacity: .55; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-cheer { animation: dock-bounce .55s ease-in-out infinite; }',
  '@keyframes dock-bounce { 0%,100% { transform: translateY(0); } 45% { transform: translateY(-5px) scale(1.03); } }',
  /* alert：张嘴 + 呆毛闪烁 */
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-alert .mouth-smile { display: none; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-alert .mouth-open { display: block; transform: scale(.72); transform-box: fill-box; transform-origin: center; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-alert .ahoge { animation: dock-flash 1s ease-in-out infinite; }',
  '@keyframes dock-flash { 0%,100% { opacity: 1; } 50% { opacity: .35; } }',
  /* think：思考泡 */
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-think .acc-think { display: block; }',
  /* sad：委屈嘴 */
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-sad .mouth-smile { display: none; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-sad .mouth-frown { display: block; }',

  /* ── 播报气泡 ── */
  '[data-plugin="dsh-spark-dock"] .dock-bubble { position: fixed; z-index: 9300; max-width: 250px; padding: 9px 12px; border-radius: 14px; background: var(--dsw-alias-bg-module-platform); border: 1px solid var(--dsw-alias-border-l1); box-shadow: var(--dsw-shadow-lv2, 0 8px 24px rgba(10,18,38,.16)); color: var(--dsw-alias-label-primary); font: 500 12px/1.5 var(--dsw-font-family, inherit); pointer-events: auto; }',
  '[data-plugin="dsh-spark-dock"] .dock-bubble .src { display: block; margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-bubble.mood-alert { border-color: var(--dsw-alias-state-warn-primary); }',
  '[data-plugin="dsh-spark-dock"] .grow-spacer { flex: 1; }',
  '[data-plugin="dsh-spark-dock"] .dock-statrow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-stat .k { font-size: 11px; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-stat .v { font-size: 17px; font-weight: 700; margin-top: 2px; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }',
  '[data-plugin="dsh-spark-dock"] .dock-narr { display: flex; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--dsw-alias-border-l1); font-size: 11px; color: var(--dsw-alias-label-secondary); }',
  '[data-plugin="dsh-spark-dock"] .dock-narr .lab { flex: none; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-pill.mini { padding: 1px 7px; font-size: 10px; cursor: default; }',
  '[data-plugin="dsh-spark-dock"] .dock-pill.mini.accent { background: color-mix(in srgb, var(--accent-fg, var(--dsw-alias-brand-foreground)) 14%, transparent); border-color: transparent; color: var(--accent-fg, var(--dsw-alias-brand-foreground)); }',
  '[data-plugin="dsh-spark-dock"] .dock-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px; font-size: 14px; line-height: 1.5; }',
  '[data-plugin="dsh-spark-dock"] .dock-empty { padding: 28px 12px; text-align: center; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-empty .empty-ico { width: 26px; height: 26px; opacity: .55; margin-bottom: 6px; }',
  '[data-plugin="dsh-spark-dock"] .dock-empty .empty-txt { font-size: 13px; color: var(--dsw-alias-label-secondary); }',
  '[data-plugin="dsh-spark-dock"] .dock-empty .empty-hint { font-size: 11px; margin-top: 4px; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-empty.loading .empty-ico { animation: dock-empty-pulse 1.4s ease-in-out infinite; }',
  '@keyframes dock-empty-pulse { 0%,100% { opacity: .25; } 50% { opacity: .7; } }',
  /* 连接器模块：加载 spinner 与明确的失败态 */
  '[data-plugin="dsh-spark-dock"] .dock-spin { display: inline-block; width: 14px; height: 14px; margin-right: 8px; vertical-align: -2px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l1); border-top-color: var(--accent, var(--dsw-alias-brand-primary)); animation: dock-spin .8s linear infinite; }',
  '@keyframes dock-spin { to { transform: rotate(360deg); } }',
  '[data-plugin="dsh-spark-dock"] .dock-embed-failed { color: var(--dsw-alias-state-error-content, #f87171); font-size: 13px; line-height: 1.6; padding: 40px 24px; }',
  /* 面板内滚动条：细圆角深色，替代系统箭头滚动条 */
  '[data-plugin="dsh-spark-dock"] .dock-body::-webkit-scrollbar, [data-plugin="dsh-spark-dock"] .dock-embed ::-webkit-scrollbar { width: 8px; height: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-body::-webkit-scrollbar-thumb, [data-plugin="dsh-spark-dock"] .dock-embed ::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l1, rgba(255,255,255,.14)); border-radius: 4px; }',
  '[data-plugin="dsh-spark-dock"] .dock-body::-webkit-scrollbar-thumb:hover, [data-plugin="dsh-spark-dock"] .dock-embed ::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-border-l2, rgba(255,255,255,.24)); }',
  '[data-plugin="dsh-spark-dock"] .dock-body::-webkit-scrollbar-track, [data-plugin="dsh-spark-dock"] .dock-embed ::-webkit-scrollbar-track { background: transparent; }',
  '[data-plugin="dsh-spark-dock"] .dock-body, [data-plugin="dsh-spark-dock"] .dock-embed { scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l1, rgba(255,255,255,.14)) transparent; }',
  /* 可见表单标签（替代 placeholder-only） */
  '[data-plugin="dsh-spark-dock"] .dock-lab { display: block; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin: 0 2px 4px; }',
  '[data-plugin="dsh-spark-dock"] .dock-btn .btn-ico { width: 13px; height: 13px; flex: none; }',

  /* ── 深度重做：spark 模块 ── */
  /* 捕获卡：一条输入流 + 渐进披露 */
  '[data-plugin="dsh-spark-dock"] .dock-capture { display: flex; flex-direction: column; }',
  '[data-plugin="dsh-spark-dock"] .dock-capture .dock-field { margin-bottom: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-capture-bar { display: flex; align-items: center; gap: 8px; margin-top: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-details { margin-top: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-details summary { cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-tertiary); user-select: none; width: fit-content; padding: 3px 0; list-style: none; }',
  '[data-plugin="dsh-spark-dock"] .dock-details summary::-webkit-details-marker { display: none; }',
  '[data-plugin="dsh-spark-dock"] .dock-details summary::before { content: "＋ "; }',
  '[data-plugin="dsh-spark-dock"] .dock-details[open] summary::before { content: "－ "; }',
  '[data-plugin="dsh-spark-dock"] .dock-details summary:hover { color: var(--dsw-alias-label-secondary); }',
  '[data-plugin="dsh-spark-dock"] .dock-details-body { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-details-body .dock-field { margin-bottom: 0; }',
  /* 计量条：宽度即数值，配文本说明 */
  '[data-plugin="dsh-spark-dock"] .dock-meter { display: inline-block; width: 72px; height: 4px; border-radius: 2px; background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,.09)); overflow: hidden; flex: none; }',
  '[data-plugin="dsh-spark-dock"] .dock-meter-fill { display: block; height: 100%; border-radius: 2px; background: var(--accent, var(--dsw-alias-brand-primary)); transition: width 300ms cubic-bezier(.2,.8,.2,1); }',
  '[data-plugin="dsh-spark-dock"] .dock-meter.tone-good .dock-meter-fill { background: var(--dsw-alias-state-success-primary); }',
  '[data-plugin="dsh-spark-dock"] .dock-meter.tone-warn .dock-meter-fill { background: var(--dsw-alias-state-warn-primary); }',
  '[data-plugin="dsh-spark-dock"] .dock-row-meter, [data-plugin="dsh-spark-dock"] .dock-prop-meter { display: flex; align-items: center; gap: 8px; margin-top: 5px; }',
  /* 结晶行首圆点（除文字外再给一个颜色通道） */
  '[data-plugin="dsh-spark-dock"] .dock-row-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }',
  '[data-plugin="dsh-spark-dock"] .dock-row-dot.cryst { background: var(--dsw-alias-state-success-primary); }',
  /* 提议卡：类型徽章 + 正文 + 置信条 + 决策操作 */
  '[data-plugin="dsh-spark-dock"] .dock-prop { display: flex; flex-direction: column; gap: 7px; }',
  '[data-plugin="dsh-spark-dock"] .dock-prop-head { display: flex; align-items: center; gap: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-prop-type { font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 2px 8px; border-radius: 6px; background: color-mix(in srgb, var(--accent-fg, var(--dsw-alias-brand-foreground)) 14%, transparent); color: var(--accent-fg, var(--dsw-alias-brand-foreground)); }',
  '[data-plugin="dsh-spark-dock"] .dock-prop-text { font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); }',
  '[data-plugin="dsh-spark-dock"] .dock-prop-actions { display: flex; gap: 6px; margin-top: 2px; }',
  '[data-plugin="dsh-spark-dock"] .dock-prop-actions .dock-btn { height: 28px; padding: 0 14px; font-size: 12px; }',

  /* ── 内嵌页 compat 层（2026-09 UIUX 收敛）────────────────────────────
   * 原则：dock 标题栏已给出模块名与描述，内嵌页自己的设置页级标题
   * （H2 大标题 + 一句简介）在 overlay 里是三层 chrome 冗余，压掉；
   * 正文密度向 13px 靠拢；不碰组件内部的业务样式。 */
  /* hippomemo：类名稳定，直接压标题与简介 */
  '[data-plugin="dsh-spark-dock"] .hippomemo-title, [data-plugin="dsh-spark-dock"] .hippomemo-intro { display: none; }',
  /* github / npm：css-modules hash 类不可寻址，用结构选择器
   * （两包的 section 根部均为 h2.title + p.intro 相邻对） */
  '.dock-embed-connector :is(h1, h2):first-of-type, .dock-embed-connector :is(h1, h2):first-of-type + p { display: none; }',
  /* 内嵌正文密度：设置页 16px 基准 → overlay 13px；列表/表单间距收紧 */
  '.dock-embed { font-size: 13px; line-height: 1.45; }',
  '.dock-embed :is(h1, h2) { font-size: 15px; line-height: 1.35; margin: 0 0 8px; }',
  '.dock-embed :is(h3) { font-size: 13px; margin: 0 0 6px; }',
  '.dock-embed p { font-size: 13px; }',
  /* hippomemo 分段控件通栏（与 dock subtabbar 同宽对齐） */
  '[data-plugin="dsh-spark-dock"] .hippomemo-tabs { align-self: stretch; }',
  /* connector 按钮不被 flex column 拉伸成全宽白胶囊，回落紧凑尺寸 */
  '.dock-embed-connector button { align-self: flex-start; }',
].join('\n')
