// Runs the API (tsx watch, :5178) and the Vite dev server (:5179) together.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = ['server', 'web'].map(ws =>
  spawn(npm, ['run', 'dev', '-w', ws], { stdio: 'inherit', shell: process.platform === 'win32' }));

const stop = () => children.forEach(c => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach(c => c.on('exit', code => { if (code) { stop(); process.exit(code ?? 1); } }));
console.log('\nAPI: http://127.0.0.1:5178   UI (hot reload): http://127.0.0.1:5179\n');
