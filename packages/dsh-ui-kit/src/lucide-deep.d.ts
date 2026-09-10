/**
 * lucide-react 深路径无类型声明（包内 icons/*.mjs 无伴随 .d.mts）。
 * 通配符声明覆盖所有深路径图标模块；图标本体类型从 barrel 的类型入口取
 * （type-only 导入不产生运行时代码，不会把 barrel 打进 bundle）。
 */
declare module 'lucide-react/dist/esm/icons/*' {
  import type { LucideIcon } from 'lucide-react';
  const Icon: LucideIcon;
  export default Icon;
}
