
const fs = require('fs');
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const rc = (n) => root.devDependencies[n] = '^0.1.0-rc.6';
['dsh-agent','dsh-agent-default-model','dsh-client-locale','dsh-client-runtime',
 'dsh-client-ui-settings','dsh-client-ui-slots','dsh-host-webserver','dsh-llm',
 'dsh-session','dsh-storage-domain','dsh-system-prompt','dsh-tools'].forEach(n => rc('@deepseek-ai/' + n));
root.devDependencies['@deepseek-ai/cordis'] = '^4.0.1';
root.devDependencies['@deepseek-ai/schemastery'] = '^3.18.1';
fs.writeFileSync('package.json', JSON.stringify(root, null, 2));
console.log('root devDeps:', Object.keys(root.devDependencies).length);
const hp = JSON.parse(fs.readFileSync('packages/dsh-hippomemo/package.json', 'utf8'));
hp.devDependencies = hp.devDependencies || {};
for (const n of ['dsh-agent','dsh-agent-default-model','dsh-client-locale','dsh-client-runtime',
 'dsh-client-ui-settings','dsh-client-ui-slots','dsh-host-webserver','dsh-llm',
 'dsh-session','dsh-storage-domain','dsh-system-prompt','dsh-tools']) {
  hp.devDependencies['@deepseek-ai/' + n] = '^0.1.0-rc.6';
}
hp.devDependencies['@deepseek-ai/cordis'] = '^4.0.1';
hp.devDependencies['@deepseek-ai/schemastery'] = '^3.18.1';
fs.writeFileSync('packages/dsh-hippomemo/package.json', JSON.stringify(hp, null, 2));
console.log('hippomemo devDeps:', Object.keys(hp.devDependencies).length);
