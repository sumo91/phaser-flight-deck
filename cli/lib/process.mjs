// ===== 子进程执行（verify/simulate 共用）=====
import { spawn } from 'node:child_process';

export function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const timeoutMs = (options.timeoutSeconds ?? 120) * 1000;
    // 仅 npm 批处理类命令需要 shell；node 直调绝对路径必须 shell:false（避免路径空格被 cmd 拆断）
    const useShell = Boolean(options.useShell ?? (process.platform === 'win32' && /npm(\.cmd)?$/i.test(command)));
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: useShell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env ?? {}) },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolvePromise({ code: null, timedOut: true, stdout, stderr });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 256 * 1024) child.kill();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 256 * 1024) child.kill();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code: null, spawnError: error.message, stdout, stderr });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, timedOut: false, stdout, stderr });
    });
  });
}
