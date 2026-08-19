
const fs = require('fs');
const j = JSON.parse(fs.readFileSync('package.json', 'utf8'));
j.pnpm = { overrides: { '@deepseek-ai/dsh-*': '0.1.0-rc.6' } };
fs.writeFileSync('package.json', JSON.stringify(j, null, 2));
console.log('overrides added:', JSON.stringify(j.pnpm));
