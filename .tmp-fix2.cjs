
const fs = require('fs');
const f = 'packages/dsh-hippomemo/src/extractor.ts';
let s = fs.readFileSync(f, 'utf8');
const old = "as import('@deepseek-ai/dsh-llm').MessageSource,";
const neu = "as unknown as import('@deepseek-ai/dsh-llm').MessageSource,";
if (s.includes(old)) { s = s.replace(old, neu); fs.writeFileSync(f, s); console.log('extractor fixed'); } else { console.log('pattern not found'); }
