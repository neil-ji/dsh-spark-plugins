/* ─────────── 元素 ─────────── */
const ball = document.getElementById('ball');
const panel = document.getElementById('panel');
const nav = document.getElementById('dockNav');
const body = document.getElementById('dockBody');
const modName = document.getElementById('modName');
const modSub = document.getElementById('modSub');
const ballBadge = document.getElementById('ballBadge');

const setModule = (id) => {
  const mod = MODULES.find(x => x.id === id);
  document.body.style.setProperty('--dock-accent', mod.accent);
  modName.textContent = mod.name;
  modSub.textContent = mod.sub;
  [...nav.children].forEach(t => {
    const on = t.dataset.id === mod.id;
    t.classList.toggle('active', on);
    t.setAttribute('aria-current', on ? 'true' : 'false');
  });
  [...body.children].forEach(s => s.classList.toggle('active', s.dataset.id === mod.id));
  try { localStorage['dsh.spark-dock:active'] = mod.id; } catch {}
};

MODULES.forEach(mod => {
  const t = document.createElement('button');
  t.type = 'button'; t.className = 'dock-tab'; t.dataset.id = mod.id;
  t.style.setProperty('--accent', mod.accent);
  t.innerHTML = `${ICONS[mod.icon]}<span>${mod.label}</span>`;
  t.setAttribute('role', 'tab'); t.setAttribute('aria-label', mod.label);
  t.onclick = () => setModule(mod.id);
  nav.appendChild(t);

  const s = document.createElement('section');
  s.className = 'module'; s.dataset.id = mod.id;
  s.innerHTML = CONTENT[mod.id];
  body.appendChild(s);
});
setModule(localStorage['dsh.spark-dock:active'] || 'spark');

// 模块内子 Tab（对齐存量 Feature 的多页结构：火花 4 页 / 记忆 4 页）
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-subtab]');
  if (!btn) return;
  const group = btn.dataset.subtab, value = btn.dataset.value;
  document.querySelectorAll(`[data-subtab="${group}"]`).forEach(b => {
    const on = b === btn;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll(`[data-subtab-pane="${group}"]`).forEach(p => {
    p.classList.toggle('active', p.dataset.value === value);
  });
});


/* ─────────── 开合 ─────────── */
let panelOpen = false;
const setOpen = (v) => {
  panelOpen = v;
  panel.classList.toggle('open', v);
  ball.setAttribute('aria-expanded', String(v));
  if (v) layoutPanel();
};
ball.addEventListener('click', () => {
  if (suppressClick) { suppressClick = false; return; }
  setOpen(!panelOpen);
});
document.getElementById('closeBtn').addEventListener('click', () => { setOpen(false); ball.focus(); });
document.getElementById('pinBtn').addEventListener('click', (e) => {
  e.currentTarget.classList.toggle('on');
  e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.classList.contains('on')));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && panelOpen) { setOpen(false); ball.focus(); }
});
window.addEventListener('resize', () => {
  Object.assign(state, clampToView(state));   // 窗口缩小后把球夹回视口内
  layoutBall(); layoutPanel();
});

ballBadge.hidden = false;
ballBadge.textContent = '4';
ballBadge.setAttribute('aria-hidden', 'true');

/* ─────────── 布局：球位置（纯 px 坐标，不用 right/bottom） ─────────── */
const M = 16;          // 安全边距
const BALL = 48;
const state = { x: 0, y: 0 };

function defaultPos() {
  return { x: innerWidth - BALL - M, y: innerHeight - BALL - M };
}
function loadPos() {
  try {
    const p = JSON.parse(localStorage['dsh.spark-dock:pos'] || 'null');
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return clampToView({ x: p.x, y: p.y });
  } catch {}
  return defaultPos();
}
function clampToView(p) {
  const x = Math.max(M, Math.min(innerWidth - BALL - M, p.x));
  const y = Math.max(M, Math.min(innerHeight - BALL - M, p.y));
  return { x, y };
}

function layoutBall() {
  ball.style.left = state.x + 'px';
  ball.style.top = state.y + 'px';
}

/* ─────────── 面板布局：随球在左/右、上/下 反向弹出 + 视口夹取 ─────────── */
function layoutPanel() {
  const vw = innerWidth, vh = innerHeight;
  const gap = 12;

  // 先回退到令牌尺寸（清掉可能存在的 inline，防止尺寸固化），再测量定位
  panel.style.bottom = ''; panel.style.right = ''; panel.style.width = ''; panel.style.height = '';
  const W = panel.offsetWidth, H = panel.offsetHeight;

  const br = ball.getBoundingClientRect();
  const spaceL = br.left, spaceR = vw - br.right;
  const spaceU = br.top, spaceD = vh - br.bottom;

  const openRight = spaceR >= spaceL;   // 面板在球右侧（往空间更大的一侧弹）
  const openUp    = spaceU >= spaceD;   // 面板在球上方

  let x = openRight ? br.right + gap : br.left - gap - W;
  let y = openUp    ? br.top - gap - H   : br.bottom + gap;

  // 夹取进视口
  x = Math.max(M, Math.min(vw - W - M, x));
  y = Math.max(M, Math.min(vh - H - M, y));

  // 夹取后若面板仍压住球（小视口），把球提到面板之上，保证「点球收起」始终可达
  const overlap = x < br.right + 4 && x + W > br.left - 4 && y < br.bottom + 4 && y + H > br.top - 4;
  ball.style.zIndex = overlap ? '9200' : '9000';

  panel.style.left = x + 'px'; panel.style.top = y + 'px';
  panel.style.transformOrigin = `${openRight ? 'left' : 'right'} ${openUp ? 'bottom' : 'top'}`;
}

/* ─────────── 拖拽（重写：getBoundingClientRect + 差值，吸附最近角） ─────────── */
let drag = null, suppressClick = false;

ball.addEventListener('pointerdown', (e) => {
  drag = { sx: e.clientX, sy: e.clientY, x0: state.x, y0: state.y, moved: false, id: e.pointerId };
  ball.classList.add('dragging');
  try { ball.setPointerCapture(e.pointerId); } catch {}
});
ball.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;   // drag-threshold
  drag.moved = true;
  if (panelOpen) setOpen(false);                        // 拖拽时收起，避免面板悬空
  state.x = drag.x0 + dx;
  state.y = drag.y0 + dy;
  layoutBall();
});
function endDrag(e) {
  if (!drag) return;
  const wasDrag = drag.moved;
  const id = drag.id;
  drag = null;
  ball.classList.remove('dragging');
  if (!wasDrag) return;
  suppressClick = true;   // 本次拖拽的 click 事件吞掉（若 click 未触发，用 0ms 任务兜底复位）
  setTimeout(() => { suppressClick = false; }, 0);
  // 吸附到最近角
  const cx = state.x + BALL / 2, cy = state.y + BALL / 2;
  const corners = [
    { x: M, y: M },
    { x: innerWidth - BALL - M, y: M },
    { x: M, y: innerHeight - BALL - M },
    { x: innerWidth - BALL - M, y: innerHeight - BALL - M },
  ];
  let best = corners[0], bd = 1e9;
  for (const c of corners) {
    const d = Math.hypot(c.x + BALL / 2 - cx, c.y + BALL / 2 - cy);
    if (d < bd) { bd = d; best = c; }
  }
  state.x = best.x; state.y = best.y;
  ball.style.transition = 'left 240ms cubic-bezier(.2,.8,.2,1), top 240ms cubic-bezier(.2,.8,.2,1)';
  layoutBall();
  setTimeout(() => { ball.style.transition = ''; }, 250);
  try { localStorage['dsh.spark-dock:pos'] = JSON.stringify({ x: state.x, y: state.y }); } catch {}
}
ball.addEventListener('pointerup', endDrag);
ball.addEventListener('pointercancel', endDrag);

/* 双击复位到默认右下角 */
ball.addEventListener('dblclick', () => {
  state.x = defaultPos().x; state.y = defaultPos().y;
  layoutBall(); layoutPanel();
  try { localStorage.removeItem('dsh.spark-dock:pos'); } catch {}
});

/* ─────────── 初始化 ─────────── */
function init() {
  Object.assign(state, loadPos());
  layoutBall();
  layoutPanel();
}
init();

/* ─────────── 预览控件 ─────────── */
document.querySelector('[data-theme-toggle]').onclick = (e) => {
  const d = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = d;
  e.currentTarget.textContent = d === 'dark' ? '☾ 暗色 / ☀ 亮色' : '☀ 亮色 / ☾ 暗色';
};
document.querySelector('[data-reduced-toggle]').onclick = (e) => {
  const r = document.body.dataset.reduced !== 'true';
  document.body.dataset.reduced = String(r);
  e.currentTarget.textContent = r ? '动效：减' : '动效：开';
};
