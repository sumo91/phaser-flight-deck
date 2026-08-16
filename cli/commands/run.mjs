// ===== pdeck run：开发服务器 + 无头浏览器观察 =====
// 嵌套动作：serve（生命周期）/ snapshot（截图）/ console（控制台采集）/ probe（运行时探针）/ watch（流式观察）
// 浏览器动作消费 probes/flight-deck-probe.js 契约（window.__pdeck）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectProject } from '../lib/phaser-project.mjs';
import { launchHeadless, openPage, sleep } from '../lib/browser.mjs';
import { splitErrors, splitWarnings, collectBounded } from '../lib/console-filter.mjs';
import { envelope, fact, inconclusiveEnvelope } from '../result-envelope.mjs';

const SERVER_STATE = '.pdeck/server.json';
const PROBE_FILE = fileURLToPath(new URL('../../probes/flight-deck-probe.js', import.meta.url));

function serverStatePath(root) {
  return join(root, SERVER_STATE);
}

function npmCmd() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function taskkill(pid) {
  return new Promise((resolvePromise) => {
    if (process.platform !== 'win32') {
      try { process.kill(pid, 'SIGTERM'); resolvePromise({ ok: true }); }
      catch (error) { resolvePromise({ ok: false, out: error.message }); }
      return;
    }
    const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('close', (code) => resolvePromise({ ok: code === 0, out }));
  });
}

// ss -ltnp 监听行解析（纯函数，可单元测试）：形如
//   LISTEN 0 511 *:5173 *:* users:(("node",pid=1234,fd=20))
export function parseSsListenPids(output, port) {
  const pids = [];
  for (const line of output.split('\n')) {
    if (!line.includes('LISTEN')) continue;
    const addr = line.match(/(?:\*|(?:\d{1,3}\.){3}\d{1,3}|\[[^\]]*\]):(\d+)\b/);
    if (!addr || Number(addr[1]) !== Number(port)) continue;
    const pid = line.match(/pid=(\d+)/);
    if (pid) pids.push(Number(pid[1]));
  }
  return [...new Set(pids)];
}

// POSIX：macOS 无 ss、部分精简 Linux 无 lsof——lsof 优先（无则回退 ss）
function pidsByPortPosix(port) {
  const run = (cmd, args) => new Promise((resolveRun) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', () => resolveRun(null)); // 命令不存在
    child.on('close', () => resolveRun(out));
  });
  return new Promise(async (resolvePromise) => {
    const lsof = await run('lsof', ['-t', '-i', `TCP:${port}`, '-s', 'TCP:LISTEN']);
    if (lsof !== null) {
      resolvePromise([...new Set(lsof.split('\n').map((l) => Number(l.trim())).filter((p) => Number.isFinite(p) && p > 0))]);
      return;
    }
    const ss = await run('ss', ['-ltnp']);
    resolvePromise(ss === null ? [] : parseSsListenPids(ss, port));
  });
}

export async function pidsByPort(port) {
  // Windows：netstat -p TCP 只列 IPv4、不带 -p 只列 IPv6——两者合并才能覆盖 vite 双栈绑定
  // 实现刻意避免正则反斜杠转义（对任何传输层编码免疫）
  const CR = String.fromCharCode(13);
  const NL = String.fromCharCode(10);
  const run = (args) => new Promise((resolvePromise) => {
    const child = spawn('netstat', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', () => resolvePromise('')); // 工具缺失：按无监听处理，strictPort 兜底
    child.on('close', () => resolvePromise(out));
  });
  return new Promise(async (resolvePromise) => {
    if (process.platform !== 'win32') {
      resolvePromise(await pidsByPortPosix(port));
      return;
    }
    const [v4, v6] = await Promise.all([run(['-ano', '-p', 'TCP']), run(['-ano'])]);
    const lines = [...v4.replaceAll(CR, '').split(NL), ...v6.replaceAll(CR, '').split(NL)];
    const pids = lines
      .filter((l) => l.includes(':' + port) && l.includes('LISTENING'))
      .map((l) => Number(l.trim().split(' ').filter(Boolean).pop()))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
    resolvePromise([...new Set(pids)]);
  });
}

export function processCommandLine(pid) {
  return new Promise((resolvePromise) => {
    if (process.platform === 'win32') {
      const child = spawn('wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (c) => { out += c; });
      child.on('error', () => resolvePromise('')); // 新版 Windows 移除 wmic 时按未知归属处理（不误杀）
      child.on('close', () => resolvePromise(out.trim()));
      return;
    }
    // POSIX：ps 给完整命令行（归属校验与 Windows 同一逻辑：命令行引用项目路径才算自己的）
    const child = spawn('ps', ['-p', String(pid), '-o', 'command='], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', () => resolvePromise(''));
    child.on('close', () => resolvePromise(out.trim()));
  });
}

async function ownsPortProcess(pid, root) {
  // 仅当监听进程命令行引用了本项目路径（本项目 vite）时才算“自己的”进程——防误杀其它项目服务器
  const cmdline = await processCommandLine(pid);
  return cmdline.length > 0 && cmdline.replace(/\\/g, '/').includes(root.replace(/\\/g, '/'));
}

export async function runServe(args, options) {
  const { project, port, stop } = options;
  // --stop 只需定位 .pdeck/server.json 所在目录（服务归属锚点），Phaser 项目性不是必要条件
  const requestedDir = project ?? process.cwd();
  const proj = detectProject(requestedDir);
  let root = null;
  if (proj.found) root = proj.root;
  else if (stop && existsSync(serverStatePath(resolve(requestedDir)))) root = resolve(requestedDir);
  if (!root) {
    if (stop) {
      return inconclusiveEnvelope('run.serve', '--stop 需要定位记录服务的项目目录（读 .pdeck/server.json 确认归属，防止误杀其它项目服务）', [
        '在曾执行 pdeck run serve 的项目目录下重试，或用位置参数/--project 传项目路径',
      ]);
    }
    return inconclusiveEnvelope('run.serve', `不是可识别的 Phaser 项目: ${proj.reason}`);
  }
  const statePath = serverStatePath(root);

  if (stop) {
    if (!existsSync(statePath)) {
      return inconclusiveEnvelope('run.serve', '没有正在运行的服务器（.pdeck/server.json 不存在）');
    }
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const stopPort = port ?? state.port;
    const failures = [];
    if (pidAlive(state.pid)) {
      const result = await taskkill(state.pid);
      if (!result.ok) failures.push(result.out.trim().slice(0, 120));
    }
    const portPids = await pidsByPort(stopPort);
    const foreignPids = [];
    for (const portPid of portPids) {
      if (portPid === state.pid) continue;
      const ours = await ownsPortProcess(portPid, root);
      if (ours) {
        const result = await taskkill(portPid);
        if (!result.ok) failures.push(`端口 ${stopPort} 进程 ${portPid}: ${result.out.trim().slice(0, 120)}`);
      } else {
        foreignPids.push(portPid);
      }
    }
    if (failures.length) {
      return inconclusiveEnvelope('run.serve', `停止失败: ${failures.join('; ')}`, ['手动结束进程或改端口重启']);
    }
    const foreignNote = foreignPids.length ? `；端口 ${stopPort} 另有其它项目进程 ${foreignPids.join(',')} 在监听（未触碰）` : '';
    return envelope('PASSED', `已停止本项目 dev server（pid ${state.pid}${portPids.length ? '，已清理本项目端口进程' : ''}）${foreignNote}`, {
      kind: 'run.serve',
      facts: [fact('server_stopped', 'run.serve', '本项目进程树已终止' + foreignNote)],
    });
  }

  const usePort = port ?? 5173;
  // 已运行检查：仅当状态文件记录的端口与请求一致且进程存活
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      if (state.port === usePort && pidAlive(state.pid)) {
        return envelope('PASSED', `dev server 已在运行：${state.url}（pid ${state.pid}）`, {
          kind: 'run.serve',
          facts: [fact('server_running', 'run.serve', state.url, { actual: state })],
          nextSteps: ['pdeck run serve --stop 停止；pdeck run snapshot <url> 截图'],
        });
      }
    } catch { /* 损坏状态文件，继续启动 */ }
  }
  // 端口预检：已有任何监听进程就拒绝（共存会导致 localhost URL 歧义——命中的可能是别人家的服务器）
  const preCheck = await pidsByPort(usePort);
  if (preCheck.length) {
    let ourOwn = false;
    const ourPids = [];
    const foreign = [];
    for (const pid of preCheck) {
      if (pidAlive(pid) && (await ownsPortProcess(pid, root))) { ourOwn = true; ourPids.push(pid); }
      else foreign.push(pid);
    }
    if (ourOwn) {
      mkdirSync(join(root, '.pdeck'), { recursive: true });
      writeFileSync(statePath, JSON.stringify({ pid: ourPids[0], port: usePort, url: `http://localhost:${usePort}/`, startedAt: new Date().toISOString(), command: 'existing' }, null, 2));
      return envelope('PASSED', `dev server 已在运行（本项目 pid ${ourPids.join(',')}）${foreign.length ? `；另有其它项目进程 ${foreign.join(',')} 同端口监听（未触碰）` : ''}`, {
        kind: 'run.serve',
        facts: [fact('server_running', 'run.serve', `端口 ${usePort} 由本项目进程监听`, { actual: { ours: ourPids, foreign } })],
      });
    }
    return inconclusiveEnvelope('run.serve', `端口 ${usePort} 已被其它进程占用（pid ${preCheck.join(',')}）——拒绝启动，避免 URL 歧义`, [
      '确认占用者后选择：pdeck run serve --port 5174 换端口；或先手动确认该进程可以停止',
    ]);
  }
  // 优先直启 node vite（单一进程树，可精确停止）；否则退回 npm run dev
  const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  let child = null;
  let command = '';
  if (existsSync(viteBin)) {
    child = spawn(process.execPath, [viteBin, '--port', String(usePort), '--strictPort'], {
      cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], detached: true,
    });
    command = 'node vite';
  } else if (proj.scripts?.dev) {
    // Windows npm.cmd 批处理需要 shell；单命令串形式避免 Node ≥24 的 DEP0190 弃用警告
    const devArgs = ['run', 'dev', '--', '--port', String(usePort), '--strictPort'];
    child = process.platform === 'win32'
      ? spawn(`${npmCmd()} ${devArgs.join(' ')}`, { cwd: root, shell: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], detached: true })
      : spawn(npmCmd(), devArgs, { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], detached: true });
    command = 'npm run dev';
  } else {
    return inconclusiveEnvelope('run.serve', '未发现 vite 且未定义 dev 脚本——无法启动开发服务器', [
      '在 package.json 添加 dev 脚本（如 "dev": "vite"），或手动启动后直接用 pdeck run snapshot <url>',
    ]);
  }
  child.unref();
  const state = { pid: child.pid, port: usePort, url: `http://localhost:${usePort}/`, startedAt: new Date().toISOString(), command };
  mkdirSync(join(root, '.pdeck'), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  // 实测可达性 + 自己的 pid 存活：不把“别人的服务器响应”或“未验证的启动”说成成功
  const reachable = await waitReachable(`http://127.0.0.1:${usePort}/`, 8);
  const ownAlive = pidAlive(child.pid);
  if (!reachable || !ownAlive) {
    const portPids = await pidsByPort(usePort);
    await taskkill(child.pid).catch(() => {});
    return envelope('FAILED', `dev server 启动未验证（${reachable ? '子进程在验证前退出，端口冲突？' : 'HTTP 探测超时'}；端口可能被其它项目占用: ${portPids.join(',') || '未知进程'}）`, {
      kind: 'run.serve',
      facts: [
        fact('startup_unverified', 'run.serve', reachable ? '子进程已退出（vite strictPort 绑定失败？）' : 'HTTP 探测超时', { actual: { url: state.url, portPids, ownAlive } }),
      ],
      nextSteps: ['pdeck run serve --stop 清理本项目残留后换端口重试（pdeck run serve --port 5174）——注意勿终止其它项目的 dev server'],
    });
  }

  return envelope('PASSED', `dev server 已启动并响应：${state.url}（pid ${child.pid}，detached ${command}）`, {
    kind: 'run.serve',
    facts: [fact('server_started', 'run.serve', state.url, { actual: state })],
    nextSteps: ['pdeck run snapshot <url> 截图；pdeck run serve --stop 停止'],
  });
}

// URL 形态诊断提示（R2）：file:// 会被浏览器 CORS 拦截，给出直达出路
function urlHint(errors) {
  const lines = Array.isArray(errors) ? errors : [];
  if (lines.some((l) => /CORS|file:\/\/|ERR_FAILED/i.test(l))) {
    return ['目标应为 HTTP URL（如 http://localhost:5173/）——file:// 路径会被浏览器 CORS 拦截，先 pdeck run serve 起服务再观察'];
  }
  return [];
}

// 自动服务生命周期（observe / playtest 共用）：有 --url 直接用；有可用状态则复用；
// 否则自己起服务并返回 stopNeeded（调用方 finally 负责清理，只清理自己起的）。
// 未显式指定端口时若默认口被外部进程占用（多项目并发开发的常态），自动尝试后续候选——
// 这类动作自己起停自己的服务、URL 由自己消费，不存在 serve 的 URL 归属歧义。
export async function autoServerLifecycle(project, port) {
  const proj = detectProject(project ?? process.cwd());
  if (!proj.found) {
    return { error: `不是可识别的 Phaser 项目: ${proj.reason}`, hint: ['传项目路径（或 --url 指向运行中的页面）'] };
  }
  const statePath = serverStatePath(proj.root);
  if (existsSync(statePath)) {
    try {
      const st = JSON.parse(readFileSync(statePath, 'utf8'));
      if ((!port || st.port === port) && pidAlive(st.pid)) {
        return { url: st.url, stopNeeded: false, note: `复用已在运行的 dev server（pid ${st.pid}）`, root: proj.root };
      }
    } catch { /* 状态文件损坏，走启动 */ }
  }
  const candidates = port ? [String(port)] : ['5173', '5174', '5175', '5176', '5177', '5178'];
  for (const candidate of candidates) {
    const served = await runServe([], { project: proj.root, port: candidate });
    if (served.verdict === 'PASSED') {
      const startedFact = served.facts?.find((f) => f.classification === 'server_started');
      return {
        url: startedFact?.actual?.url ?? `http://localhost:${candidate}/`,
        stopNeeded: true,
        note: `本次由 pdeck 临时起服务（端口 ${candidate}），结束后自动清理`,
        root: proj.root,
      };
    }
    const occupied = String(served.summary ?? '').includes('占用');
    if (!occupied || port) {
      // 显式指定的端口被占或非占用类失败：如实失败，不静默换口
      return { error: `自动起服务失败: ${served.summary}`, envelope: served };
    }
  }
  return { error: '默认端口 5173-5178 均被外部进程占用', hint: ['用 --port 指定空闲端口，或 --url 直连运行中的页面'] };
}

export async function stopAutoServer(root, port) {
  if (!root) return;
  await runServe([], { project: root, port, stop: true }).catch(() => {});
}

// R1：observe 复合动作——按需起服务 → 观察 → 自己起的必清理（复用已有服务器时不碰）
export async function runObserve(args, options) {
  const { project, url, seconds = 5, port } = options;
  let targetUrl = url ?? null;
  let stopRoot = null;
  let lifecycleNote = null;
  if (!targetUrl) {
    const auto = await autoServerLifecycle(project, port);
    if (auto.error) {
      return auto.envelope ?? inconclusiveEnvelope('run.observe', auto.error, auto.hint ?? ['pdeck run observe <url> 直接观察运行中的页面，或传项目路径']);
    }
    targetUrl = auto.url;
    lifecycleNote = auto.note;
    if (auto.stopNeeded) stopRoot = auto.root;
  }
  try {
    const observation = await runConsole([], { url: targetUrl, seconds });
    observation.kind = 'run.observe';
    if (lifecycleNote) {
      observation.facts.push(fact('lifecycle', 'run.observe', lifecycleNote));
      observation.summary += `；${lifecycleNote}`;
    }
    if (observation.verdict === 'FAILED') {
      const realErrors = (observation.facts ?? []).filter((f) => f.classification === 'console_errors' || f.classification === 'page_errors')
        .flatMap((f) => (Array.isArray(f.actual) ? f.actual : []));
      observation.nextSteps = [...(observation.nextSteps ?? []), ...urlHint(realErrors)];
    }
    return observation;
  } finally {
    if (stopRoot) await stopAutoServer(stopRoot, port);
  }
}

async function waitReachable(url, maxSeconds) {
  // vite 在 Windows 可能只绑 IPv6 [::1]（localhost 解析顺序）——双栈探测
  const port = url.split(':').pop().replace(String.fromCharCode(47), '');
  const targets = [`http://127.0.0.1:${port}/`, `http://[::1]:${port}/`];
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    for (const target of targets) {
      try {
        const res = await fetch(target, { signal: AbortSignal.timeout(1500) });
        if (res.status < 500) return true;
      } catch { /* 继续等 */ }
    }
    await sleep(500);
  }
  return false;
}

async function requireBrowserTarget(url) {
  if (!url) {
    return { error: '缺少目标 URL（先 pdeck run serve，或传 URL 参数）' };
  }
  const launched = await launchHeadless();
  if (!launched.ok) return { error: launched.error };
  return { launched };
}

export async function runSnapshot(args, options) {
  const { project, url, output, viewport = '1280x800' } = options;
  const parts = String(viewport).split('x').map(Number);
  const vw = Number.isFinite(parts[0]) ? parts[0] : 1280;
  const vh = Number.isFinite(parts[1]) ? parts[1] : 800;
  const target = await requireBrowserTarget(url);
  if (target.error) return inconclusiveEnvelope('run.snapshot', target.error, ['pdeck run serve 启动开发服务器后重试']);
  const proj = detectProject(project ?? process.cwd());
  const capturesDir = proj.found ? join(proj.root, '.pdeck', 'captures') : '.pdeck/captures';
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = output ?? join(capturesDir, `snapshot-${stamp}.png`);
    mkdirSync(join(outPath, '..'), { recursive: true });
    const { page, consoleErrors, pageErrors } = await openPage(target.launched.browser, url, { width: vw, height: vh });
    await sleep(2000);
    await page.screenshot({ path: outPath });
    const facts = [fact('captured', 'run.snapshot', '截图已保存', { actual: { path: outPath, consoleErrors: consoleErrors.length, pageErrors: pageErrors.length } })];
    if (pageErrors.length) facts.push(fact('page_errors', 'run.snapshot', `页面异常 ${pageErrors.length} 条`, { actual: collectBounded(pageErrors) }));
    if (consoleErrors.length) facts.push(fact('console_errors', 'run.snapshot', `控制台错误 ${consoleErrors.length} 条`, { actual: collectBounded(consoleErrors) }));
    return envelope(pageErrors.length ? 'FAILED' : 'PASSED', pageErrors.length ? '截图完成但页面存在未捕获异常' : '截图完成', {
      kind: 'run.snapshot',
      facts,
      artifacts: [outPath],
    });
  } catch (error) {
    return inconclusiveEnvelope('run.snapshot', `截图失败: ${error.message}`, ['确认 URL 可达、页面可加载']);
  } finally {
    await target.launched.browser.close().catch(() => {});
  }
}

// 良性错误过滤：favicon 404 等资源噪声不应导致裁决失败（共用 lib，见 console-filter.mjs）

export async function runConsole(args, options) {
  const { url, seconds = 5 } = options;
  const target = await requireBrowserTarget(url);
  if (target.error) return inconclusiveEnvelope('run.console', target.error);
  try {
    const { page, consoleErrors, pageErrors, consoleWarnings } = await openPage(target.launched.browser, url);
    await sleep(Math.min(Number(seconds) || 5, 30) * 1000);
    const errors = splitErrors(consoleErrors);
    const warnings = splitWarnings(consoleWarnings);
    const verdict = pageErrors.length || errors.real.length ? 'FAILED' : 'PASSED';
    const facts = [];
    if (pageErrors.length) facts.push(fact('page_errors', 'run.console', `页面未捕获异常 ${pageErrors.length} 条`, { actual: collectBounded(pageErrors) }));
    if (errors.real.length) facts.push(fact('console_errors', 'run.console', `控制台错误 ${errors.real.length} 条`, { actual: collectBounded(errors.real) }));
    if (errors.benign.length) facts.push(fact('benign_errors', 'run.console', `良性资源 404 ${errors.benign.length} 条（favicon 等，不计入失败）`, { actual: collectBounded(errors.benign, 4) }));
    if (warnings.real.length) facts.push(fact('console_warnings', 'run.console', `控制台警告 ${warnings.real.length} 条`, { actual: collectBounded(warnings.real, 6) }));
    if (warnings.envNoise.length) facts.push(fact('env_noise', 'run.console', `环境噪音 ${warnings.envNoise.length} 条（无头 SwiftShader GPU 驱动消息，真机无此项，已归类不干扰裁决）`));
    if (!facts.some((f) => f.classification.includes('errors'))) facts.push(fact('clean', 'run.console', `观察 ${seconds}s：无页面异常、无实质性控制台错误`));
    return envelope(verdict, verdict === 'FAILED' ? '发现实质性错误（见 facts）' : '控制台观察干净（良性 404 与环境噪音除外）', {
      kind: 'run.console',
      facts,
      nextSteps: verdict === 'FAILED' ? urlHint([...pageErrors, ...errors.real]) : [],
    });
  } catch (error) {
    return inconclusiveEnvelope('run.console', `观察失败: ${error.message}`);
  } finally {
    await target.launched.browser.close().catch(() => {});
  }
}

export async function runProbe(args, options) {
  const { url, query } = options;
  const target = await requireBrowserTarget(url);
  if (target.error) return inconclusiveEnvelope('run.probe', target.error);
  try {
    const { page } = await openPage(target.launched.browser, url);
    await sleep(1500);
    let payload;
    try {
      payload = JSON.parse(query ?? '{"kind":"installed"}');
    } catch {
      return inconclusiveEnvelope('run.probe', '--query 需为合法 JSON');
    }
    const result = await page.evaluate((request) => {
      const probe = window.__pdeck;
      if (!probe) return { probeInstalled: false };
      const out = {};
      for (const [key, value] of Object.entries(request)) {
        if (key === 'kind') continue;
        try { out[key] = probe.query[value] ? probe.query[value]() : `未知查询: ${value}`; }
        catch (e) { out[key] = `查询异常: ${e.message}`; }
      }
      out.probeInstalled = true;
      out.probeVersion = probe.version ?? null;
      return out;
    }, payload);
    if (!result.probeInstalled) {
      return inconclusiveEnvelope('run.probe', '页面未安装运行时探针（window.__pdeck 不存在）', [
        `参考实现: ${PROBE_FILE}（复制/参考后在游戏入口调用 installProbe(game, state)）`,
        '或手写最小契约: window.__pdeck = { query: { state: () => ({ level: 1 }) } }（query 下任意只读函数即可被 --query 调用）',
      ]);
    }
    return envelope('PASSED', '探针查询完成', {
      kind: 'run.probe',
      facts: Object.entries(result).map(([key, value]) => fact('probe_result', 'run.probe', `${key}`, { actual: value })),
    });
  } catch (error) {
    return inconclusiveEnvelope('run.probe', `探针失败: ${error.message}`);
  } finally {
    await target.launched.browser.close().catch(() => {});
  }
}

export async function runWatch(args, options) {
  const { url, seconds = 10 } = options;
  const target = await requireBrowserTarget(url);
  if (target.error) return inconclusiveEnvelope('run.watch', target.error);
  try {
    const { page, consoleErrors, pageErrors, consoleWarnings } = await openPage(target.launched.browser, url);
    const start = Date.now();
    const durationMs = Math.min(Number(seconds) || 10, 60) * 1000;
    while (Date.now() - start < durationMs) {
      await sleep(1000);
      const status = {
        t: Math.round((Date.now() - start) / 1000),
        pageErrors: pageErrors.length,
        consoleErrors: consoleErrors.length,
        warnings: consoleWarnings.length,
      };
      // --json 时进度走 stderr，保证 stdout 只有最终 JSON 信封（机器可读承诺）
      const progress = `[watch ${status.t}s] errors=${status.consoleErrors}/${status.pageErrors} warnings=${status.warnings}\n`;
      (options.json ? process.stderr : process.stdout).write(progress);
    }
    const errors = splitErrors(consoleErrors);
    const warnings = splitWarnings(consoleWarnings);
    const verdict = pageErrors.length || errors.real.length ? 'FAILED' : 'PASSED';
    const facts = [];
    if (pageErrors.length) facts.push(fact('page_errors', 'run.watch', `页面未捕获异常 ${pageErrors.length} 条`, { actual: collectBounded(pageErrors) }));
    if (errors.real.length) facts.push(fact('console_errors', 'run.watch', `控制台错误 ${errors.real.length} 条`, { actual: collectBounded(errors.real) }));
    if (warnings.real.length) facts.push(fact('console_warnings', 'run.watch', `警告 ${warnings.real.length} 条`, { actual: collectBounded(warnings.real, 6) }));
    if (warnings.envNoise.length) facts.push(fact('env_noise', 'run.watch', `环境噪音 ${warnings.envNoise.length} 条（无头 GPU 驱动消息，已归类不干扰裁决）`));
    if (!facts.some((f) => f.classification.includes('errors'))) facts.push(fact('clean', 'run.watch', `观察 ${Math.round(durationMs / 1000)}s：无错误`));
    return envelope(verdict, verdict === 'FAILED' ? '观察窗口内出现错误' : '观察窗口干净', { kind: 'run.watch', facts });
  } catch (error) {
    return inconclusiveEnvelope('run.watch', `观察失败: ${error.message}`);
  } finally {
    await target.launched.browser.close().catch(() => {});
  }
}

// ===== playtest：机器人玩家玩测（剧本驱动真实 UI + 设计逻辑注入）=====
// 剧本契约：JSON { name, steps: [{do, ...}] }，8 种动作——
//   press(key) / hold(key,ms) / wait(ms) / click(x,y)          输入与等待
//   expect(that,eval[,within]) / collect(that,eval)            eval 在页面内求值（可调 window.__session 等注入点）
//   store(as,eval)                                              求值存入剧本变量，后续步骤字符串用 {{as}} 引用
//   capture(as)                                                 截图证据
// expect 可带 within(ms)：窗口内轮询直到满足（加载/动画时序不再需要手工 wait 试错）。
// 求值/执行抛错或 expect 为假 → FAILED（decisive 为该步）；页面未捕获异常 → FAILED。
const PLAYTEST_MAX_STEPS = 64;
const PLAYTEST_KINDS = ['press', 'hold', 'wait', 'click', 'expect', 'collect', 'store', 'capture'];
const PLAYTEST_VAR_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,39}$/;
const PLAYTEST_HINT = [
  '剧本：{"name":"冒烟","steps":[{"do":"press","key":"Enter"},{"do":"expect","that":"已开局","eval":"()=> !!window.__game","within":2000}]}',
  '动作：press(key) hold(key,ms) wait(ms) click(x,y) expect/collect(that,eval) store(as,eval) capture(as)',
  'expect 可加 within(ms) 轮询；跨步骤对比用 store 存值、后续 eval 字符串里 {{变量名}} 引用（如 "({g:window.__s.gold}) => g > {{gold0}}"）',
];

export function loadPlaytestScript(scriptPath) {
  if (!scriptPath) return { error: '缺少剧本路径（pdeck run playtest <script.json> [project]）' };
  if (!existsSync(scriptPath)) return { error: `剧本文件不存在: ${scriptPath}` };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(scriptPath, 'utf8'));
  } catch (error) {
    return { error: `剧本不是合法 JSON: ${error.message}` };
  }
  const steps = Array.isArray(parsed?.steps) ? parsed.steps : null;
  if (!steps || !steps.length) return { error: '剧本缺少非空 steps 数组' };
  if (steps.length > PLAYTEST_MAX_STEPS) return { error: `剧本步骤 ${steps.length} 超上限 ${PLAYTEST_MAX_STEPS}` };
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = `第 ${i + 1} 步`;
    if (!step || !PLAYTEST_KINDS.includes(step.do)) {
      return { error: `${label}动作非法: ${JSON.stringify(step?.do)}（可用：${PLAYTEST_KINDS.join(' | ')}）` };
    }
    if ((step.do === 'press' || step.do === 'hold') && typeof step.key !== 'string') return { error: `${label} ${step.do} 需要 key` };
    if (['hold', 'wait'].includes(step.do) && (!Number.isFinite(step.ms) || step.ms < 0 || step.ms > 10000)) return { error: `${label} ${step.do} 的 ms 需为 0..10000` };
    if (step.do === 'click' && (!Number.isFinite(step.x) || !Number.isFinite(step.y))) return { error: `${label} click 需要 x/y 数值` };
    if ((step.do === 'expect' || step.do === 'collect') && typeof step.eval !== 'string') return { error: `${label} ${step.do} 需要 eval（页面内求值表达式）` };
    if ((step.do === 'expect' || step.do === 'store') && step.within !== undefined && (!Number.isInteger(step.within) || step.within < 0 || step.within > 10000)) {
      return { error: `${label} ${step.do} 的 within 需为 0..10000 的整数毫秒` };
    }
    if (step.do === 'store' && (typeof step.eval !== 'string' || typeof step.as !== 'string' || !PLAYTEST_VAR_PATTERN.test(step.as))) {
      return { error: `${label} store 需要 eval 与 as（变量名 [A-Za-z0-9_-]，不以连字符开头）` };
    }
    if (step.do === 'capture' && typeof step.as !== 'string') return { error: `${label} capture 需要 as（截图名）` };
  }
  return { script: { name: typeof parsed.name === 'string' ? parsed.name.slice(0, 40) : 'playtest', steps } };
}

// 剧本变量插值：把步骤字符串字段里的 {{name}} 替换为已 store 变量的 JSON 字面量；
// 数值字段（x/y/ms）是 JSON 数字字面量，不参与插值。未定义变量原样保留并上报（步骤将以明确报错失败）。
export function interpolateVars(step, vars) {
  const missing = new Set();
  const resolve = (text) => text.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (whole, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return JSON.stringify(vars[name]);
    missing.add(name);
    return whole;
  });
  const out = {};
  for (const [key, value] of Object.entries(step)) {
    out[key] = typeof value === 'string' ? resolve(value) : value;
  }
  return { step: out, missing: [...missing] };
}

// 页面内求值：剧本 eval 支持两种写法——'() => …' 函数串（Node 侧构函后由页面调用）
// 或 '…' 纯表达式（playwright 直接按表达式求值）。字符串直传函数体会被当表达式、
// 返回函数对象本身（不可序列化 → undefined），必须区分处理。
export async function evalInPage(page, expr) {
  const isFunction = /^\s*(?:async\s+)?function\b/.test(expr)
    || /^\s*(?:async\s+)?(?:\((?:[^()]*)\)|[A-Za-z_$][\w$]*)\s*=>/.test(expr);
  if (isFunction) {
    const fn = (0, eval)(`(${expr})`);
    return page.evaluate(fn);
  }
  return page.evaluate(expr);
}

// 剧本步骤执行内核（playtest 与 baseline/visual-test --script 共用）：
// 在已打开的页面上按序执行步骤，返回失败信息/事实/工件/输入日志/剧本变量。
// ctx.consoleErrors / ctx.pageErrors 为 openPage 采集器，执行完统一折算为失败事实。
export async function driveSteps(page, steps, ctx) {
  const { capturesDir, stamp, consoleErrors = [], pageErrors = [] } = ctx;
  const facts = [];
  const artifacts = [];
  const inputLog = [];
  const vars = {};
  let failed = null;
  for (let i = 0; i < steps.length && !failed; i++) {
    const raw = steps[i];
    let step;
    try {
      const resolved = interpolateVars(raw, vars);
      step = resolved.step;
      if (resolved.missing.length) {
        failed = `第 ${i + 1} 步引用未定义变量: ${resolved.missing.join(', ')}`;
        facts.push(fact('undefined_var', 'playtest', failed, { actual: { step: i + 1, missing: resolved.missing } }));
        break;
      }
    } catch (error) {
      failed = `第 ${i + 1} 步变量插值失败: ${error.message}`;
      break;
    }
    try {
      switch (step.do) {
        case 'press':
          await page.keyboard.press(step.key);
          inputLog.push(`press ${step.key}`);
          break;
        case 'hold':
          await page.keyboard.down(step.key);
          await sleep(Math.min(step.ms, 10000));
          await page.keyboard.up(step.key);
          inputLog.push(`hold ${step.key} ${step.ms}ms`);
          break;
        case 'wait':
          await sleep(Math.min(step.ms, 10000));
          inputLog.push(`wait ${step.ms}ms`);
          break;
        case 'click':
          await page.mouse.click(step.x, step.y);
          inputLog.push(`click ${step.x},${step.y}`);
          break;
        case 'store': {
          // 可选 within：轮询到值非 null/undefined 再冻结——场景/资源未就绪时 store 不会把瞬态 null 固化成常量
          const within = Number.isInteger(step.within) ? Math.min(step.within, 10000) : 0;
          const startAt = Date.now();
          let value;
          let evalError = null;
          for (;;) {
            try {
              value = await evalInPage(page, step.eval);
              evalError = null;
            } catch (error) {
              value = undefined;
              evalError = error;
            }
            if (!within || (value !== null && value !== undefined)) break;
            if (Date.now() - startAt >= within) break;
            await sleep(Math.min(250, within - (Date.now() - startAt)));
          }
          if (evalError && (value === null || value === undefined)) throw evalError;
          vars[step.as] = value;
          facts.push(fact('stored', 'playtest', `${i + 1}. ${step.as} = ${JSON.stringify(value) ?? 'undefined'}`.slice(0, 200), {
            actual: { name: step.as, value, ...(within ? { within, waitedMs: Date.now() - startAt } : {}) },
          }));
          break;
        }
        case 'expect': {
          const within = Number.isInteger(step.within) ? Math.min(step.within, 10000) : 0;
          const startAt = Date.now();
          let value;
          let evalError = null;
          for (;;) {
            try {
              value = await evalInPage(page, step.eval);
              evalError = null;
            } catch (error) {
              value = undefined;
              evalError = error; // 加载期变量未就绪等瞬态错误：轮询窗口内重试
            }
            if (value) break;
            if (Date.now() - startAt >= within) break;
            await sleep(Math.min(250, within - (Date.now() - startAt)));
          }
          if (!value) {
            failed = `第 ${i + 1} 步 expect 未满足${within ? `（within ${within}ms 轮询后仍为假）` : ''}: ${step.that ?? step.eval.slice(0, 60)}`;
            facts.push(fact('expect_failed', 'playtest', `${i + 1}. ${step.that ?? 'eval 为假'}`, {
              actual: {
                value: value === undefined ? null : value,
                eval: step.eval.slice(0, 120),
                ...(within ? { within, waitedMs: Date.now() - startAt } : {}),
                ...(evalError ? { evalError: String(evalError.message ?? evalError).slice(0, 160) } : {}),
              },
            }));
          } else {
            facts.push(fact('expect_ok', 'playtest', `${i + 1}. ${step.that ?? '满足'}${within ? `（轮询 ${Date.now() - startAt}ms 后满足）` : ''}`));
          }
          break;
        }
        case 'collect': {
          const value = await evalInPage(page, step.eval);
          facts.push(fact('collected', 'playtest', `${i + 1}. ${step.that ?? step.eval.slice(0, 60)}`, { actual: value }));
          break;
        }
        case 'capture': {
          mkdirSync(capturesDir, { recursive: true });
          const shot = join(capturesDir, `playtest-${step.as}-${stamp}.png`);
          await page.screenshot({ path: shot });
          artifacts.push(shot);
          facts.push(fact('captured', 'playtest', `${i + 1}. ${step.as}`, { actual: { path: shot } }));
          break;
        }
      }
    } catch (error) {
      failed = `第 ${i + 1} 步 ${step.do} 执行失败: ${error.message}`;
      facts.push(fact('step_error', 'playtest', failed, { actual: { step: i + 1, do: step.do } }));
    }
  }
  if (inputLog.length) {
    facts.push(fact('inputs', 'playtest', `输入序列: ${inputLog.slice(0, 8).join(' → ')}${inputLog.length > 8 ? ' …' : ''}`));
  }
  const errors = splitErrors(consoleErrors);
  if (pageErrors.length) {
    failed = failed ?? `页面未捕获异常 ${pageErrors.length} 条`;
    facts.push(fact('page_errors', 'playtest', `页面未捕获异常 ${pageErrors.length} 条`, { actual: collectBounded(pageErrors) }));
  }
  if (errors.real.length) {
    failed = failed ?? `实质性控制台错误 ${errors.real.length} 条`;
    facts.push(fact('console_errors', 'playtest', `实质性控制台错误 ${errors.real.length} 条`, { actual: collectBounded(errors.real) }));
  }
  if (!failed && !pageErrors.length && !errors.real.length) {
    facts.push(fact('clean', 'playtest', `${steps.length} 步全部执行完毕，无页面异常与实质错误`));
  }
  return { failed, facts, artifacts, inputLog, vars };
}

export async function runPlaytest(args, options) {
  const { project, url, script, viewport } = options;
  const loaded = loadPlaytestScript(script ?? args[0]);
  if (loaded.error) return inconclusiveEnvelope('run.playtest', loaded.error, PLAYTEST_HINT);
  const { name, steps } = loaded.script;

  // 目标页面：--url 优先；否则与 observe 相同的自动起停（复用不碰，自起必清理）
  let targetUrl = url ?? null;
  let stopRoot = null;
  let lifecycleNote = null;
  if (!targetUrl) {
    const auto = await autoServerLifecycle(project, options.port);
    if (auto.error) {
      return auto.envelope ?? inconclusiveEnvelope('run.playtest', auto.error, auto.hint ?? PLAYTEST_HINT);
    }
    targetUrl = auto.url;
    lifecycleNote = auto.note;
    if (auto.stopNeeded) stopRoot = auto.root;
  }

  const target = await requireBrowserTarget(targetUrl);
  if (target.error) {
    if (stopRoot) await stopAutoServer(stopRoot, options.port);
    return inconclusiveEnvelope('run.playtest', target.error, ['安装系统 Chrome/Edge，或 cd 工具目录 npm install（playwright-core）']);
  }

  try {
    const size = String(viewport ?? '1280x800').split('x').map(Number);
    const view = { width: Number.isFinite(size[0]) ? size[0] : 1280, height: Number.isFinite(size[1]) ? size[1] : 800 };
    const { page, consoleErrors, pageErrors } = await openPage(target.launched.browser, targetUrl, view);
    const proj = detectProject(project ?? process.cwd());
    const capturesDir = join(proj.found ? proj.root : process.cwd(), '.pdeck', 'captures');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const kindCount = {};
    for (const s of steps) kindCount[s.do] = (kindCount[s.do] ?? 0) + 1;
    const facts = [fact('script', 'run.playtest', `剧本 "${name}" 共 ${steps.length} 步（${Object.entries(kindCount).map(([k, n]) => `${k}×${n}`).join(' ')}）`)];
    if (lifecycleNote) facts.push(fact('lifecycle', 'run.playtest', lifecycleNote));

    const driven = await driveSteps(page, steps, { capturesDir, stamp, consoleErrors, pageErrors });
    facts.push(...driven.facts);
    const failed = driven.failed;
    return envelope(failed ? 'FAILED' : 'PASSED', failed
      ? `玩测失败：${failed}`
      : `玩测通过：剧本 "${name}" ${steps.length} 步全部完成${lifecycleNote ? `（${lifecycleNote}）` : ''}`, {
      kind: 'run.playtest',
      decisiveStage: failed ? 'run.playtest' : undefined,
      facts,
      artifacts: driven.artifacts,
      nextSteps: failed
        ? ['根据 expect_failed/step_error 的步骤号定位剧本与页面行为差异；pdeck run console <url> 观察控制台']
        : ['把 expect 断言加入关键设计逻辑（如 window.__session 状态变化），逐步扩大剧本覆盖'],
    });
  } catch (error) {
    return inconclusiveEnvelope('run.playtest', `玩测执行异常: ${error.message}`);
  } finally {
    await target.launched.browser.close().catch(() => {});
    if (stopRoot) await stopAutoServer(stopRoot, options.port);
  }
}

export async function run(args, options) {
  const action = options.action ?? args[0] ?? 'serve';
  const restArgs = args.slice(args[0] === action ? 1 : 0);
  const restOptions = { ...options };
  // 第二个位置参数语义：serve/observe → project；playtest → 剧本路径（第三个为 project）；其余动作 → url
  if (restArgs.length) {
    if (action === 'playtest') {
      if (!restOptions.script) restOptions.script = restArgs[0];
      if (restArgs[1] && !restOptions.project) restOptions.project = restArgs[1];
    } else if ((action === 'serve' || action === 'observe') && !restOptions.project) {
      restOptions.project = restArgs[0];
    } else if (action !== 'serve' && action !== 'observe' && !restOptions.url) {
      restOptions.url = restArgs[0];
    }
  }
  switch (action) {
    case 'serve': return runServe(restArgs, restOptions);
    case 'snapshot': return runSnapshot(restArgs, restOptions);
    case 'console': return runConsole(restArgs, restOptions);
    case 'probe': return runProbe(restArgs, restOptions);
    case 'watch': return runWatch(restArgs, restOptions);
    case 'observe': return runObserve(restArgs, restOptions);
    case 'playtest': return runPlaytest(restArgs, restOptions);
    default:
      return inconclusiveEnvelope('run', `未知 run 动作: ${action}`, ['可用：serve | snapshot | console | probe | watch | observe | playtest']);
  }
}
