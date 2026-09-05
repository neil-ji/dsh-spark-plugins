/**
 * CSS for the Spark Dock ball + panel. Injected once at mount (style[data-plugin-css]).
 * Scoped under [data-plugin="dsh-spark-dock"] mirrors the demo preview (docs/spark-dock-preview).
 * Note: shell.overlay is click-through — every interactive surface here opts back in
 * with pointer-events: auto.
 */
export const DOCK_CSS = [
  '[data-plugin="dsh-spark-dock"] { pointer-events: auto; font-family: var(--dsw-font-family, -apple-system, "PingFang SC", sans-serif); }',

  /* 悬浮球 */
  '[data-plugin="dsh-spark-dock"] .dock-ball { position: fixed; width: var(--dock-ball, 48px); height: var(--dock-ball, 48px); border-radius: 50%; display: grid; place-items: center; z-index: 9000; background: var(--dsw-alias-bg-module-platform); border: 1px solid var(--dsw-alias-border-l1); box-shadow: var(--dsw-shadow-lv2, 0 8px 24px rgba(10,18,38,.16)), inset 0 0 0 1px rgba(255,255,255,.07); color: var(--dsw-alias-label-primary-foreground, #fff); cursor: pointer; touch-action: none; transition: box-shadow 200ms ease; }',
  '[data-plugin="dsh-spark-dock"] .dock-ball svg { width: 22px; height: 22px; overflow: visible; }',
  '[data-plugin="dsh-spark-dock"] .dock-ball:active { transform: scale(.95); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball.dragging { cursor: grabbing; }',
  '[data-plugin="dsh-spark-dock"] .dock-ball:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; }',
  '[data-plugin="dsh-spark-dock"] .dock-badge { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; border-radius: 9px; padding: 0 5px; background: var(--dsw-alias-state-error-primary); color: #fff; font: 700 11px/18px var(--dsw-font-family, inherit); text-align: center; box-shadow: 0 0 0 2px var(--dsw-alias-bg-module-platform); }',

  /* 面板 */
  '[data-plugin="dsh-spark-dock"] .dock-panel { position: fixed; z-index: 9100; width: var(--dock-panel-w, 560px); height: var(--dock-panel-h, 680px); display: flex; flex-direction: column; background: var(--dsw-alias-bg-module-platform); border: 1px solid var(--dsw-alias-border-l1); border-radius: 20px; box-shadow: var(--dsw-shadow-lv3, 0 16px 48px rgba(10,18,38,.28)); overflow: hidden; color: var(--dsw-alias-label-primary-foreground, #fff); opacity: 0; transform: scale(.94); pointer-events: none; transition: transform 220ms cubic-bezier(.34,1.56,.64,1), opacity 220ms ease; }',
  '[data-plugin="dsh-spark-dock"] .dock-panel.open { opacity: 1; transform: scale(1); pointer-events: auto; }',
  '[data-plugin="dsh-spark-dock"] .dock-titlebar { display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px; }',
  '[data-plugin="dsh-spark-dock"] .dock-titlebar .titles { min-width: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-titlebar .name { font-size: 15px; font-weight: 700; line-height: 1.3; color: var(--dsw-alias-label-primary-foreground, #fff); }',
  '[data-plugin="dsh-spark-dock"] .dock-titlebar .sub { font-size: 12px; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-titlebar .spacer { flex: 1; }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn { position: relative; width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: transparent; border: none; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn::before { content: ""; position: absolute; inset: -5px; }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary-foreground, #fff); }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn svg { width: 15px; height: 15px; }',

  /* 模块 tab 导航 */
  '[data-plugin="dsh-spark-dock"] .dock-nav { display: flex; gap: 4px; margin: 0 12px; padding: 6px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 13px; }',
  '[data-plugin="dsh-spark-dock"] .dock-tab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 2px 7px; border-radius: 10px; border: none; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; position: relative; font: 500 11px/1 var(--dsw-font-family, inherit); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab svg { width: 17px; height: 17px; }',
  '[data-plugin="dsh-spark-dock"] .dock-tab:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary-foreground, #fff); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab.active { color: var(--accent); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab.active::after { content: ""; position: absolute; bottom: 1px; width: 16px; height: 2px; border-radius: 2px; background: var(--accent); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }',

  /* 模块内子页 tab */
  '[data-plugin="dsh-spark-dock"] .subtabbar { display: flex; gap: 3px; padding: 3px; margin-bottom: 10px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; }',
  '[data-plugin="dsh-spark-dock"] .subtab { flex: 1; padding: 6px 4px; border: none; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font: 500 11px/1 var(--dsw-font-family, inherit); cursor: pointer; position: relative; }',
  '[data-plugin="dsh-spark-dock"] .subtab::before { content: ""; position: absolute; inset: -4px; }',
  '[data-plugin="dsh-spark-dock"] .subtab.on { background: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,.11)); color: var(--dsw-alias-label-primary-foreground, #fff); }',
  '[data-plugin="dsh-spark-dock"] .subtab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',

  /* 通用内容件（卡片/行/pill/按钮/表单） */
  '[data-plugin="dsh-spark-dock"] .dock-stack { display: flex; flex-direction: column; gap: 10px; }',
  '[data-plugin="dsh-spark-dock"] .dock-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 14px; }',
  '[data-plugin="dsh-spark-dock"] .dock-card.list { padding: 4px; }',
  '[data-plugin="dsh-spark-dock"] .dock-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; }',
  '[data-plugin="dsh-spark-dock"] .dock-row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '[data-plugin="dsh-spark-dock"] .dock-row .grow { flex: 1; min-width: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-row .ttl { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-plugin="dsh-spark-dock"] .dock-row .meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-plugin="dsh-spark-dock"] .dock-row.off .ttl { text-decoration: line-through; opacity: .55; }',
  '[data-plugin="dsh-spark-dock"] .cryst { color: var(--dsw-alias-state-success-primary); font-weight: 600; }',
  '[data-plugin="dsh-spark-dock"] .dock-pill { position: relative; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 9px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); cursor: pointer; }',
  '[data-plugin="dsh-spark-dock"] .dock-pill.on { background: var(--accent, var(--dsw-alias-brand-primary)); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }',
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
  '[data-plugin="dsh-spark-dock"] .grow-spacer { flex: 1; }',
  '[data-plugin="dsh-spark-dock"] .dock-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 16px; font-size: 14px; line-height: 1.5; }',
  '[data-plugin="dsh-spark-dock"] .dock-empty { padding: 32px 12px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-tertiary); }',
].join('\n')
