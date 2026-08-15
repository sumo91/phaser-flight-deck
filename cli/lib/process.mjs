// ===== 子进程执行（verify/simulate 共用）=====
import { spawn } from 'node:child_process';

export function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const timeoutMs = (options.timeoutSeconds ?? 120) * 1000;
    // 仅 npm 批处理类命令需要 shell；node 直调绝对路径必须 shell:false（避免路径空格被 cmd 拆断）
    const useShell = Boolean(options.useShell ?? (process.platform === 'win32' && /npm(\.cmd)?$/i.test(command)));
    const spawnOptions = {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env ?? {}) },
    };
    // Node ≥24 对 shell:true + args 数组组合告 DEP0190：需要 shell 时合并为单命令串
    //（命令与参数均为工具内控常量，无用户输入拼接，无注入面）
    const child = useShell
      ? spawn([command, ...args].join(' '), { ...spawnOptions, shell: true })
      : spawn(command, args, { ...spawnOptions, shell: false });
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
