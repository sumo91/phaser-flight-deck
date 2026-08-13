// ===== pdeck baseline / visual-test：视觉回归 =====
// baseline：截取基准截图（.pdeck/baselines/<name>.png）
// visual-test：截当前画面并与基准做像素级比对（浏览器解码，阈值/容差可调）
// 前置：项目有 dist（无 --url 时），或提供 --url 指向运行中的页面。

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectProject } from '../lib/phaser-project.mjs';
import { startStaticServer, stopStaticServer } from '../lib/static-server.mjs';
import { launchHeadless, openPage, sleep } from '../lib/browser.mjs';
import { pixelDiff } from '../lib/visual-diff.mjs';
import { envelope, fact, inconclusiveEnvelope } from '../result-envelope.mjs';

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,60}$/;

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
    return { error: '无 --url 且 dist/index.html 不存在——先 npm run build 或提供运行中的 URL' };
  }
  const server = await startStaticServer(join(proj.root, 'dist'));
  if (!server.server) return { error: server.error };
  return { url: server.url, server: server.server };
}

export async function baseline(args, options) {
  const name = args[0];
  if (!name || !NAME_PATTERN.test(name)) {
    return inconclusiveEnvelope('baseline', `基准名需匹配 ${NAME_PATTERN}（收到: ${name ?? '无'}）`);
  }
  const { project, url, viewport: viewportStr = '1280x800' } = options;
  const [vw, vh] = viewportStr.split('x').map(Number);
  const viewport = { width: Number.isFinite(vw) ? vw : 1280, height: Number.isFinite(vh) ? vh : 800 };
  const target = await resolveTargetUrl(project, url);
  if (target.error) return inconclusiveEnvelope('baseline', target.error);
  try {
    const proj = detectProject(project ?? process.cwd());
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
      nextSteps: [`pdeck visual-test ${name} 随时与当前画面比对`],
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
    return inconclusiveEnvelope('visual-test', `基准不存在: ${name}`, [`先 pdeck baseline ${name} 生成基准`]);
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
      ],
      artifacts: [currentPath, baselinePath],
      nextSteps: passed
        ? []
        : ['检查当前截图与基线差异；确认是预期改动时重新执行 pdeck baseline <name> 更新基线'],
    });
  } finally {
    await stopStaticServer(target.server);
  }
}
