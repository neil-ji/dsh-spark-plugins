/* ─────────────── Sparkie · 浏览器桌宠引擎 ───────────────
   核心抽象：BehaviorNode / BehaviorTree / MoodFSM / PathPlanner / Pet
   —— 不绑定业务，所有 demo 行为都是 plugin 实例。
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
  class BehaviorTree {
    constructor(nodes) {
      this.nodes = nodes.slice().sort((a, b) => a.priority - b.priority);
      this.current = null;
    }
    step(pet, dt, ctx) {
      const node = this.nodes.find(n => n.guard(pet, ctx));
      if (node !== this.current) {
        this.current?.exit(pet, ctx);
        this.current = node;
        node?.enter(pet, ctx);
        pet.emit('behavior-change', { from: null, to: node?.name });
      }
      this.current?.tick(pet, dt, ctx);
    }
    currentName() { return this.current?.name ?? null; }
  }

  // ── 情绪状态机 ─────────────────────────────────────────────
  // data-mood 驱动 CSS 表情层；holdMs 后自动回落 idle
  class MoodFSM {
    constructor(ball, opts = {}) {
      this.ball = ball;
      this.hold = opts.defaultHold ?? 0;
      this.queue = [];          // 待回落定时器
      this.current = 'idle';
    }
    setMood(mood, holdMs) {
      this.queue.forEach(t => clearTimeout(t));
      this.queue = [];
      if (!mood || mood === 'idle') this.ball.removeAttribute('data-mood');
      else this.ball.dataset.mood = mood;
      this.current = (!mood || mood === 'idle') ? 'idle' : mood;
      const hold = holdMs ?? this.hold;
      if (hold > 0) {
        const t = setTimeout(() => {
          this.ball.removeAttribute('data-mood');
          if (this.current === mood) this.current = 'idle';
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
    hit(p, r) {
      // 简化为以当前位置为圆心、r 为半径的命中
      const dx = p.x - this.x, dy = p.y - this.y;
      return dx * dx + dy * dy <= r * r;
    }
  }

  // ── 桌宠（聚合根） ─────────────────────────────────────────
  // 构造时挂载 mount 元素，生成 sprite/mood/bt/path/plugins
  // register(plugin) 把能力挂到 pet 上；emit('event') 派发给插件
  class Pet {
    constructor(opts = {}) {
      this.mount = opts.mount;                     // 挂载点（DOM 元素）
      this.size = opts.size ?? 72;                 // px
      this.sprite = null;                          // 角色 SVG
      this.mood = null;
      this.bt = null;
      this.path = new PathPlanner();
      this.emitter = new Emitter();
      this.plugins = new Map();
      this.lastActive = Date.now();
      this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this._raf = 0; this._lastT = 0; this._visible = true;
      this._disposers = [];
    }

    // 初始化：插入 sprite、绑定 FSM、注册动画循环
    init() {
      if (!this.mount) throw new Error('[Sparkie] mount is required');
      this.mount.classList.add('sparkie-mount');
      this.mount.style.width = this.size + 'px';
      this.mount.style.height = this.size + 'px';
      // sprite 由 sparkie.js / 调用方渲染
      this.sprite = this.mount.querySelector('.sparkie-sprite');
      this.mood = new MoodFSM(this.mount);
      this._loop = this._loop.bind(this);
      this._lastT = performance.now();
      this._raf = requestAnimationFrame(this._loop);
      document.addEventListener('visibilitychange', this._onVis = () => {
        this._visible = !document.hidden;
        if (this._visible) this._lastT = performance.now();
      });
      this.emitter.emit('mount', this);
    }

    setBehaviorTree(bt) { this.bt = bt; }

    // 拖拽手势（外部 Pointer 事件传入）
    beginDrag(p) { this._drag = { fromX: this.path.x, fromY: this.path.y, p0: p, moved: false }; this.emitter.emit('drag-start', p); }
    dragMove(p) {
      if (!this._drag) return;
      const dx = p.x - this._drag.p0.x, dy = p.y - this._drag.p0.y;
      if (Math.hypot(dx, dy) > 4) this._drag.moved = true;
      if (this._drag.moved) {
        this.path.x = this._drag.fromX + dx;
        this.path.y = this._drag.fromY + dy;
        this.mount.style.transform = `translate(${this.path.x}px, ${this.path.y}px)`;
      }
    }
    endDrag() { const wasMoved = this._drag?.moved; this._drag = null; this.emitter.emit('drag-end', { moved: wasMoved }); return !!wasMoved; }
    get isDragging() { return !!this._drag; }

    // 表情
    setMood(m, holdMs) { this.mood.setMood(m, holdMs); this.lastActive = Date.now(); this.emitter.emit('mood', m); }

    // 活动心跳（点击/键盘/wheel 用于打盹检测）
    poke() { this.lastActive = Date.now(); if (this.mood.is('sleepy')) { this.setMood('poke', 650); this.emitter.emit('wake'); } }

    // 插件注册
    register(plugin) {
      if (!plugin?.name) throw new Error('[Sparkie] plugin.name required');
      this.plugins.set(plugin.name, plugin);
      plugin.init?.(this);
      // 插件事件订阅
      if (plugin.events) {
        for (const [event, fn] of Object.entries(plugin.events)) {
          this.emitter.on(event, fn);
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

    // 派发事件
    emit(event, payload) { this.emitter.emit(event, payload); }

    // 主动循环：行为树 + 漫步 + 插件轮询
    _loop(t) {
      this._raf = requestAnimationFrame(this._loop);
      const dt = this._visible ? Math.min(.1, (t - this._lastT) / 1000) : 0;
      this._lastT = t;
      if (!this._visible) return;
      const ctx = { dt, t };
      this.bt?.step(this, dt, ctx);
      // 漫步位移（仅当不在拖拽）
      if (!this.isDragging && this.path.target) {
        const step = this.path.step(dt, this.walkSpeed ?? 90);
        if (step.x || step.y) {
          this.path.x += step.x; this.path.y += step.y;
          this.mount.style.transform = `translate(${this.path.x}px, ${this.path.y}px)`;
        }
      }
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

  // ── 内置行为节点（树中常用的几个） ────────────────────────
  const BuiltinBehaviors = {
    // 拖拽中：暂停一切动态，挂 dragging 状态
    Dragging: class extends BehaviorNode {
      constructor() { super({ name: 'Dragging', priority: 50 }); }
      guard(p) { return p.isDragging; }
      enter(p) { p.mount.dataset.pose = 'dragging'; p.mount.classList.add('dragging'); }
      exit(p) { p.mount.classList.remove('dragging'); }
    },
    // 说话时：暂停漫步与漂浮
    Reading: class extends BehaviorNode {
      constructor() { super({ name: 'Reading', priority: 60 }); }
      guard(p) { return !!p._reading; }
      enter(p) { p.path.clearTarget(); }
    },
    // 应援：刚 cheer 过的高优先级表现
    Cheering: class extends BehaviorNode {
      constructor() { super({ name: 'Cheering', priority: 70 }); }
      guard(p) { return p.mood.is('cheer'); }
    },
    // 跟随：cursor 近且距离 > 40 时朝光标走
    Following: class extends BehaviorNode {
      constructor({ getCursor, radius = 220, arriveDist = 40 } = {}) {
        super({ name: 'Following', priority: 80 });
        this.getCursor = getCursor;
        this.radius = radius; this.arriveDist = arriveDist;
      }
      guard(p) {
        if (!this.getCursor) return false;
        if (p.mood.is('sleepy') || p.isDragging || p._reading) return false;
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
        // 走向距离 80 处停下（不要贴脸）
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
        super({ name: 'Wandering', priority: 90 });
        this.pad = pad; this.minIdle = minIdle; this._cooldown = 0;
      }
      guard(p) {
        if (p.isDragging || p._reading) return false;
        if (p.mood.is('sleepy') || p.mood.is('cheer') || p.mood.is('alert')) return false;
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
      enter(p) { p.mount.dataset.pose = 'walking'; }
      exit(p) { p.mount.dataset.pose = 'stand'; }
    },
    // 打盹：长期无活动
    Sleeping: class extends BehaviorNode {
      constructor({ idleMs = 45000 } = {}) {
        super({ name: 'Sleeping', priority: 200 });
        this.idleMs = idleMs;
      }
      guard(p) { return Date.now() - p.lastActive > this.idleMs && !p._reading; }
      enter(p) { p.setMood('sleepy'); p.path.clearTarget(); }
      exit(p) { if (p.mood.is('sleepy')) p.setMood('idle'); }
    },
    // Idle：呼吸浮沉 + 随机眨眼
    Idle: class extends BehaviorNode {
      constructor() { super({ name: 'Idle', priority: 100 }); }
      guard() { return true; }
      tick(p) {
        // Idle 由 CSS 动画驱动；引擎层面无副作用
      }
    },
  };

  // ── 工具：键盘吸附 ─────────────────────────────────────────
  function bindKeyboardMove(pet, step = 24) {
    function onKey(e) {
      if (!pet.mount.contains(document.activeElement) && document.activeElement !== pet.mount) return;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const v = map[e.key]; if (!v) return;
      e.preventDefault();
      pet.path.x += v[0]; pet.path.y += v[1];
      pet.mount.style.transform = `translate(${pet.path.x}px, ${pet.path.y}px)`;
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }

  // 导出
  global.Sparkie = {
    Emitter, BehaviorNode, BehaviorTree, MoodFSM, PathPlanner, Pet,
    BuiltinBehaviors, bindKeyboardMove,
  };
})(window);
