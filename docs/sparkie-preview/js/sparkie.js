/* ─────────────── Sparkie · 高密度 ASCII 桌宠 ───────────────
   风格参考：Claude Code /buddy（5 行 × 12-14 列 ASCII art）
   关键转变：
   - 不再是 16×16 像素网格 → 直接用字符画高密度 sprite
   - 不再漂浮漫步 → 常驻屏幕固定位置（输入框旁）
   - 不再切多套皮肤 → 1 个核心角色 + 心情/姿态变体
   - 不再自说自话 → 响应操作（idle / drag / think / alert / sleep）
   ─────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  // ── 调色板（纯色块：每个 sprite 用 ANSI / RGB 着色） ─────
  const PALETTE = {
    blue: { body: '#4d6bfe', bodyDark: '#1e2a5e', bodyLight: '#7a93ff', glow: '#c8d3ff', eye: '#0b0e14', cheek: '#ff8db8' },
    amber: { body: '#f59e0b', bodyDark: '#7c2d12', bodyLight: '#fbbf24', glow: '#fef3c7', eye: '#0b0e14', cheek: '#fb7185' },
    green: { body: '#22c55e', bodyDark: '#14532d', bodyLight: '#86efac', glow: '#d1fae5', eye: '#0b0e14', cheek: '#fb7185' },
  };

  // ── 核心 sprite 库（每帧都是真实字符画） ─────────────────
  // 命名规则：SPR_<pose>_<frame>
  //   pose: stand / walk / sit / sleep / drag
  //   frame: a / b / c（3 帧循环）
  // 字符图例：X=主色暗  M=主色  L=主色亮  G=高光  E=眼黑  C=腮红  .=透明

  // ── sprite 设计原则：silhouette-readable ASCII art ────────
  // 字符本身传递形状信息，不靠颜色伪装。
  // 字符图例：
  //   `(`, `)`, `/`, `\`, `_`, `-`, `|`  ← 真实轮廓（保持默认色 = 角色深色）
  //   `·`, `°`  ← 眼睛/高光（黑）
  //   `^`, `o`, `ω`  ← 嘴型
  //   `*`  ← 呆毛尖（角色色）
  //   `▓` `█` `░`  ← 身体填充（角色色/亮/暗）
  //   ` ` `.`  ← 透明
  // 这样眯眼看 sprite（去色）仍然能读出形状。

  // —— 站立呼吸 3 帧 ——
  // 5 行 × 14 列，呆毛 + 圆胖身体 + 大眼
  // 关键：外轮廓用 `(` `)` `/` `\` `▓`，眼睛用 `·`，嘴用 `ω` 圆弧
  const SPR_STAND_A = [
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ ·  ·▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '  ╰▓▓▓▓▓╯      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];
  const SPR_STAND_B = [
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ ·  ·▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];
  const SPR_STAND_C = [
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ ·  ·▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];

  // —— 走路 3 帧（左右脚交替） ——
  const SPR_WALK_A = [
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ ·  ·▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓   ▓      ',
    '    │  /       ',
  ];
  const SPR_WALK_B = [
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ ·  ·▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '    ▓▓         ',
    '     │         ',
  ];
  const SPR_WALK_C = [
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ ·  ·▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓   ▓▓      ',
    '    \  │       ',
  ];

  // —— 坐姿（身体下压 + 短腿前伸） ——
  const SPR_SIT_A = [
    '               ',
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ ·  ·▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '  ╰▓▓▓▓▓▓╯     ',
    '  ▓▓▓▓▓▓▓▓     ',
    '  ▓▓▓▓▓▓▓▓▓    ',
    '   ─────       ',
    '   │   │       ',
    '   │   │       ',
  ];
  const SPR_SIT_B = [
    '               ',
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ ·  ·▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '  ╰▓▓▓▓▓▓╯     ',
    '  ▓▓▓▓▓▓▓▓     ',
    '  ▓▓▓▓▓▓▓▓▓    ',
    '   ─────       ',
    '  /     \\      ',
    '  │     │      ',
  ];

  // —— 眨眼（闭上弧线 `─ ─`） ——
  const SPR_BLINK_A = [
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ ─  ─▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];

  // —— 睡（眯眼 `~` + Zzz + 身体下沉） ——
  const SPR_SLEEP_A = [
    '               ',
    '            zz ',
    '      *      Z ',
    '     ▓▓▓    ZZZ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ ~  ~▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];
  const SPR_SLEEP_B = [
    '               ',
    '         ZZZ   ',
    '      *   Z    ',
    '     ▓▓▓    z  ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ ~  ~▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];

  // —— 思考（眼球上抬 `°` + 思考泡 `?`） ——
  const SPR_THINK_A = [
    '       ?       ',
    '      ?        ',
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ °  °▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];

  // —— 拖拽（抱紧小 o 嘴） ——
  const SPR_DRAG_A = [
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ o  o▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];

  // —— Cheer（笑眯眼 `^ ^` + 腮红 `o` + 举小手） ——
  const SPR_CHEER_A = [
    '  \\         /  ',
    '   \\       /   ',
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮  o  ',
    '  (▓ ^  ^▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];
  const SPR_CHEER_B = [
    '   /       \\   ',
    '  /         \\  ',
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮  o  ',
    '  (▓ ^  ^▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];

  // —— Work（tool-use：聚焦 + 忙碌指示） ——
  const SPR_WORK_A = [
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓  »   ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ -  -▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];
  const SPR_WORK_B = [
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓  «   ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ -  -▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];

  // —— Alert（ask-user / permission：瞪大眼 + 惊叹号） ——
  const SPR_ALERT_A = [
    '      !        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ O  O▓)    ',
    '  │▓▓▓▓▓▓│     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];

  // —— Error（出错：× 眼 + 下弯嘴） ——
  const SPR_ERROR_A = [
    '      *        ',
    '     ▓▓▓       ',
    '    ▓▓▓▓▓      ',
    '   ╭▓▓▓▓▓╮     ',
    '  (▓ ×  ×▓)    ',
    '   ╰▓▓▓▓▓╯     ',
    '   ▓▓▓▓▓▓      ',
    '   ▓▓▓▓▓       ',
    '   ▓▓ ▓▓       ',
    '   │   │       ',
  ];

  // ── 字符 → 颜色映射 ─────────────────────────────────────
  // 真实轮廓字符（`(` `)` `/` `\` `_` `-` `|` `╭` `╮` `╰` `╯`）
  //   → 用角色 bodyDark（深色描边）
  // 身体填充（`▓` `█` `░`）
  //   → 用角色 body（中色填充）
  // 眼/嘴（`·` `°` `^` `o` `~` `ω` `×` `O`）
  //   → 用角色 eye（黑）
  // 呆毛尖 / 装饰（`*` `?` `Z` `z` `!` `»` `«`）
  //   → 用角色 body 或 glow
  const CHAR_TO_KEY = {
    // 轮廓字符（深色）
    '(': 'bodyDark', ')': 'bodyDark',
    '/': 'bodyDark', '\\': 'bodyDark',
    '_': 'bodyDark', '-': 'bodyDark',
    '|': 'bodyDark',
    '╭': 'bodyDark', '╮': 'bodyDark', '╰': 'bodyDark', '╯': 'bodyDark',
    // 身体填充（中色）
    '▓': 'body', '█': 'body', '░': 'body',
    // 眼/嘴/装饰（黑）
    '·': 'eye', '°': 'eye', '^': 'eye', 'o': 'eye', '~': 'eye', 'ω': 'eye',
    '×': 'eye', 'O': 'eye',
    // 呆毛 / 思考泡 / Zzz / 警示 / 忙碌指示
    '*': 'body',
    '?': 'body',
    'Z': 'glow', 'z': 'glow',
    '!': 'body', '»': 'body', '«': 'body',
    // 透明
    '.': null, ' ': null,
  };

  // ── ASCII art → SVG (保留字符为 <text>，上色用 fill) ─────
  // 这是真正的 ASCII pet 实现：字符是字符，但用着色让"贴纸感"出现
  const PUPIL_CHARS = new Set(['·', '°']);   // 可跟随视线移动的瞳点
  function artToSVG(art, palette, opts = {}) {
    const fontSize = opts.fontSize ?? 14;
    const fontFamily = opts.fontFamily ?? "'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', monospace";
    const charW = fontSize * 0.6;   // mono 字符宽 ≈ 0.6 × fontSize
    const lineH = fontSize * 1.05;
    const rows = art.length;
    const cols = Math.max(...art.map(r => r.length));
    const w = cols * charW + 8;
    const h = rows * lineH + 8;

    let tspans = '';
    for (let y = 0; y < rows; y++) {
      const row = art[y] || '';
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        const key = CHAR_TO_KEY[ch];
        if (!key) continue;        // 透明
        const color = palette[key];
        const px = x * charW + 4;
        const py = (y + 1) * lineH + 2;
        const cls = PUPIL_CHARS.has(ch) ? ' class="pupil"' : '';
        tspans += `<text${cls} x="${px.toFixed(2)}" y="${py.toFixed(2)}" font-size="${fontSize}" font-family="${fontFamily}" fill="${color}">${escapeXml(ch)}</text>`;
      }
    }
    return `<svg class="sparkie-sprite" viewBox="0 0 ${w} ${h}" width="${w * 3}" height="${h * 3}">
  <text x="0" y="0" font-size="${fontSize}" font-family="${fontFamily}" fill="transparent">.</text>
  ${tspans}
</svg>`;
  }

  function escapeXml(ch) {
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '&') return '&amp;';
    return ch;
  }

  // ── sprite 表：pose → 帧数组 ──────────────────────────────
  const SPRITES = {
    stand:  [SPR_STAND_A, SPR_STAND_B, SPR_STAND_C],
    walk:   [SPR_WALK_A, SPR_WALK_B, SPR_WALK_C],
    sit:    [SPR_SIT_A, SPR_SIT_B],
    blink:  [SPR_BLINK_A, SPR_STAND_A],
    sleep:  [SPR_SLEEP_A, SPR_SLEEP_B],
    think:  [SPR_THINK_A, SPR_THINK_A],
    work:   [SPR_WORK_A, SPR_WORK_B],
    alert:  [SPR_ALERT_A, SPR_ALERT_A],
    error:  [SPR_ERROR_A, SPR_ERROR_A],
    drag:   [SPR_DRAG_A, SPR_DRAG_A],
    cheer:  [SPR_CHEER_A, SPR_CHEER_B],
  };

  function buildSpriteSVG(skinId, pose, frame) {
    const palette = PALETTE[skinId] || PALETTE.blue;
    const frames = SPRITES[pose] || SPRITES.stand;
    const art = frames[frame % frames.length];
    return artToSVG(art, palette);
  }

  // ── 角色元数据 ──────────────────────────────────────────
  const SPARKIE = {
    id: 'sparkie',
    version: '0.6.0',
    skin: 'blue',
    pose: 'stand',
    frameIntervalMs: 480,    // 3 帧呼吸/走路：每帧 ~0.5s
  };

  global.SparkieChars = {
    PALETTE, SPRITES, SPARKIE,
    buildSpriteSVG, artToSVG,
  };
})(window);
