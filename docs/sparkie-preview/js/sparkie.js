/* ─────────────── Sparkie · 默认角色数据 + 皮肤 ───────────────
   把 sprite 抽成数据：pose × mood 矩阵，外加 4 套皮肤切换。
   实际渲染由调用方/HTML 内联 SVG 完成；本文件提供角色元数据 + 工具。
   ────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  // 皮肤清单（必须与 css/tokens.css 的 [data-skin] 同步）
  const SKINS = [
    { id: 'sparkle', label: 'Sparkle · 火花琥珀', accent: '#f59e0b', desc: '呆毛火花 · 灵感小精灵（默认）' },
    { id: 'crystal', label: 'Crystal · 蓝晶', accent: '#4d6bfe', desc: '冷静分析 · 蓝色记忆守护者' },
    { id: 'sprout', label: 'Sprout · 绿芽', accent: '#22c55e', desc: '萌芽提示 · 成本节流小园丁' },
    { id: 'pixel', label: 'Pixel · 玫粉', accent: '#ec4899', desc: '赛博 Neko · 追光者' },
  ];

  // 姿态（与 CSS data-pose 对应）
  const POSES = [
    { id: 'stand', label: '站立', icon: '🚶' },     // 仅 demo 工具栏图标位占位（实际用 SVG）
    { id: 'walking', label: '走路', icon: '🏃' },
    { id: 'sit', label: '坐', icon: '🪑' },
    { id: 'lie', label: '趴', icon: '😴' },
  ];

  // 心情列表（与 CSS data-mood 对应；color 仅用于演示面板 dot）
  const MOODS = [
    { id: 'idle', label: 'idle', accent: '#8a8172' },
    { id: 'greet', label: 'greet', accent: '#f59e0b' },
    { id: 'happy', label: 'happy', accent: '#22c55e' },
    { id: 'cheer', label: 'cheer', accent: '#f59e0b' },
    { id: 'think', label: 'think', accent: '#3b82f6' },
    { id: 'alert', label: 'alert', accent: '#ef4444' },
    { id: 'sad', label: 'sad', accent: '#3b82f6' },
    { id: 'sleepy', label: 'sleepy', accent: '#8b5cf6' },
    { id: 'poke', label: 'poke', accent: '#fbbf24' },
  ];

  // 角色出厂数据
  const SPARKIE = {
    id: 'sparkie',
    name: 'Sparkie',
    version: '0.1.0',
    size: 72,
    skin: 'sparkle',
    pose: 'stand',
    eyes: { blinkEveryMs: [2600, 6400] },     // 区间随机
    bubble: { defaultHold: 4000 },
    sleeping: { idleThresholdMs: 45000 },
    wandering: { enabled: true, minIdleMs: 6000 },
    following: { enabled: true, radius: 240, arriveDist: 60 },
  };

  // 随机眨眼定时器
  function bindBlink(ball, { blinkEveryMs }) {
    let timer = 0;
    const tick = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const mood = ball.dataset.mood || '';
        const reduced = document.body.dataset.reduced === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
        // sleepy / cheer / greet 自带眼型，跳过
        if (!reduced && !['sleepy', 'cheer', 'greet'].includes(mood)) {
          ball.classList.add('blink');
          setTimeout(() => ball.classList.remove('blink'), 150);
        }
        tick();
      }, blinkEveryMs[0] + Math.random() * (blinkEveryMs[1] - blinkEveryMs[0]));
    };
    tick();
    return () => clearTimeout(timer);
  }

  // SVG sprite 工厂（4 套皮肤的呆毛差异在这里决定；body 复用同套几何）
  function buildSpriteHTML(skin) {
    const accent = (SKINS.find(s => s.id === skin) ?? SKINS[0]).accent;
    // 呆毛 4 芒尖角：amber / 蓝晶 / 绿芽 / 玫粉；通过 fill="var(--role-accent)" 走 token
    return /* html */`
<svg class="sparkie-sprite" viewBox="0 0 72 72" aria-hidden="true">
  <!-- 呆毛（顶部 4 芒火花，可微动） -->
  <path class="ahoge" d="M36 2c.6 4 3.2 6.6 7.2 7.2-4 .6-6.6 3.2-7.2 7.2-.6-4-3.2-6.6-7.2-7.2 4-.6 6.6-3.2 7.2-7.2z" fill="var(--role-accent)"/>

  <!-- 影圈（落在地面） -->
  <ellipse class="shadow" cx="36" cy="68" rx="20" ry="2.6" fill="rgba(0,0,0,.32)"/>

  <!-- 身体（球体）：pose 切换 stand/walking/sit/lie/dragging -->
  <g class="pose stand">
    <!-- 主体 -->
    <circle cx="36" cy="42" r="22" fill="var(--spk-surface-2)" stroke="var(--role-accent)" stroke-width="2.2"/>
    <circle cx="36" cy="42" r="22" fill="url(#bodyGloss)" opacity=".6"/>
    <defs>
      <radialGradient id="bodyGloss" cx="34%" cy="32%" r="65%">
        <stop offset="0%" stop-color="rgba(255,255,255,.45)"/>
        <stop offset="60%" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
    </defs>

    <!-- 腮红 -->
    <ellipse class="blush" cx="22" cy="48" rx="4.2" ry="2.2" fill="var(--role-cheek)" opacity="0"/>
    <ellipse class="blush" cx="50" cy="48" rx="4.2" ry="2.2" fill="var(--role-cheek)" opacity="0"/>

    <!-- 眼睛 -->
    <g class="eyes">
      <g class="eye eye-l"><ellipse class="eyeball" cx="28" cy="40" rx="3" ry="4.4" fill="var(--role-eye)"/><circle class="pupil" cx="28" cy="38.4" r="1.05" fill="var(--spk-bg)"/></g>
      <g class="eye eye-r"><ellipse class="eyeball" cx="44" cy="40" rx="3" ry="4.4" fill="var(--role-eye)"/><circle class="pupil" cx="44" cy="38.4" r="1.05" fill="var(--spk-bg)"/></g>
      <g class="eyes-happy">
        <path d="M23 42 Q28 36 33 42" fill="none" stroke="var(--role-eye)" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M39 42 Q44 36 49 42" fill="none" stroke="var(--role-eye)" stroke-width="2.2" stroke-linecap="round"/>
      </g>
    </g>

    <!-- 嘴型 -->
    <path class="mouth m-smile" d="M30 50.6 Q36 55.4 42 50.6" fill="none" stroke="var(--role-mouth)" stroke-width="2" stroke-linecap="round"/>
    <ellipse class="mouth m-open" cx="36" cy="51.8" rx="3" ry="3.6" fill="var(--role-mouth)"/>
    <path class="mouth m-frown" d="M30.4 53.4 Q36 49.6 41.6 53.4" fill="none" stroke="var(--role-mouth)" stroke-width="2" stroke-linecap="round"/>
  </g>

  <!-- 配件层（应援棒） -->
  <g class="acc acc-cheer">
    <g class="stick sl"><rect x="11" y="46" width="2.4" height="16" rx="1.2" fill="var(--role-accent)"/>
      <path d="M12.2 38.6c.3 2.2 1.7 3.6 3.9 3.9-2.2.3-3.6 1.7-3.9 3.9-.3-2.2-1.7-3.6-3.9-3.9 2.2-.3 3.6-1.7 3.9-3.9z" fill="var(--role-accent)"/></g>
    <g class="stick sr"><rect x="58.6" y="46" width="2.4" height="16" rx="1.2" fill="var(--role-accent)"/>
      <path d="M59.8 38.6c.3 2.2 1.7 3.6 3.9 3.9-2.2.3-3.6 1.7-3.9 3.9-.3-2.2-1.7-3.6-3.9-3.9 2.2-.3 3.6-1.7 3.9-3.9z" fill="var(--role-accent)"/></g>
  </g>

  <!-- 配件层（思考泡） -->
  <g class="acc acc-think" fill="var(--role-accent)">
    <circle cx="54" cy="22" r="1.7"/><circle cx="58" cy="17" r="2.3"/><circle cx="62" cy="11" r="1.4"/>
  </g>

  <!-- 配件层（Zzz） -->
  <g class="acc acc-zzz" fill="var(--role-eye)" font-family="inherit" font-weight="700">
    <text class="z1" x="54" y="20" font-size="10">Z</text>
    <text class="z2" x="60" y="13" font-size="7">z</text>
  </g>

  <!-- 配件层（汗滴） -->
  <path class="acc acc-sweat" d="M58.5 19C61.5 23.4 61.5 26.6 58.5 27.8 55.5 26.6 55.5 23.4 58.5 19Z" fill="var(--state-info)"/>

  <!-- 配件层（爱心） -->
  <g class="acc acc-heart" fill="var(--role-cheek)">
    <path d="M58 18c-1.4-2-4.4-1.4-4.4 1.4 0 2 2 3.6 4.4 5.6 2.4-2 4.4-3.6 4.4-5.6 0-2.8-3-3.4-4.4-1.4z"/>
  </g>
</svg>`;
  }

  global.SparkieChars = { SKINS, POSES, MOODS, SPARKIE, buildSpriteHTML, bindBlink };
})(window);
