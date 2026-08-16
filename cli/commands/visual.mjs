// ===== pdeck baseline / visual-test：视觉回归 =====
// baseline：截取基准截图（.pdeck/baselines/<name>.png）
// visual-test：截当前画面并与基准做像素级比对（浏览器解码，阈值/容差可调）
// 剧本驱动模式（--script）：先按 playtest 剧本驱动到目标状态（--at-step 截到第 N 步），
// 再截图/比对——视觉回归不再只能覆盖 URL 入口态（标题屏），游戏内状态同样可基准化。
// 无 --script 时保持原语义：静态服务 dist 产物后截入口态。
// 前置：项目有 dist（无 --url 且无 --script 时），或提供 --url / --script。

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { detectProject } from '../lib/phaser-project.mjs';
import { startStaticServer, stopStaticServer } from '../lib/static-server.mjs';
import { launchHeadless, openPage, sleep } from '../lib/browser.mjs';
import { pixelDiff } from '../lib/visual-diff.mjs';
import { envelope, fact, inconclusiveEnvelope } from '../result-envelope.mjs';
import { loadPlaytestScript, driveSteps, autoServerLifecycle, stopAutoServer } from './run.mjs';

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,60}$/;

// 基线健康审计：内容哈希完全相同的基线互为副本（假的丰富度——一张图换个名字不产生新覆盖）。
// 返回重复组列表，如 [['a','b'], ['c','d','e']]；无重复返回 []。
export function baselineDuplicateGroups(baselineDir) {
  if (!existsSync(baselineDir)) return [];
  const byHash = new Map();
  for (const name of readdirSync(baselineDir).filter((f) => f.endsWith('.png')).sort()) {
    try {
      const hash = createHash('sha256').update(readFileSync(join(baselineDir, name))).digest('hex');
      const group = byHash.get(hash) ?? [];
      group.push(name.replace(/\.png$/, ''));
      byHash.set(hash, group);
    } catch { /* 不可读文件跳过 */ }
  }
  return [...byHash.values()].filter((group) => group.length > 1);
}

function duplicateWarning(root, name) {
  const groups = baselineDuplicateGroups(join(root, '.pdeck', 'baselines'));
  const hit = groups.find((group) => group.includes(name));
  if (!hit) return null;
  return {
    facts: [fact('baseline_duplicate', 'visual-test', `基线 ${name} 与 ${hit.filter((n) => n !== name).join('、')} 内容完全相同（互为副本，未产生新覆盖）`, { actual: { group: hit } })],
    nextSteps: ['用不同状态分别采集基线（副本可删除）；游戏内状态用 --script 剧本驱动采集'],
  };
}

async function captureShot(url, outPath, viewport) {
  const launched = await launchHeadless();
  if (!launched.ok) return { error: launched.error };
  try {
    const { page, pageErrors } = await openPage(launched.browser, url, viewport);
    await sleep(2000);
    await page.screenshot({ path: outPath });
    return { error: null, pageErrors };
  } catch (error) {
    return { error: `截图失败: ${error.message}` };
  } finally {
    await launched.browser.close().catch(() => {});
  }
}

async function resolveTargetUrl(project, url) {
  if (url) return { url, server: null };
  const proj = detectProject(project ?? process.cwd());
  if (!proj.found) return { error: `不是可识别的 Phaser 项目: ${proj.reason}` };
  const distIndex = join(proj.root, 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    return { error: '无 --url 且 dist/index.html 不存在——先 npm run build、提供运行中的 URL，或用 --script 剧本驱动（走 dev server）' };
  }
  const server = await startStaticServer(join(proj.root, 'dist'));
  if (!server.server) return { error: server.error };
  return { url: server.url, server: server.server };
}

// 剧本驱动到目标状态：起服务（或用 --url）→ 开页 → 执行前缀步骤 → 保留页面待截图/比对。
// 返回 { launched, page, driven, stopRoot, meta } 或 { envelope }（失败信封，调用方直接返回）。
async function driveToState(options, viewport) {
  const { project, url, port, script, 'at-step': rawAtStep } = options;
  const loaded = loadPlaytestScript(script);
  if (loaded.error) return { envelope: inconclusiveEnvelope('visual', loaded.error, ['pdeck help run 查看剧本契约']) };
  const { name, steps } = loaded.script;
  let ranSteps = steps.length;
  if (rawAtStep !== undefined) {
    const n = Number(rawAtStep);
    if (!Number.isInteger(n) || n < 1 || n > steps.length) {
      return { envelope: inconclusiveEnvelope('visual', `--at-step 需为 1..${steps.length} 的整数（剧本 "${name}" 共 ${steps.length} 步）`) };
    }
    ranSteps = n;
  }

  let targetUrl = url ?? null;
  let stopRoot = null;
  let lifecycleNote = null;
  if (!targetUrl) {
    const auto = await autoServerLifecycle(project, port);
    if (auto.error) {
      return { envelope: auto.envelope ?? inconclusiveEnvelope('visual', auto.error, auto.hint ?? ['或 --url 直连运行中的页面']) };
    }
    targetUrl = auto.url;
    lifecycleNote = auto.note;
    if (auto.stopNeeded) stopRoot = auto.root;
  }
  const launched = await launchHeadless();
  if (!launched.ok) {
    if (stopRoot) await stopAutoServer(stopRoot, port);
    return { envelope: inconclusiveEnvelope('visual', launched.error, ['安装系统 Chrome/Edge，或 cd 工具目录 npm install（playwright-core）']) };
  }
  try {
    const { page, consoleErrors, pageErrors } = await openPage(launched.browser, targetUrl, viewport);
    const proj = detectProject(project ?? process.cwd());
    const capturesDir = join(proj.found ? proj.root : process.cwd(), '.pdeck', 'captures');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const driven = await driveSteps(page, steps.slice(0, ranSteps), { capturesDir, stamp, consoleErrors, pageErrors });
    await sleep(400); // 最后一次输入后的画面稳定
    return {
      launched, page, driven, stopRoot, port,
      meta: { scriptName: name, ranSteps, totalSteps: steps.length, url: targetUrl, lifecycleNote },
    };
  } catch (error) {
    await launched.browser.close().catch(() => {});
    if (stopRoot) await stopAutoServer(stopRoot, port);
    return { envelope: inconclusiveEnvelope('visual', `剧本驱动失败: ${error.message}`) };
  }
}

function scriptFacts(driven, meta) {
  const facts = [fact('script_prefix', 'visual', `剧本 "${meta.scriptName}" 驱动前 ${meta.ranSteps}/${meta.totalSteps} 步到达目标状态`)];
  if (meta.lifecycleNote) facts.push(fact('lifecycle', 'visual', meta.lifecycleNote));
  facts.push(...driven.facts.slice(0, 18));
  return facts;
}

export async function baseline(args, options) {
  const name = args[0];
  if (!name || !NAME_PATTERN.test(name)) {
    return inconclusiveEnvelope('baseline', `基准名需匹配 ${NAME_PATTERN}（收到: ${name ?? '无'}）`);
  }
  const { project, url, viewport: viewportStr = '1280x800' } = options;
  const [vw, vh] = viewportStr.split('x').map(Number);
  const viewport = { width: Number.isFinite(vw) ? vw : 1280, height: Number.isFinite(vh) ? vh : 800 };
  const proj = detectProject(project ?? process.cwd());

  if (options.script) {
    const state = await driveToState(options, viewport);
    if (state.envelope) return state.envelope;
    try {
      const facts = scriptFacts(state.driven, state.meta);
      if (state.driven.failed) {
        return envelope('FAILED', `剧本未到达目标状态，基线未保存：${state.driven.failed}`, {
          kind: 'baseline', decisiveStage: 'baseline', facts,
          nextSteps: ['根据 expect_failed/step_error 步骤号修剧本，或 --at-step 选更早的稳定步骤'],
        });
      }
      const baselineDir = join(proj.found ? proj.root : '.', '.pdeck', 'baselines');
      mkdirSync(baselineDir, { recursive: true });
      const outPath = join(baselineDir, `${name}.png`);
      await state.page.screenshot({ path: outPath });
      const dup = duplicateWarning(proj.found ? proj.root : '.', name);
      return envelope('PASSED', `视觉基线已保存: ${name}（剧本 "${state.meta.scriptName}" 驱动至第 ${state.meta.ranSteps} 步）`, {
        kind: 'baseline',
        facts: [...facts, fact('baseline_saved', 'baseline', outPath, { actual: { viewport: `${viewport.width}x${viewport.height}`, url: state.meta.url } }), ...(dup?.facts ?? [])],
        artifacts: [...state.driven.artifacts, outPath],
        nextSteps: [`pdeck visual-test ${name} --script <同一剧本> 比对同状态画面`, ...(dup?.nextSteps ?? [])],
      });
    } finally {
      await state.launched.browser.close().catch(() => {});
      if (state.stopRoot) await stopAutoServer(state.stopRoot, state.port);
    }
  }

  const target = await resolveTargetUrl(project, url);
  if (target.error) return inconclusiveEnvelope('baseline', target.error);
  try {
    const baselineDir = join(proj.found ? proj.root : '.', '.pdeck', 'baselines');
    mkdirSync(baselineDir, { recursive: true });
    const outPath = join(baselineDir, `${name}.png`);
    const shot = await captureShot(target.url, outPath, viewport);
    if (shot.error) return inconclusiveEnvelope('baseline', shot.error);
    if (shot.pageErrors.length) {
      return envelope('FAILED', '截图完成但页面存在未捕获异常（基线可能不可靠）', {
        kind: 'baseline',
        facts: [fact('page_errors', 'baseline', `${shot.pageErrors.length} 条页面异常`, { actual: shot.pageErrors.slice(0, 6) })],
        artifacts: [outPath],
      });
    }
    return envelope('PASSED', `视觉基线已保存: ${name}`, {
      kind: 'baseline',
      facts: [fact('baseline_saved', 'baseline', outPath, { actual: { viewport: `${viewport.width}x${viewport.height}`, url: target.url } })],
      artifacts: [outPath],
      nextSteps: [`pdeck visual-test ${name} 随时与当前画面比对；游戏内状态加 --script 剧本驱动采集`],
    });
  } finally {
    await stopStaticServer(target.server);
  }
}

export async function visualTest(args, options) {
  const name = args[0];
  if (!name || !NAME_PATTERN.test(name)) {
    return inconclusiveEnvelope('visual-test', `基准名需匹配 ${NAME_PATTERN}（收到: ${name ?? '无'}）`);
  }
  const { project, url, viewport: viewportStr = '1280x800', tolerance = 0.02, threshold = 16 } = options;
  const [vw, vh] = viewportStr.split('x').map(Number);
  const viewport = { width: Number.isFinite(vw) ? vw : 1280, height: Number.isFinite(vh) ? vh : 800 };
  const proj = detectProject(project ?? process.cwd());
  const root = proj.found ? proj.root : (project ?? process.cwd());
  const baselinePath = join(root, '.pdeck', 'baselines', `${name}.png`);
  if (!existsSync(baselinePath)) {
    return inconclusiveEnvelope('visual-test', `基准不存在: ${name}`, [`先 pdeck baseline ${name} 生成基准${options.script ? '（建议同一剧本采集，保证状态一致）' : ''}`]);
  }
  const dup = duplicateWarning(root, name);

  if (options.script) {
    const state = await driveToState(options, viewport);
    if (state.envelope) return state.envelope;
    try {
      const facts = scriptFacts(state.driven, state.meta);
      if (state.driven.failed) {
        return envelope('FAILED', `剧本未到达基准采集时的状态，未比对：${state.driven.failed}`, {
          kind: 'visual-test', decisiveStage: 'visual',
          facts: [...facts, ...(dup?.facts ?? [])],
          nextSteps: ['根据 expect_failed/step_error 步骤号修剧本（基线与比对需用同一剧本、同一 --at-step）'],
        });
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const capturesDir = join(root, '.pdeck', 'captures');
      mkdirSync(capturesDir, { recursive: true });
      const currentPath = join(capturesDir, `visual-${name}-${stamp}.png`);
      await state.page.screenshot({ path: currentPath });
      const diff = await pixelDiff(baselinePath, currentPath, { threshold, viewport });
      if (!diff.ok) return inconclusiveEnvelope('visual-test', diff.error);
      if (diff.mismatch) {
        return envelope('FAILED', `画面尺寸不一致（${diff.sizeA.join('x')} vs ${diff.sizeB.join('x')}）`, {
          kind: 'visual-test', decisiveStage: 'visual',
          facts: [fact('size_mismatch', 'visual-test', '基准与当前截图分辨率不同', { expected: diff.sizeA, actual: diff.sizeB }), ...facts],
          artifacts: [currentPath, baselinePath],
        });
      }
      const pct = (diff.ratio * 100).toFixed(2);
      const passed = diff.ratio <= tolerance;
      return envelope(passed ? 'PASSED' : 'FAILED', passed
        ? `视觉回归通过（剧本态差异 ${pct}% ≤ 容差 ${(tolerance * 100).toFixed(2)}%）`
        : `视觉回归失败（剧本态差异 ${pct}% > 容差 ${(tolerance * 100).toFixed(2)}%）`, {
        kind: 'visual-test',
        decisiveStage: 'visual',
        facts: [
          fact(passed ? 'visual_within_tolerance' : 'visual_mismatch', 'visual-test',
            `差异像素 ${diff.changed}/${diff.total}（${pct}%）`, {
              actual: { ratio: Number(diff.ratio.toFixed(4)), changed: diff.changed, total: diff.total, threshold },
              expected: { tolerance: Number(tolerance) },
            }),
          ...facts,
          ...(dup?.facts ?? []),
        ],
        artifacts: [currentPath, baselinePath, ...state.driven.artifacts],
        nextSteps: passed
          ? [...(dup?.nextSteps ?? [])]
          : ['确认是预期改动时重新 pdeck baseline <name> --script <同一剧本> 更新基线；动态画面（战斗/粒子）可适当上调 --tolerance', ...(dup?.nextSteps ?? [])],
      });
    } finally {
      await state.launched.browser.close().catch(() => {});
      if (state.stopRoot) await stopAutoServer(state.stopRoot, state.port);
    }
  }

  const target = await resolveTargetUrl(project, url);
  if (target.error) return inconclusiveEnvelope('visual-test', target.error);
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const capturesDir = join(root, '.pdeck', 'captures');
    mkdirSync(capturesDir, { recursive: true });
    const currentPath = join(capturesDir, `visual-${name}-${stamp}.png`);
    const shot = await captureShot(target.url, currentPath, viewport);
    if (shot.error) return inconclusiveEnvelope('visual-test', shot.error);
    if (shot.pageErrors.length) {
      return envelope('FAILED', '截图完成但页面存在未捕获异常（比对无意义）', {
        kind: 'visual-test',
        facts: [fact('page_errors', 'visual-test', `${shot.pageErrors.length} 条页面异常`, { actual: shot.pageErrors.slice(0, 6) })],
        artifacts: [currentPath],
      });
    }
    const diff = await pixelDiff(baselinePath, currentPath, { threshold, viewport });
    if (!diff.ok) return inconclusiveEnvelope('visual-test', diff.error);
    if (diff.mismatch) {
      return envelope('FAILED', `画面尺寸不一致（${diff.sizeA.join('x')} vs ${diff.sizeB.join('x')}）`, {
        kind: 'visual-test',
        decisiveStage: 'visual',
        facts: [
          fact('size_mismatch', 'visual-test', '基准与当前截图分辨率不同', {
            expected: diff.sizeA, actual: diff.sizeB,
          }),
        ],
        artifacts: [currentPath, baselinePath],
      });
    }
    const pct = (diff.ratio * 100).toFixed(2);
    const passed = diff.ratio <= tolerance;
    return envelope(passed ? 'PASSED' : 'FAILED', passed
      ? `视觉回归通过（差异 ${pct}% ≤ 容差 ${(tolerance * 100).toFixed(2)}%）`
      : `视觉回归失败（差异 ${pct}% > 容差 ${(tolerance * 100).toFixed(2)}%）`, {
      kind: 'visual-test',
      decisiveStage: 'visual',
      facts: [
        fact(passed ? 'visual_within_tolerance' : 'visual_mismatch', 'visual-test',
          `差异像素 ${diff.changed}/${diff.total}（${pct}%）`, {
            actual: { ratio: Number(diff.ratio.toFixed(4)), changed: diff.changed, total: diff.total, threshold },
            expected: { tolerance: Number(tolerance) },
          }),
        ...(dup?.facts ?? []),
      ],
      artifacts: [currentPath, baselinePath],
      nextSteps: passed
        ? [...(dup?.nextSteps ?? [])]
        : ['检查当前截图与基线差异；确认是预期改动时重新执行 pdeck baseline <name> 更新基线', ...(dup?.nextSteps ?? [])],
    });
  } finally {
    await stopStaticServer(target.server);
  }
}
