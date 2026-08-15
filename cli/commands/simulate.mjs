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

// 契约要点（内联到错误信息，不依赖外部入口）
const CONTRACT_HINT = [
  '契约：test/simulate.mjs|ts 读 SIM_HOURS 环境变量，模拟挂机后向 stdout 最后一行输出一行 JSON，',
  '例如 {"hours":48,"crops":123,"coins":456} —— 除 hours 外任何数值字段都会自动生成 band 区间。',
  '推荐 .ts（配合项目 tsx）：可正常 import 项目核心模块；.mjs 也可用，模块解析失败时会自动回退 tsx 重试。',
];

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

// 报告中的数值字段（除 hours 与 _ 前缀）——泛型契约：农场/战斗/经营游戏各自命名
function numericFields(report) {
  return Object.entries(report)
    .filter(([key, value]) => key !== 'hours' && !key.startsWith('_') && typeof value === 'number' && Number.isFinite(value))
    .map(([key]) => key);
}

function band(value, pct = 0.3) {
  return { min: Math.floor(value * (1 - pct)), max: Math.ceil(value * (1 + pct)) };
}

function checkBands(report, profile) {
  const facts = [];
  let failed = false;
  const bands = profile.bands ?? {};
  for (const key of Object.keys(bands)) {
    if (report[key] === undefined) continue;
    const value = Number(report[key]);
    const bounds = bands[key];
    if (!bounds || typeof bounds.min !== 'number') continue;
    const ok = value >= bounds.min && value <= bounds.max;
    if (!ok) failed = true;
    facts.push(fact(ok ? 'band_ok' : 'band_violation', 'simulate',
      `${key}: ${value} ${ok ? '在' : '越出'}区间 [${bounds.min}, ${bounds.max}]`, {
        actual: { value }, expected: bounds,
      }));
  }
  return { facts, failed };
}

// 执行 harness；.mjs 直跑失败且疑似模块解析问题时自动回退 tsx 重试
async function runHarness(root, harness, hours, timeout) {
  const env = { SIM_HOURS: String(hours) };
  const maxSeconds = Math.min(timeout, 900);
  if (harness.endsWith('.ts')) {
    const tsx = tsxPath(root);
    if (!tsx) return { result: null, fallback: null, error: 'harness 为 .ts 但项目未安装 tsx（npm i -D tsx）' };
    return { result: await runProcess(process.execPath, [tsx, harness], { cwd: root, env, timeoutSeconds: maxSeconds }), fallback: null, error: null };
  }
  let result = await runProcess(process.execPath, [harness], { cwd: root, env, timeoutSeconds: maxSeconds });
  const moduleNotFound = /Cannot find module|ERR_MODULE_NOT_FOUND|Cannot find package/i.test(result.stderr);
  if (result.code !== 0 && moduleNotFound) {
    const tsx = tsxPath(root);
    if (tsx) {
      const retried = await runProcess(process.execPath, [tsx, harness], { cwd: root, env, timeoutSeconds: maxSeconds });
      return { result: retried, fallback: `直跑 node 失败（模块解析错误），已自动回退 tsx 重试`, error: null };
    }
    return {
      result,
      fallback: null,
      error: 'harness 存在相对 import 但项目未安装 tsx——要么安装 tsx（npm i -D tsx），要么让 harness 自包含',
    };
  }
  return { result, fallback: null, error: null };
}

export async function simulate(args, options) {
  const { project, timeout = 600 } = options;
  const proj = detectProject(project ?? process.cwd());
  if (!proj.found) return inconclusiveEnvelope('simulate', `不是可识别的 Phaser 项目: ${proj.reason}`);
  const root = proj.root;
  const harness = harnessPath(root);
  if (!harness) {
    return inconclusiveEnvelope('simulate', '未找到模拟契约 test/simulate.mjs（或 .ts）', CONTRACT_HINT);
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
  // 时长优先级：显式 --hours > 剖面记录值 > 48——默认时长与剖面不一致会产生假失败（同 regression R3 规则）
  const hours = Number(options.hours ?? (Number.isFinite(Number(profile.hours)) ? profile.hours : 48));

  const { result, fallback, error } = await runHarness(root, harness, hours, timeout);
  if (error) return inconclusiveEnvelope('simulate', error, CONTRACT_HINT);
  if (result.timedOut) {
    return envelope('FAILED', `模拟超时（${Math.min(timeout, 900)}s）`, {
      kind: 'simulate',
      facts: [fact('simulation_timeout', 'simulate', `SIM_HOURS=${hours}`)],
    });
  }
  if (result.spawnError) return inconclusiveEnvelope('simulate', `harness 无法运行: ${result.spawnError}`);
  const report = parseReport(result.stdout);
  if (!report) {
    const tail = (result.stdout + result.stderr).split('\n').filter(Boolean).slice(-6).join(' ⏎ ').slice(0, 400);
    return envelope('FAILED', `harness 未输出合法 JSON 报告${fallback ? `（${fallback}）` : ''}——原始输出尾部: ${tail || '(空)'}`, {
      kind: 'simulate',
      facts: [
        fact('report_parse_failed', 'simulate', 'stdout 末尾无可解析 JSON（需含 hours 字段）', { actual: { tail } }),
      ],
      nextSteps: CONTRACT_HINT,
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
  const reportFields = Object.fromEntries(numericFields(report).map((key) => [key, report[key]]));
  return envelope(verdict, verdict === 'FAILED'
    ? `平衡模拟 ${hours}h 越出剖面区间——数值改动可能引入节奏回归`
    : `平衡模拟 ${hours}h 全部落在剖面区间内`, {
    kind: 'simulate',
    decisiveStage: 'simulate',
    facts: [
      ...(options.hours === undefined
        ? [fact('duration_source', 'simulate', `时长未显式指定，取剖面记录值 ${hours}h（--hours 可覆盖）`)]
        : []),
      fact('simulation_report', 'simulate', `模拟 ${report.hours}h 完成${fallback ? `（${fallback}）` : ''}`, {
        actual: reportFields,
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
  if (!harness) return inconclusiveEnvelope('simulate-profile', '未找到模拟契约 test/simulate.mjs（或 .ts）', CONTRACT_HINT);
  const { result, fallback, error } = await runHarness(root, harness, hours, timeout);
  if (error) return inconclusiveEnvelope('simulate-profile', error, CONTRACT_HINT);
  if (result.timedOut) return envelope('FAILED', `模拟超时（${Math.min(timeout, 900)}s）`, { kind: 'simulate-profile', facts: [] });
  if (result.spawnError) return inconclusiveEnvelope('simulate-profile', `harness 无法运行: ${result.spawnError}`);
  const report = parseReport(result.stdout);
  if (!report) {
    const tail = (result.stdout + result.stderr).split('\n').filter(Boolean).slice(-6).join(' ⏎ ').slice(0, 400);
    return envelope('FAILED', `harness 未输出合法 JSON 报告——原始输出尾部: ${tail || '(空)'}`, {
      kind: 'simulate-profile',
      facts: [fact('report_parse_failed', 'simulate-profile', 'stdout 末尾无可解析 JSON')],
      nextSteps: CONTRACT_HINT,
    });
  }
  // 泛型 band：报告中的所有数值字段（除 hours 与 _ 前缀）
  const bands = {};
  for (const key of numericFields(report)) {
    bands[key] = band(report[key]);
  }
  const profile = {
    version: 1,
    hours: Number(report.hours),
    harness: 'test/simulate.mjs',
    generatedAt: new Date().toISOString(),
    bands,
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
