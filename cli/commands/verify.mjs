// ===== pdeck verify：从窄到宽的验证阶梯 =====
// 阶梯：项目探测 → 版本一致性 → tsc → 生产构建 → 真实浏览器（canvas/控制台/输入） → 截图证据
// 缺失前置条件 → INCONCLUSIVE（不是失败）；阶梯上第一个硬失败为决定性阶段。
// 证据写入 <project>/.pdeck/captures 与 .pdeck/reports（generated-write 风险，由扩展确认门管理）。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectProject } from '../lib/phaser-project.mjs';
import { startStaticServer, stopStaticServer } from '../lib/static-server.mjs';
import { launchHeadless, openPage, sleep } from '../lib/browser.mjs';
import { splitErrors, collectBounded } from '../lib/console-filter.mjs';
import { envelope, fact, inconclusiveEnvelope } from '../result-envelope.mjs';

const STAGES = ['project', 'version', 'tsc', 'build', 'browser', 'input', 'capture'];
const EVIDENCE_RETENTION = 10; // 每类证据最多保留份数

function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const timeoutMs = (options.timeoutSeconds ?? 120) * 1000;
    // 仅 npm 批处理类命令需要 shell；node 直调绝对路径必须 shell:false（避免路径空格被 cmd 拆断）
    const useShell = Boolean(options.useShell ?? (process.platform === 'win32' && /npm(\.cmd)?$/i.test(command)));
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: useShell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
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
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 256 * 1024) { child.kill(); } });
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 256 * 1024) { child.kill(); } });
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

function tscPath(projectRoot) {
  const candidates = [
    join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    join(projectRoot, 'node_modules', '.bin', 'tsc'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

// 证据保留策略：每类只留最近 N 份（按文件名时间戳排序，只删本工具生成的 verify-*/snapshot-* 文件）
function pruneEvidence(dir, prefix, keep = EVIDENCE_RETENTION) {
  try {
    const files = readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .sort()
      .reverse();
    for (const name of files.slice(keep)) {
      try { unlinkSync(join(dir, name)); } catch { /* 忽略 */ }
    }
    return Math.max(0, files.length - keep);
  } catch {
    return 0;
  }
}

export function pruneEvidenceFiles(root) {
  const reportsDir = join(root, '.pdeck', 'reports');
  const capturesDir = join(root, '.pdeck', 'captures');
  let removed = 0;
  removed += pruneEvidence(reportsDir, 'verify-');
  removed += pruneEvidence(capturesDir, 'verify-');
  removed += pruneEvidence(capturesDir, 'snapshot-');
  return removed;
}

export async function verify(args, options) {
  const startTime = Date.now();
  const { project, timeout = 120, capture = true } = options;
  const proj = detectProject(project ?? process.cwd());
  if (!proj.found) {
    return inconclusiveEnvelope('verify', `不是可识别的 Phaser 项目: ${proj.reason}`, [
      '在含 phaser 依赖的 package.json 目录下运行，或使用 --project 指定路径',
    ]);
  }
  const root = proj.root;
  const facts = [];
  const stageFact = (classification, stage, summary, values) => facts.push(fact(classification, `verify.${stage}`, summary, values));
  const pdeckDir = join(root, '.pdeck');
  const capturesDir = join(pdeckDir, 'captures');
  const reportsDir = join(pdeckDir, 'reports');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifacts = [];
  let decisiveStage = null;
  let verdict = 'PASSED';

  const fail = (stage, summary, values, next) => {
    stageFact('verification_failed', stage, summary, values);
    verdict = 'FAILED';
    decisiveStage = stage;
    return true;
  };
  const inconclusive = (stage, summary, values, next) => {
    stageFact('precondition_missing', stage, summary, values);
    verdict = verdict === 'PASSED' ? 'INCONCLUSIVE' : verdict;
    decisiveStage = decisiveStage ?? stage;
    return true;
  };

  // 0. 项目探测
  stageFact('verified', 'project', 'Phaser 项目已识别', { actual: { root } });

  // 1. 版本一致性（声明 vs 安装）
  if (!proj.phaserInstalled) {
    inconclusive('version', 'node_modules/phaser 未安装——先 npm install', { actual: { declared: proj.phaserDeclared } });
  } else if (proj.phaserDeclared) {
    const declaredClean = String(proj.phaserDeclared).replace(/[\^~><= ]/g, '');
    if (declaredClean && !proj.phaserInstalled.startsWith(declaredClean.split('.')[0])) {
      fail('version', '声明版本与安装版本主版本不一致', {
        actual: { declared: proj.phaserDeclared, installed: proj.phaserInstalled },
        expected: 'package.json 声明与 node_modules 安装一致',
      });
    } else {
      stageFact('verified', 'version', '版本一致', { actual: { declared: proj.phaserDeclared, installed: proj.phaserInstalled } });
    }
  } else {
    stageFact('verified', 'version', '已安装（无声明）', { actual: { installed: proj.phaserInstalled } });
  }

  // 2. tsc --noEmit
  if (verdict === 'FAILED') {
    // 短路：后面的阶段不再执行，但记录跳过
    for (const stage of STAGES.slice(STAGES.indexOf(decisiveStage) + 1)) {
      stageFact('skipped', stage, '前置阶段失败，跳过');
    }
  } else {
    if (proj.toolchain.typescript) {
      const tsc = tscPath(root);
      if (!tsc) {
        inconclusive('tsc', 'tsconfig 存在但本地 typescript 未安装（npm install 后重试）');
      } else {
        const result = await runProcess(process.execPath, [tsc, '--noEmit'], { cwd: root, timeoutSeconds: Math.min(timeout, 120) });
        if (result.timedOut) fail('tsc', 'tsc 超时', { actual: {} });
        else if (result.spawnError) inconclusive('tsc', `tsc 无法运行: ${result.spawnError}`);
        else if (result.code !== 0) {
          const errors = (result.stdout + result.stderr).split('\n').filter((l) => l.includes('error TS')).slice(0, 6);
          fail('tsc', `类型检查失败（${errors.length} 处错误，截取前 6）`, { actual: errors }, ['修复类型错误后重跑 pdeck verify']);
        } else {
          stageFact('verified', 'tsc', 'tsc --noEmit 通过');
        }
      }
    } else {
      stageFact('skipped', 'tsc', '无 typescript 配置，跳过');
    }
  }

  // 3. 生产构建
  if (verdict === 'FAILED') {
    stageFact('skipped', 'build', '前置阶段失败，跳过');
  } else if (proj.scripts?.build) {
    const result = await runProcess(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, timeoutSeconds: Math.min(timeout, 180) });
    if (result.timedOut) fail('build', '构建超时');
    else if (result.spawnError) inconclusive('build', `npm 无法运行: ${result.spawnError}`);
    else if (result.code !== 0) {
      const tail = (result.stdout + result.stderr).split('\n').filter(Boolean).slice(-8);
      fail('build', `生产构建失败（exit ${result.code}）`, { actual: tail });
    } else {
      stageFact('verified', 'build', 'npm run build 成功');
    }
  } else {
    inconclusive('build', '未定义 build 脚本——纯脚本项目请用 pdeck run 观察开发页', { actual: { scripts: Object.keys(proj.scripts ?? {}) } });
  }

  // 4. 浏览器运行证据（dist 静态服务 + headless Chrome）
  if (verdict === 'FAILED') {
    stageFact('skipped', 'browser', '前置阶段失败，跳过');
  } else {
    const distDir = join(root, 'dist');
    if (!existsSync(join(distDir, 'index.html'))) {
      inconclusive('browser', 'dist/index.html 不存在——构建产物缺失', { actual: { distDir } });
    } else {
      const server = await startStaticServer(distDir);
      if (!server.server) {
        inconclusive('browser', server.error);
      } else {
        const launched = await launchHeadless();
        if (!launched.ok) {
          inconclusive('browser', `无头浏览器不可用: ${launched.error}`, {}, ['安装系统 Chrome/Edge，或 cd 工具目录 npm install（playwright-core）']);
          await stopStaticServer(server.server);
        } else {
          try {
            const { page, consoleErrors, pageErrors, consoleWarnings } = await openPage(launched.browser, server.url, { width: 1280, height: 800 });
            await sleep(2500); // 等首帧渲染
            const canvasInfo = await page.evaluate(() => {
              const canvases = Array.from(document.querySelectorAll('canvas'));
              return {
                count: canvases.length,
                dims: canvases.slice(0, 2).map((c) => ({ w: c.width, h: c.height })),
                bodyTextLen: document.body ? document.body.innerText.length : 0,
              };
            });
            const canvasOk = canvasInfo.count >= 1 && canvasInfo.dims.some((d) => d.w > 0 && d.h > 0);
            if (!canvasOk) {
              fail('browser', '未发现可见 Phaser canvas', { actual: canvasInfo });
            } else if (pageErrors.length) {
              fail('browser', `页面存在未捕获异常（${pageErrors.length} 条）`, { actual: collectBounded(pageErrors) });
            } else {
              const errors = splitErrors(consoleErrors);
              stageFact('verified', 'browser', `canvas ${canvasInfo.dims[0].w}×${canvasInfo.dims[0].h}，渲染正常`, {
                actual: { consoleErrors: errors.real.length, warnings: consoleWarnings.length, bodyTextLen: canvasInfo.bodyTextLen },
              });
              if (errors.real.length) {
                stageFact('console_errors', 'browser', `存在实质性控制台错误（${errors.real.length} 条，截取前 6）`, { actual: collectBounded(errors.real) });
              }
              if (errors.benign.length) {
                stageFact('benign_errors', 'browser', `良性资源 404 ${errors.benign.length} 条（favicon 等，不计入失败）`, { actual: collectBounded(errors.benign, 4) });
              }

              // 5. 输入可达性
              try {
                await page.evaluate(() => {
                  (window).__pdeckInputSeen = 0;
                  window.addEventListener('pointerdown', () => { (window).__pdeckInputSeen += 1; });
                  window.addEventListener('keydown', () => { (window).__pdeckInputSeen += 1; });
                });
                await page.mouse.click(320, 400);
                await page.keyboard.press('Space');
                await sleep(300);
                const inputSeen = await page.evaluate(() => (window).__pdeckInputSeen ?? 0);
                if (inputSeen > 0) {
                  stageFact('verified', 'input', `输入可达（pointerdown/keydown 收到 ${inputSeen} 次）`);
                } else {
                  stageFact('input_unreachable', 'input', '合成点击/按键未被页面接收', { actual: { seen: inputSeen } });
                }
              } catch (error) {
                stageFact('input_error', 'input', `输入探测异常: ${error.message}`);
              }

              // 6. 截图证据
              if (capture) {
                mkdirSync(capturesDir, { recursive: true });
                const shot = join(capturesDir, `verify-${stamp}.png`);
                await page.screenshot({ path: shot });
                artifacts.push(shot);
                stageFact('captured', 'capture', '截图证据已保存', { actual: { path: shot } });
              }
            }
          } catch (error) {
            fail('browser', `浏览器阶段异常: ${error.message}`, {});
          } finally {
            await launched.browser.close().catch(() => {});
            await stopStaticServer(server.server);
          }
        }
      }
    }
  }

  // 证据日志 + 保留策略
  let reportPath = null;
  let pruned = 0;
  try {
    mkdirSync(reportsDir, { recursive: true });
    reportPath = join(reportsDir, `verify-${stamp}.json`);
    writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), verdict, decisiveStage, stages: STAGES, facts, artifacts, elapsedMs: Date.now() - startTime }, null, 2));
    artifacts.push(reportPath);
    pruned = pruneEvidenceFiles(root);
  } catch { /* 证据写入失败不影响裁决 */ }

  // 历史摘要（最近 3 次）
  let recentLine = '';
  try {
    const recent = readdirSync(reportsDir)
      .filter((name) => name.startsWith('verify-') && name.endsWith('.json'))
      .sort().reverse().slice(1, 4)
      .map((name) => {
        try {
          const data = JSON.parse(readFileSync(join(reportsDir, name), 'utf8'));
          return `${data.verdict}${data.decisiveStage ? '@' + data.decisiveStage : ''}(${data.elapsedMs ? Math.round(data.elapsedMs / 1000) + 's' : '?'})`;
        } catch { return '?'; }
      });
    if (recent.length) recentLine = `最近验证: ${recent.join(' → ')}`;
  } catch { /* 无历史 */ }

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  const summary = verdict === 'FAILED'
    ? `验证失败于 ${decisiveStage} 阶段（${elapsedSeconds}s）`
    : verdict === 'INCONCLUSIVE'
      ? `验证不完整：${decisiveStage ?? '前置条件'} 缺失（${elapsedSeconds}s）`
      : `全部可运行阶段通过（${elapsedSeconds}s）`;

  return envelope(verdict, summary, {
    kind: 'verify',
    decisiveStage: decisiveStage ?? (verdict === 'PASSED' ? 'capture' : undefined),
    facts: facts.slice(0, 24),
    artifacts,
    reportPath,
    nextSteps: [
      ...(verdict === 'FAILED'
        ? ['根据 decisive 阶段 facts 修复后重跑 pdeck verify']
        : verdict === 'INCONCLUSIVE'
          ? ['补齐缺失前置条件（见 facts），或使用 pdeck run 观察开发页']
          : []),
      ...(recentLine ? [recentLine] : []),
      ...(pruned > 0 ? [`已按保留策略清理 ${pruned} 份过期证据`] : []),
      ...(verdict === 'PASSED' ? ['如需视觉回归: pdeck baseline <name> 建立基线，pdeck visual-test <name> 比对'] : []),
    ],
  });
}
