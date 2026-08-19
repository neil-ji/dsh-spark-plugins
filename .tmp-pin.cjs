
const fs = require('fs');
// 固定 root + hippomemo 的 @deepseek-ai/* 为精确 0.1.0-rc.6
for (const p of ['package.json', 'packages/dsh-hippomemo/package.json']) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const d of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const o = j[d];
    if (!o) continue;
    for (const k of Object.keys(o)) {
      if (k.startsWith('@deepseek-ai/') && o[k] !== '*') o[k] = '0.1.0-rc.6';
    }
  }
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
}
// hippomemo devDeps 补 dsh-client-ui-primitives
const hp = JSON.parse(fs.readFileSync('packages/dsh-hippomemo/package.json', 'utf8'));
hp.devDependencies['@deepseek-ai/dsh-client-ui-primitives'] = '0.1.0-rc.6';
fs.writeFileSync('packages/dsh-hippomemo/package.json', JSON.stringify(hp, null, 2));
console.log('pinned to rc.6 exact');
