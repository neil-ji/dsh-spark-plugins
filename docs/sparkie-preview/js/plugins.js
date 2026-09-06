/* ─────────────── Sparkie · 内置插件集合 ───────────────
   每个插件都是 init(pet)/events/teardown 三段式。
   真实生产中可被业务替换；demo 中作为默认能力装配。
   ────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  // ── Bubble：说话气泡（aria-live polite；面板开时侧向避让） ──
  function BubblePlugin(opts = {}) {
    const cfg = { hold: 4000, maxWidth: 260, ...opts };
    let el = null, timer = 0, panelOpen = false;
    return {
      name: 'bubble',
      init(pet) {
        el = document.createElement('div');
        el.className = 'sparkie-bubble';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.style.maxWidth = cfg.maxWidth + 'px';
        document.body.appendChild(el);
        pet.events = pet.events || {};
        pet.say = (html, src, hold = cfg.hold) => {
          el.innerHTML = html + (src ? `<span class="src">— ${src}</span>` : '');
          this._position(pet);
          el.classList.add('show');
          pet.mount.classList.add('talking');
          pet._reading = true;
          clearTimeout(timer);
          timer = setTimeout(() => {
            el.classList.remove('show');
            pet.mount.classList.remove('talking');
            pet._reading = false;
          }, hold);
        };
      },
      _position(pet) {
        const r = pet.mount.getBoundingClientRect();
        const bw = el.offsetWidth, bh = el.offsetHeight, M = 12;
        el.classList.remove('below', 'tail-right');
        let x, y;
        if (panelOpen) {
          const ballLeft = (r.left + r.width / 2) < innerWidth / 2;
          if (ballLeft) { x = r.right + 10; el.classList.add('tail-right'); }
          else x = r.left - bw - 10;
          y = r.top + r.height / 2 - bh / 2;
        } else {
          const below = r.top - bh - 14 < M;
          if (below) { y = r.bottom + 12; el.classList.add('below'); }
          else y = r.top - bh - 12;
          const roomR = innerWidth - r.right, roomL = r.left;
          if (roomR < 160 && roomL > roomR) { x = r.left - bw - 10; el.classList.add('tail-right'); }
          else if (roomL < 160) { x = r.right + 10; el.classList.add('tail-right'); }
          else x = r.left + r.width / 2 - bw / 2;
        }
        x = Math.max(M, Math.min(innerWidth - bw - M, x));
        y = Math.max(M, Math.min(innerHeight - bh - M, y));
        el.style.left = x + 'px'; el.style.top = y + 'px';
      },
      events: {
        'panel-open'() { panelOpen = true; if (el?.classList.contains('show')) this._position?.(); },
        'panel-close'() { panelOpen = false; if (el?.classList.contains('show')) this._position?.(); },
        'panel-toggle'(open) { panelOpen = !!open; if (el?.classList.contains('show')) this._position?.(); },
      },
      teardown() { clearTimeout(timer); el?.remove(); },
    };
  }

  // ── Sense：视线跟随（瞳孔朝光标偏移；rAF 节流） ──
  function SensePlugin(opts = {}) {
    const cfg = { range: 220, gain: 2.2, ...opts };
    let raf = 0, listeners = [];
    return {
      name: 'sense',
      init(pet) {
        const handler = (e) => {
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0;
            if (pet.mood.is('sleepy')) return;
            const r = pet.mount.getBoundingClientRect();
            const dx = e.clientX - (r.left + r.width / 2);
            const dy = e.clientY - (r.top + r.height / 2);
            const d = Math.hypot(dx, dy) || 1;
            const k = Math.min(1, d / cfg.range);
            const tx = (dx / d) * cfg.gain * k;
            const ty = (dy / d) * (cfg.gain * .8) * k;
            pet.mount.querySelectorAll('.pupil').forEach(p => {
              p.style.transform = `translate(${tx}px, ${ty}px)`;
            });
          });
        };
        window.addEventListener('pointermove', handler, { passive: true });
        listeners.push(() => window.removeEventListener('pointermove', handler));
      },
      teardown() { listeners.forEach(off => off()); listeners = []; },
    };
  }

  // ── Pointer：拖拽 + 吸附到最近角 + 键盘替代 ──
  function PointerPlugin(opts = {}) {
    const cfg = { anchor: 22, dragThreshold: 4, onClick: null, onDouble: null, ...opts };
    let downAt = 0, downX = 0, downY = 0, listeners = [];
    return {
      name: 'pointer',
      init(pet) {
        const onDown = (e) => {
          pet.poke();
          const p = pointFromEvent(e);
          pet.beginDrag(p);
          downAt = Date.now();
          downX = p.x; downY = p.y;
        };
        const onMove = (e) => {
          if (!pet.isDragging) return;
          pet.dragMove(pointFromEvent(e));
        };
        const onUp = (e) => {
          if (!pet.isDragging) return;
          const moved = pet.endDrag();
          if (moved) {
            snapToCorner(pet, cfg.anchor);
          } else {
            // 视为 click
            if (Date.now() - downAt < 350) {
              cfg.onClick?.(e);
              // 同时向 pet 事件总线派发，供其他插件订阅
              pet.emit('click-when-still', e);
            }
          }
        };
        const onDbl = () => { cfg.onDouble?.(); pet.emit('double-click'); };
        const onKey = (e) => {
          if (!pet.mount.contains(document.activeElement) && document.activeElement !== pet.mount) return;
          const map = { ArrowLeft: [-cfg.anchor, 0], ArrowRight: [cfg.anchor, 0], ArrowUp: [0, -cfg.anchor], ArrowDown: [0, cfg.anchor] };
          const v = map[e.key];
          if (!v) return;
          e.preventDefault();
          pet.path.x = Math.max(0, Math.min(innerWidth - pet.size, pet.path.x + v[0]));
          pet.path.y = Math.max(0, Math.min(innerHeight - pet.size, pet.path.y + v[1]));
          pet.applyPosition();
        };
        pet.mount.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerup', onUp);
        pet.mount.addEventListener('dblclick', onDbl);
        window.addEventListener('keydown', onKey);
        listeners.push(() => pet.mount.removeEventListener('pointerdown', onDown));
        listeners.push(() => window.removeEventListener('pointermove', onMove));
        listeners.push(() => window.removeEventListener('pointerup', onUp));
        listeners.push(() => pet.mount.removeEventListener('dblclick', onDbl));
        listeners.push(() => window.removeEventListener('keydown', onKey));
      },
      teardown() { listeners.forEach(off => off()); listeners = []; },
    };
  }

  // 拖拽松手后吸附到最近的屏幕角（左上/右上/左下/右下）
  function snapToCorner(pet, pad = 22) {
    const r = pet.mount.getBoundingClientRect();
    const midX = innerWidth / 2, midY = innerHeight / 2;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const x = cx < midX ? pad : innerWidth - pet.size - pad;
    const y = cy < midY ? pad : innerHeight - pet.size - pad;
    pet.path.x = x; pet.path.y = y;
    pet.applyPosition();
    pet.emit('snap', { x, y });
  }

  function pointFromEvent(e) {
    if (e.touches?.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  // ── Talk：随机事件播报（前台 + 近 2 分钟有互动才触发） ──
  function TalkPlugin(opts = {}) {
    const cfg = { events: [], intervalMs: 22000, ...opts };
    let timer = 0;
    return {
      name: 'talk',
      init(pet) {
        const fire = (i) => {
          if (!cfg.events.length) return;
          if (document.hidden) return;
          if (Date.now() - pet.lastActive > 120000) return;
          if (pet._reading) return;
          if (pet.agentState && pet.agentState !== 'idle') return;   // agent 驱动时不抢戏
          const ev = cfg.events[i === undefined ? Math.floor(Math.random() * cfg.events.length) : i];
          pet.setMood(ev.mood, ev.holdMs);
          if (pet.say) pet.say(ev.html, ev.src, 4200);
        };
        timer = setInterval(() => fire(undefined), cfg.intervalMs);
        pet._fireEvent = fire;
      },
      teardown() { clearInterval(timer); },
    };
  }

  // ── Dock：内置侧抽屉（精简版 dock，5 模块占位；非完整业务） ──
  function DockPlugin(opts = {}) {
    const cfg = { modules: [], defaultOpen: false, ...opts };
    let panelEl = null, opened = false;
    return {
      name: 'dock',
      init(pet) {
        panelEl = document.createElement('aside');
        panelEl.className = 'sparkie-panel';
        panelEl.setAttribute('role', 'dialog');
        panelEl.setAttribute('aria-label', 'Sparkie Dock');
        panelEl.setAttribute('aria-hidden', 'true');
        panelEl.innerHTML = `
          <header class="sparkie-panel-head">
            <div class="title" id="sparkiePanelTitle">${cfg.modules[0]?.label ?? 'Sparkie'}</div>
            <button class="sparkie-panel-close" aria-label="关闭">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
          </header>
          <nav class="sparkie-panel-nav" aria-label="模块"></nav>
          <div class="sparkie-panel-body"></div>`;
        document.body.appendChild(panelEl);

        const nav = panelEl.querySelector('.sparkie-panel-nav');
        const body = panelEl.querySelector('.sparkie-panel-body');
        const title = panelEl.querySelector('.sparkiePanelTitle, .title');
        cfg.modules.forEach((m, i) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'sparkie-panel-tab';
          btn.dataset.id = m.id;
          btn.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
          btn.innerHTML = `
            <span class="dot" style="background:${m.accent ?? 'var(--role-accent)'}"></span>
            <span class="lbl">${m.label}</span>
            <span class="badge" hidden>0</span>`;
          btn.addEventListener('click', () => activate(m.id));
          nav.appendChild(btn);
        });
        function activate(id) {
          const m = cfg.modules.find(x => x.id === id);
          if (!m) return;
          [...nav.children].forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id ? 'true' : 'false'));
          if (title) title.textContent = m.label;
          body.innerHTML = '';
          (m.render?.(body, pet) ?? Promise.resolve()).then?.((node) => { if (node) body.appendChild(node); });
        }
        panelEl.querySelector('.sparkie-panel-close').addEventListener('click', () => close());
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && opened) close(); });

        function open() {
          if (opened) return;
          opened = true;
          panelEl.setAttribute('aria-hidden', 'false');
          panelEl.classList.add('open');
          pet.mount.setAttribute('aria-expanded', 'true');
          // 位置：球上方/下方/侧方
          const r = pet.mount.getBoundingClientRect();
          const pw = 320, ph = 380, M = 16;
          panelEl.style.left = '0px'; panelEl.style.top = '0px';
          let x, y;
          if (r.left + pw + M < innerWidth) x = r.left;
          else x = r.right - pw;
          if (r.top - ph - M > 0) y = r.top - ph - 8;
          else y = r.bottom + 8;
          x = Math.max(M, Math.min(innerWidth - pw - M, x));
          y = Math.max(M, Math.min(innerHeight - ph - M, y));
          panelEl.style.transform = `translate(${x}px, ${y}px)`;
          activate(cfg.modules[0]?.id);
          pet.emit('panel-open');
        }
        function close() {
          if (!opened) return;
          opened = false;
          panelEl.classList.remove('open');
          panelEl.setAttribute('aria-hidden', 'true');
          pet.mount.setAttribute('aria-expanded', 'false');
          pet.emit('panel-close');
        }
        function toggle() { opened ? close() : open(); pet.emit('panel-toggle', opened); }

        pet.openDock = open; pet.closeDock = close; pet.toggleDock = toggle;
        if (cfg.defaultOpen) open();
      },
      events: {
        'double-click'() { this.toggleDock?.(); },     // 双击开/收 dock（单击是应援，不冲突）
      },
      teardown() { panelEl?.remove(); },
    };
  }

  global.SparkiePlugins = { BubblePlugin, SensePlugin, PointerPlugin, TalkPlugin, DockPlugin, snapToCorner };
})(window);
