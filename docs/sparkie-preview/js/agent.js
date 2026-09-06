/* ─────────────── Sparkie · Agent Simulator 驱动 ───────────────
   agent.js 模拟一个「AI 编程 agent 的生命周期」，并把状态喂给 Pet。
   这是引擎的「业务驱动」示例：真实 DSH 场景里，这个驱动来自 spark / hippomemo /
   github / finance 的事件流；demo 里用一个脚本化的 agent 生命周期来演示。

   设计要点（对齐 Hopet）：
   - 宠物是被 agent 状态驱动的，不是自说自话。
   - 每个状态带一个 priority（越小越优先），多个来源并存时由 StateBus 仲裁。
   - source 统一用 'agent'；demo 键盘手动驱动用 'demo'（优先级更高），
     因此手动驱动会临时压过自动脚本——这正是仲裁模型的演示。
   ─────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  const STATE_PRIORITY = {
    'ask-user': 100,
    'permission': 110,
    'error': 120,
    'tool-use': 130,
    'thinking': 140,
    'responding': 150,
    'completed': 160,
    'idle': 1000,
  };

  // 一套脚本化的「任务」：从思考到收工，偶尔问用户、偶尔出错。
  function scenario() {
    return [
      { state: 'thinking',   text: '让我想想这个问题', hold: 2000 },
      { state: 'tool-use',   text: '正在读文件…',       hold: 2400 },
      { state: 'tool-use',   text: '跑测试看结果…',      hold: 2600 },
      { state: 'thinking',   text: '嗯，这个方案可行',   hold: 1900 },
      { state: 'ask-user',   text: '需要你决定：方案 A 还是 B？', hold: 5200 },
      { state: 'responding', text: '好，就按你说的来',   hold: 2100 },
      { state: 'tool-use',   text: '开始写代码…',        hold: 2800 },
      { state: 'completed',  text: '搞定 ✦ 构建通过',    hold: 2800 },
      { state: 'thinking',   text: '下一步再优化下',     hold: 1800 },
      { state: 'error',      text: '糟糕，有一个测试挂了', hold: 3200 },
      { state: 'responding', text: '我来修…',            hold: 2200 },
    ];
  }

  function AgentSimPlugin(opts = {}) {
    const cfg = {
      auto: true,               // 是否自动跑脚本
      initialDelayMs: 2600,     // 开场后多久开始干活
      idleGapMs: [7000, 14000], // 每轮任务后的「放空」区间（让宠物也能漫步/打盹）
      ...opts,
    };
    let timers = [];
    let busy = false;

    return {
      name: 'agent',
      init(pet) {
        this.pet = pet;
        const run = (source, state, text, hold, priority) => {
          if (priority == null) priority = STATE_PRIORITY[state] ?? 1000;
          pet.setAgentState(source, state, priority);
          if (text && pet.say) pet.say(text, null, hold);
          pet._agentState = state;   // 供 debug / 其他插件读取
        };

        // 单步驱动（外部可用）：source = 'agent' | 'demo'
        // priority 覆盖：demo 手动驱动通常传一个很低的数字（如 10）压过自动脚本。
        pet.driveState = (state, text, hold, source = 'demo', priority) => {
          run(source, state, text, hold, priority);
        };
        pet.agentIdle = (source = 'agent') => run(source, 'idle', '', 0);

        if (!cfg.auto) return;

        const pause = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); };
        const idleGap = () => cfg.idleGapMs[0] + Math.random() * (cfg.idleGapMs[1] - cfg.idleGapMs[0]);

        // 放空区间：回到 idle，让宠物自由一段时间
        const rest = (next) => {
          run('agent', 'idle', '', 0);
          pause(() => next(), idleGap());
        };

        const stepScript = (i) => {
          const script = scenario();
          if (i >= script.length) { rest(seed); return; }
          const s = script[i];
          run('agent', s.state, s.text, s.hold);
          pause(() => stepScript(i + 1), s.hold);
        };

        const seed = () => { busy = true; stepScript(0); };

        pause(() => {
          pet.emit('agent-ready');
          if (cfg.auto) seed();
        }, cfg.initialDelayMs);

        // 页面隐藏时暂停/恢复（避免后台一直演戏）
        this._onVis = () => { if (!document.hidden && busy) seed(); };
        document.addEventListener('visibilitychange', this._onVis);
      },
      events: {
        'click-when-still'() {
          // 点击桌宠时，如果正在 ask-user / error，先让它回到正常工作流
          // 由 PointerPlugin 的 click-when-still 触发。这里不做强制，交给 demo 手势。
        },
      },
      teardown() {
        timers.forEach(t => clearTimeout(t));
        timers = [];
        document.removeEventListener('visibilitychange', this._onVis);
      },
    };
  }

  global.SparkieAgents = { AgentSimPlugin, STATE_PRIORITY, scenario };
})(window);
