/* ─────────── Fairy 人格动效引擎（纯 UI 模拟，无 AI） ─────────── */
const faceBall = document.getElementById('ball');
const bubbleEl = document.createElement('div');
bubbleEl.className = 'dock-bubble';
bubbleEl.setAttribute('role', 'status');
bubbleEl.setAttribute('aria-live', 'polite');
document.body.appendChild(bubbleEl);

let moodTimer = 0, bubbleTimer = 0, blinkTimer = 0, lastActive = Date.now();

/* 心情状态机：data-mood 驱动 CSS 表情层；holdMs 后自动回落 idle */
function setMood(mood, holdMs = 0) {
  clearTimeout(moodTimer);
  if (!mood || mood === 'idle') faceBall.removeAttribute('data-mood');
  else faceBall.dataset.mood = mood;
  if (holdMs > 0) moodTimer = setTimeout(() => faceBall.removeAttribute('data-mood'), holdMs);
}

/* 随机眨眼（sleepy/cheer/greet 时跳过，它们自带眼型） */
(function () {
  const tick = () => {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      const m = faceBall.dataset.mood || '';
      if (document.body.dataset.reduced !== 'true' && !['sleepy','cheer','greet'].includes(m)) {
        faceBall.classList.add('blink');
        setTimeout(() => faceBall.classList.remove('blink'), 150);
      }
      tick();
    }, 2600 + Math.random() * 3800);
  };
  tick();
})();

/* 视线跟随：瞳孔朝光标偏移（rAF 节流；sleepy 时罢工） */
let pupilRaf = 0;
window.addEventListener('pointermove', (e) => {
  lastActive = Date.now();
  if (pupilRaf) return;
  pupilRaf = requestAnimationFrame(() => {
    pupilRaf = 0;
    if (faceBall.dataset.mood === 'sleepy') return;
    const r = faceBall.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 160);
    const tx = (dx / d) * 2.2 * k, ty = (dy / d) * 1.8 * k;
    faceBall.querySelectorAll('.pupil').forEach(p => { p.style.transform = `translate(${tx}px, ${ty}px)`; });
  });
}, { passive: true });

/* 播报气泡：面板开→侧向避让；球近顶→向下弹 */
function positionBubble() {
  const r = faceBall.getBoundingClientRect(), M = 12;
  const bw = bubbleEl.offsetWidth, bh = bubbleEl.offsetHeight;
  bubbleEl.classList.remove('below', 'tail-right');
  let x, y;
  if (panelOpen) {
    const ballLeft = (r.left + r.width / 2) < innerWidth / 2;
    if (ballLeft) { x = r.right + 10; bubbleEl.classList.add('tail-right'); }
    else x = r.left - bw - 10;
    y = r.top + r.height / 2 - bh / 2;
  } else {
    const below = r.top - bh - 14 < M;
    if (below) { y = r.bottom + 12; bubbleEl.classList.add('below'); }
    else y = r.top - bh - 12;
    // 球贴边时气泡改侧向弹出，避免被视口夹成一条竖条
    const roomR = innerWidth - r.right, roomL = r.left;
    if (roomR < 150 && roomL > roomR) { x = r.left - bw - 10; bubbleEl.classList.add('tail-right'); }
    else if (roomL < 150) { x = r.right + 10; bubbleEl.classList.add('tail-right'); }
    else x = r.left + r.width / 2 - bw / 2;
  }
  x = Math.max(M, Math.min(innerWidth - bw - M, x));
  y = Math.max(M, Math.min(innerHeight - bh - M, y));
  bubbleEl.style.left = x + 'px';
  bubbleEl.style.top = y + 'px';
}
function bubble(html, src, hold = 4000) {
  bubbleEl.innerHTML = html + (src ? `<span class="src">— ${src}</span>` : '');
  positionBubble();
  bubbleEl.classList.add('show');
  faceBall.classList.add('talking');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubbleEl.classList.remove('show');
    faceBall.classList.remove('talking');
  }, hold);
}
window.addEventListener('resize', () => { if (bubbleEl.classList.contains('show')) positionBubble(); });

/* 实时事件播报（演示用模拟器；真实接入点见 design.md §8） */
const EVENTS = [
  { html: '新增记忆「<b>边做边提交</b>」', src: 'HippoMemo · put', mood: 'alert' },
  { html: '引用了 <b>3</b> 条记忆（前额叶放行）', src: 'HippoMemo · recall', mood: 'alert' },
  { html: '火花结晶成功 → HippoMemo', src: 'Sparks · crystallize', mood: 'cheer' },
  { html: '涌现提议 <b>+2</b> 待决议', src: 'Sparks · reflect', mood: 'think' },
  { html: '社区价格表同步完成 · fx 7.2', src: 'Finance · sync', mood: 'happy' },
  { html: 'npm 发布成功 <b>dsh-spark-ui@0.2.0</b>', src: 'npm · publish', mood: 'cheer' },
  { html: 'GitHub 连接测试失败 · 401', src: 'GitHub · test', mood: 'sad' },
];
function fireEvent(i) {
  const ev = EVENTS[i === undefined ? Math.floor(Math.random() * EVENTS.length) : i];
  lastActive = Date.now();
  setMood(ev.mood, ev.mood === 'cheer' ? 2600 : 3400);
  bubble(ev.html, ev.src, 4200);
}
setInterval(() => {
  if (!document.hidden && Date.now() - lastActive < 120000 && !faceBall.dataset.mood) fireEvent();
}, 22000);

/* 打盹：45s 无操作且面板关着 → 睡；任意交互 → 惊醒 */
setInterval(() => {
  if (Date.now() - lastActive > 45000 && !faceBall.dataset.mood && !panelOpen) setMood('sleepy');
}, 5000);
const wake = () => {
  lastActive = Date.now();
  if (faceBall.dataset.mood === 'sleepy') {
    setMood('poke', 650);
    setTimeout(() => bubble('呜…我睡着了', 'Fairy', 2200), 150);
  }
};
window.addEventListener('pointerdown', wake, { capture: true });
window.addEventListener('keydown', wake, { capture: true });

/* 演示按钮 */
document.querySelectorAll('[data-fairy]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.fairy;
  lastActive = Date.now();
  if (k === 'event') { fireEvent(); return; }
  if (k === 'sleepy') { setMood('sleepy'); return; }
  setMood(k, k === 'cheer' ? 2600 : 3200);
  if (k === 'greet') bubble('嗨，我是 <b>Spark</b> ✦ 五个插件都归我管', 'Fairy 模式 · 演示', 3400);
  if (k === 'think') bubble('让我想想…', '处理中', 2800);
  if (k === 'cheer') bubble('好耶！任务完成 ✦', null, 2600);
}));

/* 开场打招呼 */
setTimeout(() => {
  setMood('greet', 2400);
  bubble('嗨，我是 <b>Spark</b> ✦ 五个插件都归我管', 'Fairy 模式 · 演示', 3600);
}, 900);
