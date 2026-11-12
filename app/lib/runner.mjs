// Child-process runner for the law-map extraction / render tools.
import { spawn } from 'node:child_process';

/** @param {string} script @param {string[]} args @returns {Promise<{code:number,out:string,err:string}>} */
export const runTool = (script, args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  const t = setTimeout(() => p.kill('SIGKILL'), 60000);
  p.on('close', (code) => { clearTimeout(t); resolve({ code, out: out.trim(), err: err.trim() }); });
});
