const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const files = fs.readdirSync('test').filter(f=>f.endsWith('.test.js')).map(f=>'test/'+f);
const result = spawnSync(process.execPath, ['--test', ...files], { env: { ...process.env, MONGODB_URI: '', DOTENV_CONFIG_PATH: 'missing-test-env' }, stdio: 'inherit', timeout: 60000 });
process.exitCode = result.status ?? 1;
