
const fs = require('fs');
for (const p of ['package.json', 'packages/dsh-hippomemo/package.json']) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const d of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const o = j[d];
    if (!o) continue;
    if (o['@deepseek-ai/cordis']) o['@deepseek-ai/cordis'] = '^4.0.1';
    if (o['@deepseek-ai/schemastery']) o['@deepseek-ai/schemastery'] = '^3.18.1';
  }
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
}
console.log('fixed cordis/schemastery');
