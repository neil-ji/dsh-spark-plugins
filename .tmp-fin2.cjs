
const fs = require('fs');
for (const p of ['dsh-finance', 'dsh-finance-client']) {
  const f = 'packages/' + p + '/package.json';
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.devDependencies = j.devDependencies || {};
  j.devDependencies['esbuild'] = '^0.25.0';
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
  console.log(p, 'esbuild added');
}
