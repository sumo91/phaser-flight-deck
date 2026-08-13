// ===== pdeck simulate / simulate-profile：平衡模拟门 =====
// 契约：项目提供 test/simulate.mjs（.ts 亦可），读环境变量 SIM_HOURS，
// 模拟挂机 N 小时，向 stdout 输出一行 JSON 报告：
//   {"hours":48,"level":293,"region":8,"regionName":"天山雪域","realm":9,"totalKills":12345,"gold":1234567}
// 剖面 .pdeck/simulate.json 声明期望区间（band），simulate check 越界即 FAILED——平衡回归门。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectProject } from '../lib/phaser-project.mjs';
import { runProcess } from '../lib/process.mjs';
import { envelope, fact, inconclusiveEnvelope } from '../result-envelope.mjs';

const PROFILE_PATH = '.pdeck/simulate.json';

function harnessPath(root) {
  const candidates = [join(root, 'test', 'simulate.mjs'), join(root, 'test', 'simulate.ts')];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function tsxPath(root) {
  const candidates = [
    join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    join(root, 'node_modules', '.bin', 'tsx'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function parseReport(stdout) {
  // 取 stdout 最后一行的 JSON（允许 harness 打印其它日志）
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const data = JSON.parse(lines[i]);
      if (data && typeof data === 'object' && typeof data.hours === 'number') return data;
    } catch { /* 继续向上找 */ }
  }
  return null;
}

function band(value, pct = 0.3) {
  return { min: Math.floor(value * (1 - pct)), max: Math.ceil(value * (1 + pct)) };
}

function checkBands(report, profile) {
  const facts = [];
  let failed = false;
  for (const key of ['level', 'region', 'realm', 'totalKills']) {
    const bands = profile.bands?.[key];
    if (!bands || report[key] === undefined) continue;
    const value = Number(report[key]);
    const ok = value >= bands.min && value <= bands.max;
    if (!ok) failed = true;
    facts.push(fact(ok ? 'band_ok' : 'band_violation', 'simulate',
      `${key}: ${value} ${ok ? '在' : '越出'}区间 [${bands.min}, ${bands.max}]`, {
        actual: { value }, expected: bands,
      }));
  }
  return { facts, failed };
}

export async function simulate(args, options) {
  const { project, hours = 48, timeout = 600 } = options;
  const proj = detectProject(project ?? process.cwd());
  if (!proj.found) return inconclusiveEnvelope('simulate', `不是可识别的 Phaser 项目: ${proj.reason}`);
  const root = proj.root;
  const harness = harnessPath(root);
  if (!harness) {
    return inconclusiveEnvelope('simulate', '未找到模拟契约 test/simulate.mjs（或 .ts）', [
      '按契约编写：读 SIM_HOURS 环境变量，模拟挂机后向 stdout 输出一行 JSON 报告（见 pdeck describe simulate）',
    ]);
  }
  const profilePath = join(root, PROFILE_PATH);
  if (!existsSync(profilePath)) {
    return inconclusiveEnvelope('simulate', '无模拟剖面（.pdeck/simulate.json）', [
      '先 pdeck simulate-profile 生成期望区间，再做平衡回归检查',
    ]);
  }
  let profile;
  try {
    profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    return inconclusiveEnvelope('simulate', '剖面文件损坏，请重新 pdeck simulate-profile');
  }

  // 执行 harness
  let result;
  if (harness.endsWith('.ts')) {
    const tsx = tsxPath(root);
    if (!tsx) return inconclusiveEnvelope('simulate', 'harness 为 .ts 但项目未安装 tsx（npm i -D tsx）');
    result = await runProcess(process.execPath, [tsx, harness], { cwd: root, env: { SIM_HOURS: String(hours) }, timeoutSeconds: Math.min(timeout, 900) });
  } else {
    result = await runProcess(process.execPath, [harness], { cwd: root, env: { SIM_HOURS: String(hours) }, timeoutSeconds: Math.min(timeout, 900) });
  }
  if (result.timedOut) {
    return envelope('FAILED', `模拟超时（${Math.min(timeout, 900)}s）`, {
      kind: 'simulate',
      facts: [fact('simulation_timeout', 'simulate', `SIM_HOURS=${hours}`)],
    });
  }
  if (result.spawnError) return inconclusiveEnvelope('simulate', `harness 无法运行: ${result.spawnError}`);
  const report = parseReport(result.stdout);
  if (!report) {
    return envelope('FAILED', 'harness 未输出合法 JSON 报告', {
      kind: 'simulate',
      facts: [
        fact('report_parse_failed', 'simulate', 'stdout 末尾无可解析 JSON（含 hours 字段）', {
          actual: { tail: (result.stdout + result.stderr).split('\n').filter(Boolean).slice(-5) },
        }),
      ],
      nextSteps: ['检查 harness 输出契约：最后一行须为 {"hours":N,...}'],
    });
  }
  if (result.code !== 0 && result.code !== null) {
    return envelope('FAILED', `harness 退出码 ${result.code}`, {
      kind: 'simulate',
      facts: [fact('harness_exit', 'simulate', `exit ${result.code}`, { actual: { stderr: result.stderr.slice(0, 300) } })],
    });
  }

  const { facts, failed } = checkBands(report, profile);
  const verdict = failed ? 'FAILED' : 'PASSED';
  return envelope(verdict, verdict === 'FAILED'
    ? `平衡模拟 ${hours}h 越出剖面区间——数值改动可能引入节奏回归`
    : `平衡模拟 ${hours}h 全部落在剖面区间内`, {
    kind: 'simulate',
    decisiveStage: 'simulate',
    facts: [
      fact('simulation_report', 'simulate', `模拟 ${report.hours}h 完成`, {
        actual: { level: report.level, region: report.region, regionName: report.regionName, realm: report.realm, totalKills: report.totalKills, gold: report.gold },
      }),
      ...facts,
    ],
    nextSteps: failed
      ? ['对比剖面区间定位越界维度；确认是有意调整时 pdeck simulate-profile 更新剖面']
      : ['数值改动后重跑 pdeck simulate 作为平衡回归门'],
  });
}

export async function simulateProfile(args, options) {
  const { project, hours = 48, timeout = 600 } = options;
  const proj = detectProject(project ?? process.cwd());
  if (!proj.found) return inconclusiveEnvelope('simulate-profile', `不是可识别的 Phaser 项目: ${proj.reason}`);
  const root = proj.root;
  const harness = harnessPath(root);
  if (!harness) return inconclusiveEnvelope('simulate-profile', '未找到模拟契约 test/simulate.mjs（或 .ts）');
  let result;
  if (harness.endsWith('.ts')) {
    const tsx = tsxPath(root);
    if (!tsx) return inconclusiveEnvelope('simulate-profile', 'harness 为 .ts 但项目未安装 tsx（npm i -D tsx）');
    result = await runProcess(process.execPath, [tsx, harness], { cwd: root, env: { SIM_HOURS: String(hours) }, timeoutSeconds: Math.min(timeout, 900) });
  } else {
    result = await runProcess(process.execPath, [harness], { cwd: root, env: { SIM_HOURS: String(hours) }, timeoutSeconds: Math.min(timeout, 900) });
  }
  if (result.timedOut) return envelope('FAILED', `模拟超时（${Math.min(timeout, 900)}s）`, { kind: 'simulate-profile', facts: [] });
  if (result.spawnError) return inconclusiveEnvelope('simulate-profile', `harness 无法运行: ${result.spawnError}`);
  const report = parseReport(result.stdout);
  if (!report) {
    return envelope('FAILED', 'harness 未输出合法 JSON 报告', {
      kind: 'simulate-profile',
      facts: [fact('report_parse_failed', 'simulate-profile', 'stdout 末尾无可解析 JSON')],
    });
  }
  const profile = {
    version: 1,
    hours: Number(report.hours),
    harness: 'test/simulate.mjs',
    generatedAt: new Date().toISOString(),
    bands: {
      level: band(report.level),
      region: band(report.region),
      realm: band(report.realm),
      totalKills: band(report.totalKills),
    },
  };
  mkdirSync(join(root, '.pdeck'), { recursive: true });
  writeFileSync(join(root, PROFILE_PATH), JSON.stringify(profile, null, 2));
  const bandsFlat = Object.fromEntries(Object.entries(profile.bands).map(([k, v]) => [k, `[${v.min}, ${v.max}]`]));
  return envelope('PASSED', `模拟剖面已生成（±30% 区间，可手调 .pdeck/simulate.json）`, {
    kind: 'simulate-profile',
    facts: [
      fact('profile_written', 'simulate-profile', `${PROFILE_PATH}`, {
        actual: { hours: profile.hours, bands: bandsFlat },
      }),
    ],
    nextSteps: ['pdeck simulate 执行平衡回归检查', '数值刻意调整后重新 pdeck simulate-profile 更新区间'],
  });
}
