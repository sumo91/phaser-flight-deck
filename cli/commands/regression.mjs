// ===== pdeck regression：全量回归组合命令（R3）=====
// doctor → check → verify → simulate → visual-test 串行执行，聚合成一份有界报告，
// 并落盘 .pdeck/reports/regression-<stamp>.json 与 .md。
// 缺失前置的阶段（无模拟契约/无视觉基线）如实记为 INCONCLUSIVE 跳过，不伪造。

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectProject } from '../lib/phaser-project.mjs';
import { doctor } from './doctor.mjs';
import { check } from './check.mjs';
import { verify } from './verify.mjs';
import { simulate } from './simulate.mjs';
import { visualTest } from './visual.mjs';
import { envelope, fact, inconclusiveEnvelope } from '../result-envelope.mjs';

export async function regression(args, options) {
  const startTime = Date.now();
  const { project, timeout = 600 } = options;
  const proj = detectProject(project ?? process.cwd());
  if (!proj.found) return inconclusiveEnvelope('regression', `不是可识别的 Phaser 项目: ${proj.reason}`);
  const root = proj.root;

  const stages = [];
  const stage = (name, env) => {
    stages.push({ name, verdict: env.verdict, summary: env.summary, decisiveStage: env.decisiveStage ?? null });
    return env;
  };

  stage('doctor', await doctor([], { project: root }));
  stage('check', check([], { project: root }));
  stage('verify', await verify([], { project: root, timeout }));

  // simulate：需契约 + 剖面；缺失如实跳过；时长取剖面记录值（避免与剖面生成时长不一致的假失败）
  const hasHarness = existsSync(join(root, 'test', 'simulate.mjs')) || existsSync(join(root, 'test', 'simulate.ts'));
  const hasProfile = existsSync(join(root, '.pdeck', 'simulate.json'));
  if (hasHarness && hasProfile) {
    let profileHours = 48;
    try {
      const profile = JSON.parse(readFileSync(join(root, '.pdeck', 'simulate.json'), 'utf8'));
      if (Number.isFinite(profile.hours)) profileHours = profile.hours;
    } catch { /* 损坏剖面按默认 */ }
    stage('simulate', await simulate([], { project: root, hours: profileHours, timeout }));
  } else {
    stages.push({ name: 'simulate', verdict: 'INCONCLUSIVE', summary: '跳过：缺少模拟契约或剖面（pdeck simulate-profile 生成）', decisiveStage: null });
  }

  // visual-test：取 .pdeck/baselines 下最新基线；无基线如实跳过
  let baselineName = null;
  try {
    const files = readdirSync(join(root, '.pdeck', 'baselines')).filter((f) => f.endsWith('.png')).sort();
    if (files.length) baselineName = files[files.length - 1].replace(/\.png$/, '');
  } catch { /* 无基线目录 */ }
  if (baselineName) {
    stage('visual', await visualTest([baselineName], { project: root, tolerance: 0.02 }));
  } else {
    stages.push({ name: 'visual', verdict: 'INCONCLUSIVE', summary: '跳过：无视觉基线（pdeck baseline <name> 建立）', decisiveStage: null });
  }

  // 聚合裁决
  const failed = stages.filter((s) => s.verdict === 'FAILED');
  const incomplete = stages.filter((s) => s.verdict === 'INCONCLUSIVE');
  const verdict = failed.length ? 'FAILED' : incomplete.length ? 'INCONCLUSIVE' : 'PASSED';
  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

  const facts = stages.map((s) => fact(
    s.verdict === 'PASSED' ? 'stage_passed' : s.verdict === 'FAILED' ? 'stage_failed' : 'stage_skipped',
    `regression.${s.name}`,
    `${s.name}: ${s.verdict}${s.decisiveStage && s.verdict === 'FAILED' ? ` @ ${s.decisiveStage}` : ''} — ${s.summary}`,
  ));

  // 报告落盘（json + markdown）
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportsDir = join(root, '.pdeck', 'reports');
  let reportJson = null;
  let reportMd = null;
  try {
    mkdirSync(reportsDir, { recursive: true });
    reportJson = join(reportsDir, `regression-${stamp}.json`);
    writeFileSync(reportJson, JSON.stringify({ timestamp: new Date().toISOString(), verdict, elapsedSeconds, stages, facts }, null, 2));
    reportMd = join(reportsDir, `regression-${stamp}.md`);
    const rows = stages.map((s) => `| ${s.name} | ${s.verdict}${s.decisiveStage && s.verdict === 'FAILED' ? ` @ ${s.decisiveStage}` : ''} | ${s.summary} |`).join('\n');
    writeFileSync(reportMd, `# 全量回归报告\n\n时间: ${new Date().toISOString()} · 总耗时 ${elapsedSeconds}s · 裁决: **${verdict}**\n\n| 阶段 | 裁决 | 摘要 |\n|---|---|---|\n${rows}\n`);
  } catch { /* 报告写入失败不影响裁决 */ }

  const summary = verdict === 'FAILED'
    ? `回归失败于 ${failed.map((s) => s.name).join('/')}（${elapsedSeconds}s）`
    : verdict === 'INCONCLUSIVE'
      ? `回归不完整：${incomplete.map((s) => s.name).join('/')} 缺失前置（${elapsedSeconds}s）`
      : `全量回归通过（${elapsedSeconds}s）`;

  return envelope(verdict, summary, {
    kind: 'regression',
    decisiveStage: failed[0]?.name,
    facts,
    artifacts: [reportJson, reportMd].filter(Boolean),
    reportPath: reportJson,
    nextSteps: verdict === 'FAILED'
      ? ['根据 decisive 阶段修复后重跑 pdeck regression']
      : verdict === 'INCONCLUSIVE'
        ? ['补齐缺失阶段前置：pdeck baseline <name> 建视觉基线；pdeck simulate-profile 建模拟剖面']
        : [`回归报告: ${reportMd}`],
  });
}
