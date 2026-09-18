/**
 * dsh-ui-kit icon 语言 —— 基于 lucide-react 的工作区唯一图标出口。
 *
 * 规范（全局约束，插件不得绕过）：
 *  - 所有插件图标一律 `import { IconXxx } from 'dsh-ui-kit'`；
 *    禁止插件直接 import lucide-react 或手写 SVG 图标。
 *  - 尺寸仅两档：12（tag/pill 内）与 14（其余所有场景，含按钮），默认 14。
 *  - 描边统一 strokeWidth 2；颜色继承 currentColor（跟随按钮/标签前景色）。
 *  - 装饰性图标默认 aria-hidden，交互语义由按钮的 title/aria-label 承担。
 *  - 实现一律使用 lucide-react dist/esm/icons/* 深路径默认导出：barrel 会被
 *    CJS bundle 整包内联（实测 173KB→1.05MB），深路径只打包用到的图标。
 *  - 消费方插件若在浏览器 bundle 中引用本模块，需在其 tsdown `deps.alwaysBundle`
 *    加入 /^lucide-react/（deep path 不匹配按包名的精确 external 规则）。
 *  - 新增图标：在下方 import 区加一行深路径导入 + icon() + export 即可。
 */
import type { ReactNode } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import * as BrainModule from 'lucide-react/dist/esm/icons/brain.mjs';
import * as ChevronDownModule from 'lucide-react/dist/esm/icons/chevron-down.mjs';
import * as ChevronLeftModule from 'lucide-react/dist/esm/icons/chevron-left.mjs';
import * as ChevronRightModule from 'lucide-react/dist/esm/icons/chevron-right.mjs';
import * as ChevronUpModule from 'lucide-react/dist/esm/icons/chevron-up.mjs';
import * as CircleDollarSignModule from 'lucide-react/dist/esm/icons/circle-dollar-sign.mjs';
import * as EllipsisModule from 'lucide-react/dist/esm/icons/ellipsis.mjs';
import * as GitBranchModule from 'lucide-react/dist/esm/icons/git-branch.mjs';
import * as GitForkModule from 'lucide-react/dist/esm/icons/git-fork.mjs';
import * as PackageModule from 'lucide-react/dist/esm/icons/package.mjs';
import * as PencilModule from 'lucide-react/dist/esm/icons/pencil.mjs';
import * as PlusModule from 'lucide-react/dist/esm/icons/plus.mjs';
import * as SparklesModule from 'lucide-react/dist/esm/icons/sparkles.mjs';
import * as Trash2Module from 'lucide-react/dist/esm/icons/trash-2.mjs';
import * as TriangleAlertModule from 'lucide-react/dist/esm/icons/triangle-alert.mjs';

export interface IconProps {
  /** 仅允许 12（tag 内）或 14（默认，其余场景） */
  size?: 12 | 14
  className?: string
}

/**
 * CJS 互操作解包 + 组件形态校验。合法的 React 组件元素类型有两种形态：
 *  - function（普通/箭头组件）；
 *  - 带 $$typeof 符号键的对象（forwardRef/memo —— lucide 的 createLucideIcon
 *    返回 forwardRef 结果，typeof 为 'object'，但 React 完全合法）。
 */
function resolveIcon(mod: unknown): LucideIcon {
  const candidate = (mod as { default?: unknown } | null)?.default ?? mod;
  const isComponent =
    typeof candidate === 'function' ||
    (typeof candidate === 'object' &&
      candidate !== null &&
      '$$typeof' in (candidate as Record<string, unknown>));
  if (!isComponent) {
    throw new Error('[dsh-ui-kit] lucide icon module resolved to non-component');
  }
  return candidate as LucideIcon;
}

type IconComponent = (props: Omit<LucideProps, 'size' | 'strokeWidth'> & { size?: 12 | 14 }) => ReactNode;

function icon(mod: unknown): IconComponent {
  const Icon = resolveIcon(mod);
  return function UiKitIcon({ size = 14, ...rest }) {
    return <Icon size={size} strokeWidth={2} aria-hidden {...rest} />;
  };
}

export const IconChevronDown = icon(ChevronDownModule);
export const IconChevronLeft = icon(ChevronLeftModule);
export const IconChevronRight = icon(ChevronRightModule);
export const IconChevronUp = icon(ChevronUpModule);
export const IconPlus = icon(PlusModule);
export const IconEdit = icon(PencilModule);
export const IconTrash = icon(Trash2Module);
export const IconWarning = icon(TriangleAlertModule);
export const IconThink = icon(BrainModule);
export const IconBranch = icon(GitBranchModule);
export const IconSparkles = icon(SparklesModule);
export const IconDollar = icon(CircleDollarSignModule);
export const IconGithub = icon(GitForkModule);
export const IconPackage = icon(PackageModule);
export const IconEllipsis = icon(EllipsisModule);

// ---- 遗留命名（0.3.x）：手绘 SVG Outline 集合已移除，名称保留指向新图标。
/** @deprecated 改用 IconChevronDown */
export const IconChevronDownOutline14 = IconChevronDown;
/** @deprecated 改用 IconChevronUp */
export const IconChevronUpOutline14 = IconChevronUp;
/** @deprecated 改用 IconChevronLeft */
export const IconChevronLeftOutline14 = IconChevronLeft;
/** @deprecated 改用 IconChevronRight */
export const IconChevronRightOutline14 = IconChevronRight;
/** @deprecated 改用 IconPlus */
export const IconPlusOutline16 = IconPlus;
/** @deprecated 改用 IconTrash */
export const IconTrashOutline16 = IconTrash;
/** @deprecated 改用 IconEdit */
export const IconEditOutline16 = IconEdit;
/** @deprecated 改用 IconBranch */
export const IconBranchOutline16 = IconBranch;
/** @deprecated 改用 IconThink */
export const IconThinkOutline16 = IconThink;
/** @deprecated 改用 IconWarning */
export const IconWarningOutline16 = IconWarning;
