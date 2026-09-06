/* ─────────────── Sparkie · Claymorphism 软陶玩偶渲染器 ───────────────
   按 MASTER.md 设计系统实现「角色层 = Claymorphism 软陶玩偶」：
   - 厚边 + 双阴影（外落地阴影 + 内上高光 + 内下厚度）
   - 圆胖 blob 本体 + 呆毛 + 腮红 + 大眼（圆胖造型下表情大 30%）
   - data-mood / data-pose 驱动表情层 <g> 切换
   - 5 套皮肤由 --role-accent / data-skin 切换，瞬时切换不闪

   渲染无关：这里只产出 SVG 字符串；pose 由引擎 syncPose() 决定，
   表情由 pose + mood 决定；具体运动由 CSS（data-pose 动画）负责。
   ─────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  // 角色皮肤（5 套 · 与 MASTER.md §2 一致）
  // body=主色  bodyDark=深(描边/厚度)  bodyLight=高光  glow=柔光  cheek=腮红  eye=眼黑
  const PALETTE = {
    crystal: { id: 'crystal', name: '蓝晶',   body: '#4d6bfe', bodyDark: '#20306e', bodyLight: '#7a93ff', glow: '#c8d3ff', cheek: '#ff8db8', eye: '#0b0e14' },
    sparkle: { id: 'sparkle', name: '琥珀',   body: '#f59e0b', bodyDark: '#8a3a10', bodyLight: '#fbbf24', glow: '#fef3c7', cheek: '#fb7185', eye: '#3b2010' },
    sprout:  { id: 'sprout',  name: '绿芽',   body: '#22c55e', bodyDark: '#13592b', bodyLight: '#86efac', glow: '#d1fae5', cheek: '#fb7185', eye: '#0e2b17' },
    pixel:   { id: 'pixel',   name: '玫粉',   body: '#ec4899', bodyDark: '#8a2358', bodyLight: '#f9a8d4', glow: '#fce7f3', cheek: '#ffb3c4', eye: '#3a0f24' },
    clay:    { id: 'clay',    name: '陶土',   body: '#e07a4a', bodyDark: '#8a3f1c', bodyLight: '#ef9a6b', glow: '#fbe0d0', cheek: '#ffb59a', eye: '#3a1c0d' },
  };

  // 本体几何（viewBox 0 0 120 122；本体居中的圆胖 blob）
  const BODY =
    'M60 35 C84 35 98 49 98 73 C98 95 84 106 60 106 C36 106 22 95 22 73 C22 49 36 35 60 35 Z';

  // ── 表情层（由 pose + mood 决定眼睛/嘴型/配件） ─────────────────
  // 每个表情返回 { eye, mouth, extra }；extra 是配件（思考泡/惊叹/Zzz 等）。
  function expression(pose) {
    switch (pose) {
      case 'sleep':  return { eyes: closed('sleep'), mouth: '<path d="M54 86 Q60 82 66 86" fill="none" stroke="var(--eye)" stroke-width="4" stroke-linecap="round"/>', extra: zzz() };
      case 'blink':  return { eyes: closed('blink'), mouth: '<path d="M52 84 Q60 90 68 84" fill="none" stroke="var(--eye)" stroke-width="4" stroke-linecap="round"/>', extra: '' };
      case 'think':  return { eyes: lookingUp(), mouth: '<path d="M52 84 Q60 87 68 84" fill="none" stroke="var(--eye)" stroke-width="4" stroke-linecap="round"/>', extra: thought() };
      case 'work':   return { eyes: squint(), mouth: '<path d="M52 84 Q60 88 68 84" fill="none" stroke="var(--eye)" stroke-width="4" stroke-linecap="round"/>', extra: '' };
      case 'alert':  return { eyes: wide(), mouth: '<circle cx="60" cy="88" r="5.5" fill="var(--eye)"/>', extra: exclaim() };
      case 'error':  return { eyes: sad(), mouth: '<path d="M54 90 Q60 84 66 90" fill="none" stroke="var(--eye)" stroke-width="4" stroke-linecap="round"/>', extra: '' };
      case 'drag':   return { eyes: open(), mouth: '<circle cx="60" cy="88" r="5" fill="var(--eye)"/>', extra: '' };
      case 'cheer':  return { eyes: happy(), mouth: '<path d="M52 84 Q60 96 68 84 Z" fill="var(--eye)"/>', extra: sparkleBits() };
      case 'sit':    return { eyes: open(true), mouth: '<path d="M52 84 Q60 89 68 84" fill="none" stroke="var(--eye)" stroke-width="4" stroke-linecap="round"/>', extra: '' };
      case 'walk':   return { eyes: open(), mouth: '<path d="M52 84 Q60 88 68 84" fill="none" stroke="var(--eye)" stroke-width="4" stroke-linecap="round"/>', extra: '' };
      default:       return { eyes: open(), mouth: '<path d="M52 84 Q60 89 68 84" fill="none" stroke="var(--eye)" stroke-width="4" stroke-linecap="round"/>', extra: '' };  // stand
    }
  }

  // 跟随眼睛（含 .pupil 供 SensePlugin 瞳孔跟随）：默认黑瞳 + 高光
  // 注意：眼球画在绝对坐标，外层 <g class="pupil"> 不带 base transform，
  // 这样 SensePlugin 用 style.transform 平移时不会覆盖眼球基准位置。
  function open(dot = false) {
    const eye = (cx) => {
      const r = dot ? 5.5 : 7;
      return `<g class="pupil">
        <circle cx="${cx}" cy="64" r="${r}" fill="var(--eye)"/>
        <circle cx="${cx - r * .28}" cy="${64 - r * .28}" r="${(r * .3).toFixed(1)}" fill="#fff" opacity=".9"/>
      </g>`;
    };
    return eye(45) + eye(75);
  }

  // 闭眼弧线（sleep / blink）
  function closed(kind) {
    const arc = (cx) => {
      const d = kind === 'sleep'
        ? `M${cx - 6} 64 Q${cx} 68 ${cx + 6} 64`   // 舒缓眯眼
        : `M${cx - 6} 64 Q${cx} 70 ${cx + 6} 64`;   // 快速眨眼更弯
      return `<path d="${d}" fill="none" stroke="var(--eye)" stroke-width="4" stroke-linecap="round"/>`;
    };
    return arc(45) + arc(75);
  }

  // 开心眯眼（cheer 的 ^ ^）
  function happy() {
    const arc = (cx) => `<path d="M${cx - 7} 64 Q${cx} 56 ${cx + 7} 64" fill="none" stroke="var(--eye)" stroke-width="5" stroke-linecap="round"/>`;
    return arc(45) + arc(75);
  }

  // 瞪大眼（alert）
  function wide() {
    const eye = (cx) => `<g class="pupil">
      <circle cx="${cx}" cy="63" r="9" fill="var(--eye)"/>
      <circle cx="${cx + 3}" cy="60" r="2.6" fill="#fff" opacity=".92"/>
    </g>`;
    return eye(45) + eye(75);
  }

  // 聚焦眯眼（work）
  function squint() {
    const seg = (cx) => `<path d="M${cx - 6} 63 L${cx + 6} 63" stroke="var(--eye)" stroke-width="5" stroke-linecap="round"/>`;
    return seg(45) + seg(75);
  }

  // 难过眼（error）：瞳下压 + 眉下垂
  function sad() {
    const eye = (cx) => `<g class="pupil">
      <circle cx="${cx}" cy="66" r="5.5" fill="var(--eye)"/>
      <circle cx="${cx + 2}" cy="64" r="1.6" fill="#fff" opacity=".85"/>
    </g><path d="M${cx - 7} 56 Q${cx} 60 ${cx + 7} 56" fill="none" stroke="var(--eye)" stroke-width="4" stroke-linecap="round"/>`;
    return eye(45) + eye(75);
  }

  // 思考/抬眼（think）：瞳上移 + 旁侧思考泡
  function lookingUp() {
    const eye = (cx) => `<g class="pupil">
      <circle cx="${cx}" cy="60" r="7" fill="var(--eye)"/>
      <circle cx="${cx - 2}" cy="58" r="2" fill="#fff" opacity=".9"/>
    </g>`;
    return eye(45) + eye(75);
  }

  // ── 配件层（chunky 化：线宽 3-4） ──────────────────────────────
  function thought() {
    return `<g class="accent" fill="var(--glow)" opacity=".9">
      <circle cx="94" cy="34" r="4"/>
      <circle cx="102" cy="24" r="7"/>
      <circle cx="112" cy="14" r="10"/>
    </g>`;
  }
  function exclaim() {
    return `<g class="accent" fill="var(--body)">
      <path d="M100 20 L104 20 L102 36 L102 36 Z" transform="translate(-6 6)"/>
      <circle cx="96" cy="44" r="3"/>
    </g>`;
  }
  function zzz() {
    return `<g class="accent" transform="translate(84 22)" font-family="'Varela Round', 'PingFang SC', sans-serif" font-weight="700" fill="var(--body)">
      <text x="0" y="0" font-size="20" opacity=".95">Z</text>
      <text x="13" y="10" font-size="18" opacity=".7">z</text>
      <text x="24" y="19" font-size="16" opacity=".45">z</text>
    </g>`;
  }
  function sparkleBits() {
    return `<g class="accent" fill="var(--glow)">
      <path d="M20 30 l4 7 7 3 -7 3 -4 7 -4 -7 -7 -3 7 -3 Z"/>
      <path d="M104 28 l3 6 6 3 -6 3 -3 6 -3 -6 -6 -3 6 -3 Z"/>
    </g>`;
  }

  // ── 主入口：pose -> SVG 字符串 ────────────────────────────────
  function buildSpriteSVG(skinId, pose, frame) {
    const p = PALETTE[skinId] || PALETTE.crystal;
    const exp = expression(pose || 'stand');
    const gradId = 'spkGrad_' + p.id;
    // 呆毛：stem + 圆 head（花火小芽）
    const antenna =
      `<path d="M60 38 C 60 27 64 18 74 14" fill="none" stroke="var(--stroke)" stroke-width="5" stroke-linecap="round"/>
       <circle cx="77" cy="14" r="7.5" fill="url(#${gradId})" stroke="var(--stroke)" stroke-width="3"/>
       <circle cx="75" cy="12" r="2.2" fill="#fff" opacity=".75"/>`;

    return `<svg class="sparkie-sprite" viewBox="0 0 120 122" role="img" aria-label="${p.name} Sparkie">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${p.bodyLight}"/>
          <stop offset="0.55" stop-color="${p.body}"/>
          <stop offset="1" stop-color="${p.bodyDark}"/>
        </linearGradient>
        <clipPath id="${gradId}_clip"><path d="${BODY}"/></clipPath>
        <style>
          .sparkie-sprite { --eye: ${p.eye}; --body: ${p.body}; --glow: ${p.glow}; --stroke: ${p.bodyDark}; }
        </style>
      </defs>
      <g class="clay-body">
        <path d="${BODY}" fill="url(#${gradId})" stroke="var(--stroke)" stroke-width="3.5" stroke-linejoin="round" opacity=".99"/>
        <g clip-path="url(#${gradId}_clip)">
          <ellipse cx="40" cy="30" rx="34" ry="22" fill="#fff" opacity=".26"/>      <!-- 内上高光 -->
          <ellipse cx="60" cy="120" rx="44" ry="28" fill="var(--stroke)" opacity=".26"/> <!-- 内下厚度 -->
        </g>
        <ellipse cx="33" cy="80" rx="6.5" ry="4.5" fill="var(--cheek)" opacity=".55"/>
        <ellipse cx="87" cy="80" rx="6.5" ry="4.5" fill="var(--cheek)" opacity=".55"/>
        ${exp.eyes}
        ${exp.mouth}
        ${exp.extra}
      </g>
      ${antenna}
    </svg>`;
  }

  // 角色元数据
  const SPARKIE = {
    id: 'sparkie',
    version: '0.7.0',
    skin: 'crystal',           // 默认皮肤（与品牌蓝同源，避免首屏撞色）
    pose: 'stand',
    frameIntervalMs: 480,
  };

  global.SparkieChars = { PALETTE, SPARKIE, buildSpriteSVG };
})(window);
