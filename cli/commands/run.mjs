// ===== pdeck run：开发服务器 + 无头浏览器观察 =====
// 嵌套动作：serve（生命周期）/ snapshot（截图）/ console（控制台采集）/ probe（运行时探针）/ watch（流式观察）
// 浏览器动作消费 probes/flight-deck-probe.js 契约（window.__pdeck）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

function pidsByPort(port) {
  // Windows：netstat -p TCP 只列 IPv4、不带 -p 只列 IPv6——两者合并才能覆盖 vite 双栈绑定
  // 实现刻意避免正则反斜杠转义（对任何传输层编码免疫）
  const CR = String.fromCharCode(13);
  const NL = String.fromCharCode(10);
  const run = (args) => new Promise((resolvePromise) => {
    const child = spawn('netstat', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('close', () => resolvePromise(out));
  });
  return new Promise(async (resolvePromise) => {
    if (process.platform !== 'win32') return resolvePromise([]);
    const [v4, v6] = await Promise.all([run(['-ano', '-p', 'TCP']), run(['-ano'])]);
    const lines = [...v4.replaceAll(CR, '').split(NL), ...v6.replaceAll(CR, '').split(NL)];
    const pids = lines
      .filter((l) => l.includes(':' + port) && l.includes('LISTENING'))
      .map((l) => Number(l.trim().split(' ').filter(Boolean).pop()))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
    resolvePromise([...new Set(pids)]);
  });
}

function processCommandLine(pid) {
  return new Promise((resolvePromise) => {
    if (process.platform !== 'win32') return resolvePromise('');
    const child = spawn('wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
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
  const proj = detectProject(project ?? process.cwd());
  if (!proj.found) return inconclusiveEnvelope('run.serve', `不是可识别的 Phaser 项目: ${proj.reason}`);
  const root = proj.root;
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
    child = spawn(npmCmd(), ['run', 'dev', '--', '--port', String(usePort), '--strictPort'], {
      cwd: root, shell: process.platform === 'win32', windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], detached: true,
    });
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

// R1：observe 复合动作——按需起服务 → 观察 → 自己起的必清理（复用已有服务器时不碰）
export async function runObserve(args, options) {
  const { project, url, seconds = 5, port } = options;
  let targetUrl = url ?? null;
  let stopNeeded = false;
  let lifecycleFact = null;
  if (!targetUrl) {
    const proj = detectProject(project ?? process.cwd());
    if (!proj.found) return inconclusiveEnvelope('run.observe', `不是可识别的 Phaser 项目: ${proj.reason}`, ['pdeck run observe <url> 直接观察运行中的页面，或传项目路径']);
    const statePath = serverStatePath(proj.root);
    let running = false;
    if (existsSync(statePath)) {
      try {
        const st = JSON.parse(readFileSync(statePath, 'utf8'));
        if ((!port || st.port === port) && pidAlive(st.pid)) { running = true; targetUrl = st.url; lifecycleFact = `复用已在运行的 dev server（pid ${st.pid}）`; }
      } catch { /* 状态文件损坏，走启动 */ }
    }
    if (!running) {
      const served = await runServe([], { project: proj.root, port });
      if (served.verdict !== 'PASSED') return served;
      const startedFact = served.facts?.find((f) => f.classification === 'server_started');
      targetUrl = startedFact?.actual?.url ?? `http://localhost:${port ?? 5173}/`;
      stopNeeded = true;
      lifecycleFact = '本次观察由 observe 临时起服务，结束后自动清理';
    }
  }
  try {
    const observation = await runConsole([], { url: targetUrl, seconds });
    observation.kind = 'run.observe';
    if (lifecycleFact) {
      observation.facts.push(fact('lifecycle', 'run.observe', lifecycleFact));
      observation.summary += `；${lifecycleFact}`;
    }
    if (observation.verdict === 'FAILED') {
      const realErrors = (observation.facts ?? []).filter((f) => f.classification === 'console_errors' || f.classification === 'page_errors')
        .flatMap((f) => (Array.isArray(f.actual) ? f.actual : []));
      observation.nextSteps = [...(observation.nextSteps ?? []), ...urlHint(realErrors)];
    }
    return observation;
  } finally {
    if (stopNeeded) {
      const proj = detectProject(project ?? process.cwd());
      if (proj.found) {
        await runServe([], { project: proj.root, port, stop: true }).catch(() => {});
      }
    }
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

export async function run(args, options) {
  const action = options.action ?? args[0] ?? 'serve';
  const restArgs = args.slice(args[0] === action ? 1 : 0);
  const restOptions = { ...options };
  // 第二个位置参数语义：serve/observe → project；其余动作 → url
  if (restArgs.length) {
    if ((action === 'serve' || action === 'observe') && !restOptions.project) restOptions.project = restArgs[0];
    else if (action !== 'serve' && action !== 'observe' && !restOptions.url) restOptions.url = restArgs[0];
  }
  switch (action) {
    case 'serve': return runServe(restArgs, restOptions);
    case 'snapshot': return runSnapshot(restArgs, restOptions);
    case 'console': return runConsole(restArgs, restOptions);
    case 'probe': return runProbe(restArgs, restOptions);
    case 'watch': return runWatch(restArgs, restOptions);
    case 'observe': return runObserve(restArgs, restOptions);
    default:
      return inconclusiveEnvelope('run', `未知 run 动作: ${action}`, ['可用：serve | snapshot | console | probe | watch | observe']);
  }
}
