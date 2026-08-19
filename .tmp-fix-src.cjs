
const fs = require('fs');
const p = (f) => 'packages/dsh-hippomemo/' + f;
let changed = [];

// 1) index.ts: HippomemoChanged 由 export type * from './types.ts' 覆盖，去掉从 memory-service 的错误导出
let idx = fs.readFileSync(p('src/index.ts'), 'utf8');
const oldIdx = "export type {\n  HippomemoChanged, HippomemoConfig,\n} from './memory-service.ts'";
const newIdx = "export type { HippomemoConfig } from './memory-service.ts'";
if (idx.includes(oldIdx)) { idx = idx.replace(oldIdx, newIdx); fs.writeFileSync(p('src/index.ts'), idx); changed.push('index.ts'); }

// 2) extractor.ts: form: 'extract' 类型断言（ContextFormed 为 type 联合不可扩展，运行时无碍）
let ex = fs.readFileSync(p('src/extractor.ts'), 'utf8');
const oldEx = "      source: { kind: 'plugin', plugin: name, form: 'extract' },";
const newEx = "      source: { kind: 'plugin', plugin: name, form: 'extract' } as import('@deepseek-ai/dsh-llm').MessageSource,";
if (ex.includes(oldEx)) { ex = ex.replace(oldEx, newEx); fs.writeFileSync(p('src/extractor.ts'), ex); changed.push('extractor.ts'); }

// 3) tool.ts: 两个同步 execute 改 async（defineTool rc.6 要求 Promise）
let tl = fs.readFileSync(p('src/tool.ts'), 'utf8');
const old1 = "    execute(args, exec) {\n      return JSON.stringify(ctx.memory.search({";
const new1 = "    async execute(args, exec) {\n      return JSON.stringify(ctx.memory.search({";
if (tl.includes(old1)) { tl = tl.replace(old1, new1); changed.push('tool.ts (memory_search)'); }
const old2 = "    execute(args) {\n      return JSON.stringify(ctx.memory.get(args.id) ?? null)";
const new2 = "    async execute(args) {\n      return JSON.stringify(ctx.memory.get(args.id) ?? null)";
if (tl.includes(old2)) { tl = tl.replace(old2, new2); changed.push('tool.ts (memory_get)'); }
fs.writeFileSync(p('src/tool.ts'), tl);

console.log('changed:', changed.join(', '));
