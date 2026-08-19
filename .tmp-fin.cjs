
const fs = require('fs');
const base = 'packages/';
// 1) bundle: deps -> workspace:*, 删 prepack, private
let b = JSON.parse(fs.readFileSync(base + 'dsh-finance-bundle/package.json', 'utf8'));
b.dependencies = { 'dsh-finance': 'workspace:*', 'dsh-finance-client': 'workspace:*' };
if (b.scripts) delete b.scripts.prepack;
b.private = true;
fs.writeFileSync(base + 'dsh-finance-bundle/package.json', JSON.stringify(b, null, 2));
// 2) host build.mjs: npx -> npx --no-install
let bm = fs.readFileSync(base + 'dsh-finance/build.mjs', 'utf8');
bm = bm.replace("execSync('npx tsc -p tsconfig.json'", "execSync('npx --no-install tsc -p tsconfig.json'");
fs.writeFileSync(base + 'dsh-finance/build.mjs', bm);
// 3) host/client private
for (const p of ['dsh-finance', 'dsh-finance-client']) {
  let j = JSON.parse(fs.readFileSync(base + p + '/package.json', 'utf8'));
  j.private = true;
  fs.writeFileSync(base + p + '/package.json', JSON.stringify(j, null, 2));
}
console.log('finance adjusted');
