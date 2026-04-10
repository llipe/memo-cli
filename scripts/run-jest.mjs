import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const jestPackageJson = require.resolve('jest/package.json');
const jestBin = join(dirname(jestPackageJson), 'bin', 'jest.js');
const forwardedArgs = process.argv.slice(2);
const args = forwardedArgs[0] === '--' ? forwardedArgs.slice(1) : forwardedArgs;

const child = spawn(process.execPath, [jestBin, ...args], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});