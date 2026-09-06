/* ─────────────── Sparkie · 浏览器桌宠引擎 ───────────────
   核心抽象：Emitter / StateBus / BehaviorNode / BehaviorTree / MoodFSM / PathPlanner / Pet
   —— 不绑定业务，所有 demo / agent 行为都是 plugin 实例。

   与参考实现（Hopet · agent-pets）对齐的引擎设计目标：
   1. 宠物是「被驱动的」，不是「自说自话」——它反映外部 agent 状态。
   2. 多来源状态用「优先级仲裁」：AskUser > Permission > Error > Tool > Thinking > Responding > Completed > Idle。
   3. 引擎是渲染无关的：pose/frame 由 Pet 决定，具体 sprite 由外部 renderer 注入。
   ────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  // 简易事件总线
  class Emitter {
    constructor() { this.listeners = new Map(); }
    on(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event).add(fn);
      return () => this.listeners.get(event).delete(fn);
    }
    emit(event, payload) {
      const set = this.listeners.get(event);
      if (!set) return;
      for (const fn of set) {
        try { fn(payload); } catch (e) { console.error(`[Sparkie] listener for ${event} threw`, e); }
      }
    }
  }

  // ── 状态总线（优先级仲裁） ──────────────────────────────
  // 允许多个来源（agent simulator / dsh 事件 / 用户交互）同时表达"我现在想表现什么"，
  // 但实际展示的只有一个 active 状态 = 优先级最高（数字最小）的那个。
  // 来源离开（clear）后自动退化到次高优先级——这正是 Hopet 的聚合模型。
  class StateBus {
    constructor(onChange) {
      this.interest = new Map();   // source -> { state, priority }
      this.onChange = onChange;
    }
    // source: 唯一标识（如 'agent:thinking'）；priority 越小优先级越高
    set(source, state, priority = 100) {
      const prev = this.active;
      this.interest.set(source, { state, priority });
      this._bump(prev);
    }
    clear(source) {
      if (!this.interest.has(source)) return;
      const prev = this.active;
      this.interest.delete(source);
      this._bump(prev);
    }
    has(source) { return this.interest.has(source); }
    _bump(prev) {
      const next = this.active;
      if (next !== prev) this.onChange?.(next, prev);
    }
    get active() {
      let best = null, bestP = Infinity;
      for (const { state, priority } of this.interest.values()) {
        if (priority < bestP) { best = state; bestP = priority; }
      }
      return best;
    }
  }

  // ── 行为节点 ──────────────────────────────────────────────
  // 所有动作的抽象基类；tick() 每帧调用，guard() 决定是否可激活
  class BehaviorNode {
    constructor({ name, priority = 100 } = {}) {
      this.name = name;
      this.priority = priority;
      this.pet = null;
      this.ctx = null;
    }
    enter(pet, ctx) { this.pet = pet; this.ctx = ctx; }
    tick(_pet, _dt, _ctx) {}
    exit(_pet, _ctx) {}
    guard(_pet, _ctx) { return true; }
  }

  // ── 行为树（按 priority 选择首个 guard pass 的节点执行） ──
  // BehaviorTree 本身就是「仲裁器」：优先级升序排序，取第一个 guard 通过的节点。
  // agent 状态节点、拖拽、应援等都以高优先级节点形式进入同一棵树。
  class BehaviorTree {
    constructor(nodes) {
      this.nodes = nodes.slice().sort((a, b) => a.priority - b.priority);
      this.current = null;
    }
    step(pet, dt, ctx) {
      const node = this.nodes.find(n => n.guard(pet, ctx));
      if (node !== this.current) {
        const from = this.current?.name ?? null;
        this.current?.exit(pet, ctx);
        this.current = node;
        node?.enter(pet, ctx);
        pet.currentBehavior = node?.name ?? null;
        pet.emit('behavior-change', { from, to: node?.name ?? null });
        pet.syncPose();               // 行为切换可能改变 pose
      }
      node?.tick(pet, dt, ctx);
    }
    currentName() { return this.current?.name ?? null; }
  }

  // ── 情绪状态机 ─────────────────────────────────────────────
  // data-mood 驱动 CSS 表情层；holdMs 后自动回落 idle。
  // onChange 在 active mood 变化（含 hold 自动回落）时触发，便于 Pet 重新收敛 pose。
  class MoodFSM {
    constructor(ball, opts = {}) {
      this.ball = ball;
      this.hold = opts.defaultHold ?? 0;
      this.onChange = opts.onChange ?? null;
      this.queue = [];          // 待回落定时器
      this.current = 'idle';
    }
    setMood(mood, holdMs) {
      this.queue.forEach(t => clearTimeout(t));
      this.queue = [];
      if (!mood || mood === 'idle') this.ball.removeAttribute('data-mood');
      else this.ball.dataset.mood = mood;
      const prev = this.current;
      this.current = (!mood || mood === 'idle') ? 'idle' : mood;
      if (prev !== this.current) this.onChange?.(this.current, prev);
      const hold = holdMs ?? this.hold;
      if (hold > 0) {
        const t = setTimeout(() => {
          this.ball.removeAttribute('data-mood');
          if (this.current === mood) { this.current = 'idle'; this.onChange?.('idle', mood); }
        }, hold);
        this.queue.push(t);
      }
    }
    is(mood) { return this.current === mood; }
  }

  // ── 路径规划（屏幕边漫步 + 拖拽吸附） ──────────────────────
  class PathPlanner {
    constructor() { this.x = 0; this.y = 0; this.target = null; }
    setTarget(x, y) { this.target = { x, y }; }
    clearTarget() { this.target = null; }
    step(dt, speed = 80) {
      if (!this.target) return { x: 0, y: 0 };
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) return { x: 0, y: 0 };
      const k = Math.min(1, (speed * dt) / d);
      return { x: dx * k, y: dy * k };
    }
    hit(p, r) { return false; }
  }

  // ── 桌宠（聚合根） ─────────────────────────────────────────
  // 构造时挂载 mount 元素；生成 mood / bus / bt / path / plugins。
  // pose 的「权威来源」是 Pet 本身：所有来源（拖拽 / 情绪 / agent 状态 / 行为）
  // 每帧经过 syncPose() 收敛成一个 pose，交给外部 renderer 渲染。
  class Pet {
    constructor(opts = {}) {
      this.mount = opts.mount;                     // 挂载点（DOM 元素）
      this.size = opts.size ?? 72;                 // px
      this.frameIntervalMs = opts.frameIntervalMs ?? 480;
      this.loopingPoses = opts.loopingPoses ?? new Set(['stand', 'walk', 'sit', 'sleep']);
      this.renderer = opts.renderer ?? null;       // { render(pose, frame) => htmlString }
      this.sprite = null;                          // 角色 SVG
      this.mood = null;
      this.bt = null;
      this.path = new PathPlanner();
      this.emitter = new Emitter();
      this.bus = new StateBus((next, prev) => this._agentStateChanged(next, prev));
      this.plugins = new Map();
      this.pose = 'stand';
      this.frame = 0;
      this.currentBehavior = null;
      this.lastActive = Date.now();
      this.walkSpeed = opts.walkSpeed ?? 90;
      this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this._raf = 0; this._lastT = 0; this._visible = true;
      this._frameT = 0;
      this._disposers = [];
    }

    // 初始化：更新 mount、绑定 FSM、注册动画循环
    init() {
      if (!this.mount) throw new Error('[Sparkie] mount is required');
      this.mount.classList.add('sparkie-mount');
      this.mount.style.width = this.size + 'px';
      this.mount.style.height = this.size + 'px';
      this.mood = new MoodFSM(this.mount, { onChange: () => this.syncPose() });
      this.mount.setAttribute('data-pose', this.pose);
      // 初始位置：默认底部居中（path 坐标 = 视口左上角绝对坐标）
      if (this.startPos) { this.path.x = this.startPos.x; this.path.y = this.startPos.y; }
      else if (this.startCenter !== false) {
        this.path.x = Math.round((innerWidth - this.size) / 2);
        this.path.y = Math.round(innerHeight - this.size - (this.startBottom ?? 20));
      }
      this.applyPosition();
      this._loop = this._loop.bind(this);
      this._lastT = performance.now();
      this._raf = requestAnimationFrame(this._loop);
      document.addEventListener('visibilitychange', this._onVis = () => {
        this._visible = !document.hidden;
        if (this._visible) this._lastT = performance.now();
      });
      this.renderSprite();
      this.emitter.emit('mount', this);
    }

    // 位置通过 left/top 直接控制（path = 视口左上角绝对坐标），
    // 这样 CSS pose 动画可以独占 transform 做 bob/scale/rotate，互不干扰。
    applyPosition() {
      this.mount.style.left = this.path.x + 'px';
      this.mount.style.top = this.path.y + 'px';
    }

    setBehaviorTree(bt) { this.bt = bt; }

    // ── agent 状态驱动 ──────────────────────────────────────
    // 外部来源（agent simulator / dsh 事件）通过 setInterest 表达状态。
    // 多个来源并存时以优先级仲裁，见 StateBus 注释。
    setAgentState(source, state, priority) { this.bus.set(source, state, priority); }
    clearAgentState(source) { this.bus.clear(source); }
    get agentState() { return this.bus.active; }
    _agentStateChanged(next, prev) {
      if (next !== prev) this.emitter.emit('agent-state', next);
      this.syncPose();
    }

    // ── pose 权威收敛 ───────────────────────────────────────
    // 每个来源都只是「期望」，这里按优先级收敛出最终 pose。
    // 渲染无关：这里只决定 pose 字符串，sprite 由 renderer 画。
    syncPose() {
      let pose = 'stand';
      if (this.isDragging) pose = 'drag';
      else if (this.mood?.is('cheer')) pose = 'cheer';
      else if (this.mood?.is('sleepy')) pose = 'sleep';
      else if (this.agentState && this.agentState !== 'idle') pose = Pet.POSE_BY_AGENT_STATE[this.agentState] || 'think';
      else if (this.currentBehavior === 'Wandering' || this.currentBehavior === 'Following') pose = 'walk';
      this.setPose(pose);
    }

    // ── pose / 帧渲染（dedupe） ─────────────────────────────
    setPose(pose) {
      if (!pose || pose === this.pose) return;
      this.pose = pose;
      this.frame = 0;                              // pose 切换重置帧
      this.mount.dataset.pose = pose;
      this.renderSprite();
      this.emitter.emit('pose', pose);
    }
    renderSprite() {
      if (this.renderer) {
        const html = this.renderer.render(this.pose, this.frame);
        if (html) this.sprite = html;              // 记录供外部读取
      }
      if (this.sprite && this.mount) {
        // 只替换 sprite 容器，保留 mount 自身的 pointer 事件
        let host = this.mount.querySelector('.sparkie-sprite-host');
        if (!host) {
          host = document.createElement('div');
          host.className = 'sparkie-sprite-host';
          this.mount.appendChild(host);
        }
        host.innerHTML = this.sprite;
      }
    }
    _advanceFrame(dt) {
      if (!this.loopingPoses.has(this.pose)) return;
      this._frameT += dt * 1000;
      if (this._frameT < this.frameIntervalMs) return;
      const n = this._frameT / this.frameIntervalMs | 0;
      this._frameT -= n * this.frameIntervalMs;
      // 帧数由 renderer 决定：先无条件 +1，renderer 内部 map 到真实的帧数组长度
      this.frame += 1;
      this.renderSprite();
    }

    // ── 拖拽手势（外部 Pointer 事件传入） ──────────────────
    beginDrag(p) {
      this._drag = { fromX: this.path.x, fromY: this.path.y, p0: p, moved: false };
      this.emitter.emit('drag-start', p);
      this.syncPose();
    }
    dragMove(p) {
      if (!this._drag) return;
      const dx = p.x - this._drag.p0.x, dy = p.y - this._drag.p0.y;
      if (Math.hypot(dx, dy) > 4) this._drag.moved = true;
      if (this._drag.moved) {
        this.path.x = this._drag.fromX + dx;
        this.path.y = this._drag.fromY + dy;
        this.applyPosition();
      }
    }
    endDrag() {
      const wasMoved = this._drag?.moved;
      this._drag = null;
      this.syncPose();
      this.emitter.emit('drag-end', { moved: wasMoved });
      return !!wasMoved;
    }
    get isDragging() { return !!this._drag; }

    // ── 表情 ────────────────────────────────────────────────
    setMood(m, holdMs) {
      this.mood.setMood(m, holdMs);
      this.lastActive = Date.now();
      this.emitter.emit('mood', m);
      this.syncPose();                              // cheer / sleepy 改变 pose
    }

    // ── 活动心跳（点击/键盘/wheel 用于打盹检测） ─────────────
    poke() {
      this.lastActive = Date.now();
      if (this.mood?.is('sleepy')) { this.setMood('poke', 650); this.emitter.emit('wake'); }
      this.syncPose();
    }

    // ── 插件注册 ────────────────────────────────────────────
    register(plugin) {
      if (!plugin?.name) throw new Error('[Sparkie] plugin.name required');
      this.plugins.set(plugin.name, plugin);
      plugin.init?.(this);
      if (plugin.events) {
        for (const [event, fn] of Object.entries(plugin.events)) {
          this.emitter.on(event, fn.bind(plugin));
        }
      }
      return () => this.unregister(plugin.name);
    }
    unregister(name) {
      const plugin = this.plugins.get(name);
      if (!plugin) return;
      plugin.teardown?.(this);
      this.plugins.delete(name);
    }

    // ── 派发事件 ────────────────────────────────────────────
    emit(event, payload) { this.emitter.emit(event, payload); }
    // 订阅 Pet 级事件（返回取消函数）；plugin 别用这个，走 register()
    on(event, fn) { return this.emitter.on(event, fn); }

    // ── 主动循环：行为树 + 漫步 + 姿态收敛 + 插件轮询 ────────
    _loop(t) {
      this._raf = requestAnimationFrame(this._loop);
      const dt = this._visible ? Math.min(.1, (t - this._lastT) / 1000) : 0;
      this._lastT = t;
      if (!this._visible) return;
      const ctx = { dt, t };
      // 每帧收敛一次 pose（拖拽/情绪/agent 状态/行为 可能都变了）
      this.syncPose();
      this.bt?.step(this, dt, ctx);
      // 漫步位移（仅当不在拖拽）
      if (!this.isDragging && this.path.target) {
        const step = this.path.step(dt, this.walkSpeed);
        if (step.x || step.y) {
          this.path.x += step.x; this.path.y += step.y;
          this.applyPosition();
        }
      }
      this._advanceFrame(dt);
      this.emitter.emit('tick', ctx);
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      for (const d of this._disposers) d();
      for (const p of this.plugins.values()) p.teardown?.(this);
      this.plugins.clear();
      document.removeEventListener('visibilitychange', this._onVis);
    }
  }

  // agent 状态 -> pose 的映射（缺失时 fallback 'think'）
  Pet.POSE_BY_AGENT_STATE = {
    'thinking': 'think',
    'tool-use': 'work',
    'responding': 'stand',
    'ask-user': 'alert',
    'permission': 'alert',
    'error': 'error',
    'completed': 'cheer',
  };

  // ── 内置行为节点（树中常用的几个） ────────────────────────
  const BuiltinBehaviors = {
    // 拖拽中：暂停一切动态，挂 dragging 状态
    Dragging: class extends BehaviorNode {
      constructor() { super({ name: 'Dragging', priority: 40 }); }
      guard(p) { return p.isDragging; }
      enter(p) { p.mount.dataset.pose = 'dragging'; p.mount.classList.add('dragging'); }
      exit(p) { p.mount.classList.remove('dragging'); }
    },
    // 说话时：暂停漫步与漂浮
    Reading: class extends BehaviorNode {
      constructor() { super({ name: 'Reading', priority: 50 }); }
      guard(p) { return !!p._reading; }
      enter(p) { p.path.clearTarget(); }
    },
    // 应援：刚 cheer 过的高优先级表现
    Cheering: class extends BehaviorNode {
      constructor() { super({ name: 'Cheering', priority: 60 }); }
      guard(p) { return p.mood.is('cheer'); }
    },
    // agent 状态节点工厂：每个状态一个节点，优先级即 Hopet 仲裁顺序
    AgentState(stateName, pose, priority) {
      return class extends BehaviorNode {
        constructor() { super({ name: `Agent:${stateName}`, priority }); this.pose = pose; }
        guard(p) { return p.agentState === stateName; }
        enter(p) { p.path.clearTarget(); }          // agent 驱动时暂停漫步
      };
    },
    // 跟随：cursor 近且距离 > 40 时朝光标走
    Following: class extends BehaviorNode {
      constructor({ getCursor, radius = 220, arriveDist = 40 } = {}) {
        super({ name: 'Following', priority: 170 });
        this.getCursor = getCursor;
        this.radius = radius; this.arriveDist = arriveDist;
      }
      guard(p) {
        if (!this.getCursor) return false;
        if (p.mood.is('sleepy') || p.isDragging || p._reading) return false;
        if (p.agentState && p.agentState !== 'idle') return false;   // agent 驱动时不跟随
        const c = this.getCursor();
        if (!c) return false;
        const rect = p.mount.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        const d = Math.hypot(c.x - cx, c.y - cy);
        return d > this.arriveDist && d < this.radius;
      }
      tick(p, dt) {
        const c = this.getCursor();
        if (!c) return;
        const rect = p.mount.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        const dx = c.x - cx, dy = c.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        const stop = this.arriveDist + 40;
        const tx = cx + (dx / d) * stop - rect.width / 2 - p.path.x;
        const ty = cy + (dy / d) * stop - rect.height / 2 - p.path.y;
        p.path.setTarget(tx, ty);
      }
      exit(p) { p.path.clearTarget(); }
    },
    // 漫步：随机挑屏幕边一点走去
    Wandering: class extends BehaviorNode {
      constructor({ pad = 80, minIdle = 2000 } = {}) {
        super({ name: 'Wandering', priority: 180 });
        this.pad = pad; this.minIdle = minIdle; this._cooldown = 0;
      }
      guard(p) {
        if (p.isDragging || p._reading) return false;
        if (p.mood.is('sleepy') || p.mood.is('cheer') || p.mood.is('alert')) return false;
        if (p.agentState && p.agentState !== 'idle') return false;   // agent 驱动时不漫步
        return Date.now() - p.lastActive > this.minIdle && Math.random() < 0.02;
      }
      tick(p) {
        const w = innerWidth, h = innerHeight;
        const edges = [
          { x: this.pad + Math.random() * (w - 2 * this.pad), y: this.pad },
          { x: this.pad + Math.random() * (w - 2 * this.pad), y: h - this.pad },
          { x: this.pad, y: this.pad + Math.random() * (h - 2 * this.pad) },
          { x: w - this.pad, y: this.pad + Math.random() * (h - 2 * this.pad) },
        ];
        const e = edges[Math.floor(Math.random() * edges.length)];
        const rect = p.mount.getBoundingClientRect();
        p.path.setTarget(e.x - rect.width / 2 - p.path.x, e.y - rect.height / 2 - p.path.y);
      }
      enter(p) { p.syncPose(); }
      exit(p) { p.syncPose(); }
    },
    // 打盹：长期无活动
    Sleeping: class extends BehaviorNode {
      constructor({ idleMs = 45000 } = {}) {
        super({ name: 'Sleeping', priority: 190 });
        this.idleMs = idleMs;
      }
      guard(p) { return Date.now() - p.lastActive > this.idleMs && !p._reading; }
      enter(p) { p.setMood('sleepy'); p.path.clearTarget(); }
      exit(p) { if (p.mood.is('sleepy')) p.setMood('idle'); }
    },
    // Idle：呼吸浮沉 + 随机眨眼
    Idle: class extends BehaviorNode {
      constructor() { super({ name: 'Idle', priority: 200 }); }
      guard() { return true; }
      tick(p) { /* Idle 由 CSS 动画驱动；引擎层面无副作用 */ }
    },
  };

  // ── 工具：键盘吸附（↑↓←→ 移动，作为拖拽的无障碍替代） ──────
  function bindKeyboardMove(pet, step = 24) {
    function onKey(e) {
      if (!pet.mount.contains(document.activeElement) && document.activeElement !== pet.mount) return;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const v = map[e.key]; if (!v) return;
      e.preventDefault();
      pet.path.x += v[0]; pet.path.y += v[1];
      pet.applyPosition();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }

  // 组装 agent 状态行为节点数组（优先级即仲裁顺序）
  function buildAgentBehaviorNodes() {
    const order = [
      ['ask-user', 'alert', 100],
      ['permission', 'alert', 110],
      ['error', 'error', 120],
      ['tool-use', 'work', 130],
      ['thinking', 'think', 140],
      ['responding', 'stand', 150],
      ['completed', 'cheer', 160],
    ];
    return order.map(([s, pose, pri]) => new (BuiltinBehaviors.AgentState(s, pose, pri))());
  }

  // 默认行为树：agent 状态节点 + 交互节点 + ambient 节点
  function defaultBehaviorTree() {
    return new BehaviorTree([
      new BuiltinBehaviors.Dragging(),
      new BuiltinBehaviors.Reading(),
      new BuiltinBehaviors.Cheering(),
      ...buildAgentBehaviorNodes(),
      new BuiltinBehaviors.Following(),
      new BuiltinBehaviors.Wandering(),
      new BuiltinBehaviors.Sleeping(),
      new BuiltinBehaviors.Idle(),
    ]);
  }

  // 导出
  global.Sparkie = {
    Emitter, StateBus, BehaviorNode, BehaviorTree, MoodFSM, PathPlanner, Pet,
    BuiltinBehaviors, bindKeyboardMove, buildAgentBehaviorNodes, defaultBehaviorTree,
  };
})(window);
