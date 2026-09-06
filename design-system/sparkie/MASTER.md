# Sparkie · Master Design System

> 浏览器桌宠引擎的视觉源（Source of Truth）。
> 与 spark-dock 的关系：Sparkie 是**通用引擎 + 角色库**，Spark Dock 是它在 DSH 体系内的业务实例。
> 关键约束：角色层 = Claymorphism 软陶玩偶（厚边/双阴影/圆胖）；承载页 = DSH 冷灰骨架 + 品牌蓝（不撞色）。
> 这个双层美学是有意为之——办公场景冷静克制，**桌宠自己带着暖意**，形成视觉记忆点。

---

## 1. 调性

**角色**：软陶玩偶 · 圆胖 · 厚边 · 双阴影 · 像从一个玩具柜里走出来的小生物。
**承载页**：DSH 冷灰骨架（中性、骨感、信息密度大）+ 品牌蓝 `#4d6bfe` accent（沿用 `<memory id="3ea30cd0>` 偏好）。
**统一原则**：mood 染色 / `--spk-role-accent` 只在角色本体说话，承载页保持冷静。

## 2. 色彩

### 骨架色（DSH 冷灰沿用）
| Token | Dark | Light |
|---|---|---|
| `--spk-bg` | `#0b0e14` | `#ffffff` |
| `--spk-surface` | `#13171f` | `#ffffff` |
| `--spk-surface-2` | `#1a1f2a` | `#f4f5f8` |
| `--spk-surface-3` | `#232a37` | `#e9ecf2` |
| `--spk-label` | `#f5f7fa` | `#0b0e14` |
| `--spk-label-2` | `#a8b0bf` | `#4a5468` |
| `--spk-label-3` | `#6b7587` | `#8a93a3` |
| `--spk-border` | `#2a3140` | `#e4e7ec` |
| `--spk-border-2` | `#3a4254` | `#d0d4dc` |
| `--spk-brand` | `#4d6bfe` | `#3b56e0` |
| `--spk-brand-soft` | `rgba(77, 107, 254, .14)` | `rgba(77, 107, 254, .10)` |
| `--spk-on-brand` | `#ffffff` | `#ffffff` |
| `--spk-focus` | `0 0 0 3px rgba(77, 107, 254, .55)` | `0 0 0 3px rgba(77, 107, 254, .45)` |

### 角色色（5 套皮肤 · data-skin 切换）
| id | 名称 | 主色 accent | 描述 |
|---|---|---|---|
| `crystal` | 蓝晶 · Crystal | `#4d6bfe` | 冷静分析 · 蓝色记忆守护者（默认 · 与品牌色同源） |
| `sparkle` | 琥珀 · Sparkle | `#f59e0b` | 呆毛火花 · 灵感小精灵 |
| `sprout` | 绿芽 · Sprout | `#22c55e` | 萌芽提示 · 成本节流小园丁 |
| `pixel` | 玫粉 · Pixel | `#ec4899` | 赛博 Neko · 追光者 |
| `clay` | 陶土 · Clay | `#e07a4a` | 软陶玩偶 · 暖意办公搭档 |

> 默认皮肤 = `crystal`（与品牌色 `#4d6bfe` 一致，避免首屏撞色）。

### 状态色
- success `#22c55e` · warn `#f59e0b` · error `#ef4444` · info `#4d6bfe`，各配 `-soft` 浅底。

### 阴影（Claymorphism 双阴影）
- 角色主体：`0 8px 16px rgba(0, 0, 0, .35), inset 0 -4px 8px rgba(0, 0, 0, .25), inset 0 2px 4px rgba(255, 255, 255, .25)`（外+内双阴影 = 立体）
- 角色卡（皮肤选择）：`0 6px 0 0 rgba(0,0,0,.18), 0 10px 24px rgba(0,0,0,.32)`（下沉 6px 厚边）
- 按钮按压：`0 2px 0 0 rgba(0,0,0,.18), 0 4px 8px rgba(0,0,0,.22)`（按下去 4px）
- 浮层（dock 面板）：`0 16px 48px rgba(0, 0, 0, .55)`（不用内阴影，纯外阴影保持玻璃感）

## 3. 字体

- 标题 / 角色名：`Varela Round`（圆胖无衬线，配合 Claymorphism）
- 正文 / UI：`Nunito Sans`（柔和但清晰；冷灰骨架的可读性比 PingFang 更友好）
- 代码：`SF Mono` / `JetBrains Mono`
- 字号阶：`10 · 11 · 12 · 13 · 14 · 16 · 19 · 24 · 32`
- 行高：正文 1.55（中性骨架要求 ≥1.5）

中文 fallback：`'PingFang SC', 'Noto Sans SC'`，保证中文用户也舒服。

## 4. 形状 / 圆角 / 间距

- 圆角：`--spk-radius-xs 6 · sm 10 · md 14 · lg 18 · xl 22 · 2xl 28 · full`
- 角色主体圆角：22-28px（圆胖）
- 卡片圆角：18px（更软）
- 按钮圆角：14px（按压时变 10px，制造下沉反馈）
- 间距阶：8px 栅格：`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`
- 触控热区：≥ 44×44px（角色球 72px）

## 5. 动效

- **入场**：弹簧 `back.out(1.4)`，400-450ms（**GSAP 风格**——我们用 CSS 手写近似值：`cubic-bezier(.34, 1.56, .64, 1)` 350ms）
- **出场**：200ms ease-out（**exit-faster-than-enter**）
- **按压**：transform: translateY(2-4px)，150ms ease-out
- **hover**：transform: translateY(-1-2px) + 阴影变深，180ms ease-out
- **拖拽**：跟手（无延迟），松手弹性吸附 280ms
- **motion token**：
  - `--spk-dur-fast 150ms`（hover/press）
  - `--spk-dur-med 280ms`（吸附/弹回）
  - `--spk-dur-slow 450ms`（入场）
- **reduced-motion**：transform/opacity 仍保留，但 duration 砍半；spring 类直接换 ease-out

## 6. 组件规则

1. **所有按钮**：44×44 触控最小；按压下沉 2-4px（双阴影收为单层厚边）；focus ring 不可移除
2. **角色卡 / 皮肤按钮**：选中态 = 主色描边 3px + 阴影变浅（"抬起"感）
3. **focus ring** = `--spk-focus`（品牌蓝 3px）
4. **错误信息** `role=alert`；惰性状态 `role=status aria-live=polite`
5. **icon** 全 SVG，禁止 emoji
6. **mood 染色**：角色本体允许全染色；承载页保持冷灰骨架

## 7. 角色层 Claymorphism 规则

- 主体双阴影：外阴影（落地）+ 内阴影上沿（高光）+ 内阴影下沿（厚度）
- 选中态：颜色饱和度 +10%；外阴影变浅（"抬起"）
- 按下态：外阴影几乎消失，仅留内阴影（"被按进桌面"）
- 表情层：data-mood 驱动 SVG 内 `<g>` 切换；圆胖造型下眼睛/嘴型都要大 30%（造型语言一致）
- 配件层（应援棒/思考泡/Zzz）：chunky 化处理——线宽 3-4px，球面 2D 不强求透视

## 8. 迁移路径

- 阶段 1（已完成）：token 重写为 Claymorphism + 品牌蓝双层
- 阶段 2：sparkie.css 按新 token 重写
- 阶段 3：playground.css / demo.js 同步更新
- 阶段 4：未来 spark-dock-preview 可复用 Sparkie 的角色数据 + 引擎，主体色板保留各自（业务页暖炭 / 通用页冷灰）

## 9. 反模式（避免）

- ❌ 用 emoji 当 icon（用 SVG）
- ❌ 用暖橙做大面积铺色（与 DSH 冷灰骨架冲突）
- ❌ 渐变多彩背景（背景必须中性）
- ❌ 装饰性元素无 aria-hidden（破坏 SR）
- ❌ 拖拽没键盘替代（WCAG 2.2 AA `dragging-alternative` 违反）
- ❌ 角色本体纯扁平（失去 Claymorphism 灵魂）

## 10. 验收 Checklist

- [ ] 角色本体有清晰的双层阴影（外 + 内上下）
- [ ] 皮肤切换走 `--role-accent`，瞬时切换不闪
- [ ] 所有按钮 44×44，按压有下沉反馈
- [ ] focus ring 用 `--spk-focus`（品牌蓝 3px）
- [ ] 拖拽 + 键盘 ↑↓←→ 替代均可
- [ ] prefers-reduced-motion 全部降级（时长减半 / 关闭 spring）
- [ ] 双主题对比度 ≥4.5:1（dark `0b0e14` + `f5f7fa` ≈ 17.4:1，远超）
- [ ] 容器在 375px / 768px / 1024px / 1440px 不溢出
- [ ] SVG 图标，零 emoji
