/* ─────────────── Sparkie · 桌宠剧场（Engine 驱动版） ───────────────
   本文件只是「装配层」：创建 Pet + 默认行为树 + 插件 + agent 模拟器。
   之前 demo.js 自己用 setInterval / 手动 pose 追踪 / 手动拖拽的那套逻辑
   已全部移除——现在 pose / 帧 / 情绪 / 漫步 / 拖拽 / 状态仲裁都归引擎管。

   快捷键：
     S 切肤 · T 主题 · R 降低动效 · 空格 眨眼
     1-7 手动驱动 agent 状态（demo 源，优先级压过自动脚本）
     0 / Esc  释放手动状态，回落到自动脚本
     ↑↓←→ 移动（拖拽的无障碍替代） · 双击 开/收 dock
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const { Pet, defaultBehaviorTree } = window.Sparkie;
  const SparkiePlugins = window.SparkiePlugins;
  const { AgentSimPlugin } = window.SparkieAgents;
  const { buildSpriteSVG, SPARKIE, PALETTE } = window.SparkieChars;

  let skinId = SPARKIE.skin;   // 'blue'

  // ── 挂载点（button 便于键盘 focus + 无障碍） ──────────────
  const mount = document.createElement('button');
  mount.className = 'sparkie-mount';
  mount.setAttribute('aria-label', 'Sparkie 桌宠');
  mount.tabIndex = 0;
  document.body.appendChild(mount);

  // ── 渲染器（依赖注入；这是唯一的渲染知识入口） ────────────
  const renderer = {
    render(pose, frame) { return buildSpriteSVG(skinId, pose, frame); },
  };

  // ── Pet（引擎聚合根） ─────────────────────────────────────
  const pet = new Pet({
    mount,
    size: 200,
    frameIntervalMs: SPARKIE.frameIntervalMs,
    loopingPoses: new Set(['stand', 'walk', 'sit', 'sleep', 'work']),
    renderer,
  });
  pet.init();
  pet.setBehaviorTree(defaultBehaviorTree());

  // ── 插件装配 ──────────────────────────────────────────────
  pet.register(SparkiePlugins.BubblePlugin());                 // 给 pet.say / _reading
  pet.register(SparkiePlugins.PointerPlugin({ onClick: onPetClick, onDouble: () => pet.toggleDock?.() }));
  pet.register(SparkiePlugins.SensePlugin());                  // 瞳孔跟随光标
  pet.register(SparkiePlugins.TalkPlugin({
    intervalMs: 26000,
    events: [
      { mood: 'think',  html: '要我帮你看看吗？', holdMs: 1400 },
      { mood: 'cheer',  html: '今天也要加油 ✦',  holdMs: 1400 },
      { mood: 'think',  html: '嗯…我在想事情',    holdMs: 1400 },
    ],
  }));
  pet.register(SparkiePlugins.DockPlugin({                     // 轻量 demo dock
    modules: [
      { id: 'overview', label: '总览', accent: PALETTE[skinId].body,
        render: (body) => { body.innerHTML = `<div class="sparkie-module">Sparkie 引擎 · Agent 状态反射<br>双击本球或按 D 打开此面板。</div>`; } },
      { id: 'state', label: '状态', accent: PALETTE[skinId].body,
        render: (body) => { body.innerHTML = `<div class="sparkie-module" id="sparkieStateModule"></div>`; } },
      { id: 'about', label: '关于', accent: PALETTE[skinId].body,
        render: (body) => { body.innerHTML = `<div class="sparkie-module">Sparkie v${SPARKIE.version}<br>通用引擎 + 角色库<br>DSH 桌宠原型</div>`; } },
    ],
  }));
  pet.register(AgentSimPlugin());                              // 模拟 agent 生命周期驱动

  // ── 单击应援（pointer 未拖动才算点击） ────────────────────
  function onPetClick() {
    if (pet.agentState === 'completed') {
      pet.say('就等这句 ✦', null, 1600);
      return;
    }
    pet.setMood('cheer', 1400);
    pet.say(['收到 ✦', '好嘞！', '嘿！', '嗯嗯'][Math.floor(Math.random() * 4)], null, 1600);
  }

  // ── 皮肤切换（渲染器闭包读取 skinId） ─────────────────────
  function switchSkin(id) {
    skinId = id;
    document.body.dataset.skin = id;
    const p = PALETTE[id];
    const rs = document.documentElement.style;
    rs.setProperty('--role-mid', p.body);
    rs.setProperty('--role-dark', p.bodyDark);
    rs.setProperty('--role-light', p.bodyLight);
    rs.setProperty('--role-glow', p.glow);
    rs.setProperty('--role-cheek', p.cheek);
    pet.renderSprite();
  }
  function cycleSkin() {
    const skins = Object.keys(PALETTE);
    switchSkin(skins[(skins.indexOf(skinId) + 1) % skins.length]);
  }

  // ── 键盘驱动（含手动 agent 状态演示仲裁） ────────────────
  const MANUAL = {
    '1': ['thinking',   '手动：思考中…',   2600],
    '2': ['tool-use',   '手动：调用工具…', 3000],
    '3': ['ask-user',   '手动：需要你决定', 3600],
    '4': ['permission', '手动：请求权限',  3600],
    '5': ['error',      '手动：出错了',    3000],
    '6': ['responding', '手动：正在回复',  2600],
    '7': ['completed',  '手动：已完成 ✦',  2600],
  };
  let manualTimer = 0;
  let manualSource = null;
  function driveManual(state, text, hold) {
    if (manualSource) { pet.clearAgentState(manualSource); clearTimeout(manualTimer); }
    manualSource = 'demo';
    pet.driveState(state, text, hold, manualSource, 10);   // 优先级 10，压过自动脚本
    manualTimer = setTimeout(() => { pet.clearAgentState(manualSource); manualSource = null; }, hold + 200);
  }
  function releaseManual() {
    if (!manualSource) return;
    clearTimeout(manualTimer);
    pet.clearAgentState(manualSource);
    manualSource = null;
    pet.agentIdle();
  }

  document.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const key = e.key.toLowerCase();
    if (key === 's') { e.preventDefault(); cycleSkin(); return; }
    if (key === 't') { document.body.dataset.theme = document.body.dataset.theme === 'dark' ? 'light' : 'dark'; return; }
    if (key === 'r') { document.body.dataset.reduced = document.body.dataset.reduced === 'true' ? 'false' : 'true'; return; }
    if (key === 'd') { e.preventDefault(); pet.toggleDock?.(); return; }
    if (key === ' ') { e.preventDefault(); pet.setMood('blink', 300); return; }
    if (key === '0' || key === 'escape') { releaseManual(); return; }
    const m = MANUAL[key];
    if (m) { e.preventDefault(); driveManual(m[0], m[1], m[2]); }
  });

  // ── 状态牌（实时展示引擎判定结果，便于观察仲裁） ──────────
  const statusEl = document.getElementById('status');
  function renderStatus() {
    const row = `<span><b>state</b> ${pet.agentState ?? 'idle'}</span>` +
      `<span><b>pose</b> ${pet.pose}</span>` +
      `<span><b>behavior</b> ${pet.currentBehavior ?? 'Idle'}</span>` +
      `<span><b>skin</b> ${skinId}</span>`;
    if (statusEl) statusEl.innerHTML = row;
    const m = document.getElementById('sparkieStateModule');
    if (m) m.innerHTML = row.replace(/<span>/g, '<div>').replace(/<\/span>/g, '</div>');
  }
  ['agent-state', 'pose', 'behavior-change'].forEach(ev => pet.on(ev, renderStatus));
  renderStatus();

  // ── 初始化 + 开场 ─────────────────────────────────────────
  document.body.classList.add('show-status');
  switchSkin(skinId);
  pet.on('agent-ready', () => { pet.setMood('cheer', 1400); pet.say('嗨 ✦ 我是 Sparkie', null, 2000); });

  // 暴露给 debug
  window.__sparkie = { pet, mount, switchSkin, driveManual, releaseManual, cycleSkin };
})();
