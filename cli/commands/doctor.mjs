// ===== pdeck doctor =====
import { detectProject, isolationChecks } from '../lib/phaser-project.mjs';
import { registryTimeline, quietPeriodDays } from '../lib/registry-lookup.mjs';
import { envelope, fact, inconclusiveEnvelope } from '../result-envelope.mjs';

export async function doctor(args, options) {
  const { project, offline = false, severity = 'warn', timeout = 30 } = options;
  const proj = detectProject(project ?? process.cwd());

  if (!proj.found) {
    return inconclusiveEnvelope('doctor', `不是可识别的 Phaser 项目: ${proj.reason}`, [
      '在含 phaser 依赖的 package.json 目录下运行，或使用 --project 指定路径',
    ]);
  }

  const facts = [];
  facts.push(fact('project', 'doctor', 'Phaser 项目已识别', { actual: { root: proj.root } }));
  facts.push(fact('dependency', 'doctor', 'package.json 声明', {
    actual: { declared: proj.phaserDeclared ?? '(无声明，仅 node_modules 存在)', installed: proj.phaserInstalled ?? '(未安装)' },
  }));

  // 引擎版本对照（离线容忍）
  let fresh = null;
  if (!offline) {
    const timeline = await registryTimeline('phaser', Math.min(timeout, 8) * 1000);
    if (timeline.ok) {
      const behind = proj.phaserInstalled && timeline.latest && proj.phaserInstalled !== timeline.latest;
      const quiet = quietPeriodDays(timeline);
      fresh = { latest: timeline.latest, behind, quietDays: quiet };
      facts.push(fact(behind ? 'version_behind' : 'version_current', 'doctor',
        behind ? `安装版本落后于 registry latest` : '安装版本与 registry latest 一致', {
          actual: { installed: proj.phaserInstalled, latest: timeline.latest },
        }));
      if (quiet !== null) {
        facts.push(fact(quiet >= 14 ? 'release_quiet' : 'release_active', 'doctor',
          quiet >= 14 ? `引擎已进入发布静默期（${quiet} 天无新版本）——不影响稳定性，但别再假设官方持续更新` : `引擎近期活跃（${quiet} 天内有新版本）`,
          { actual: { quietDays: quiet, lastModified: timeline.modified } }));
      }
    } else {
      facts.push(fact('registry_unavailable', 'doctor', `registry 查询不可用: ${timeline.error}`, {
        actual: { installed: proj.phaserInstalled },
      }));
    }
  } else {
    facts.push(fact('registry_skipped', 'doctor', '--offline：跳过 registry 对照', {
      actual: { installed: proj.phaserInstalled },
    }));
  }

  // 工具链
  const tc = proj.toolchain;
  const hasBundler = Boolean(tc.vite || tc.webpack || tc.parcel);
  facts.push(fact(hasBundler ? 'toolchain_ok' : 'toolchain_missing', 'doctor',
    hasBundler ? '已检测到打包器' : '未检测到打包器配置（vite/webpack/parcel）——纯浏览器脚本项目除外', {
      actual: { vite: Boolean(tc.vite), webpack: Boolean(tc.webpack), parcel: Boolean(tc.parcel), typescript: Boolean(tc.typescript) },
    }));

  // 架构隔离（核心逻辑零 Phaser 依赖约定）
  const iso = isolationChecks(proj.root);
  for (const entry of iso) {
    if (entry.importingPhaser.length) {
      facts.push(fact('isolation_violation', 'doctor',
        `${entry.dir} 目录存在 phaser 导入（破坏"核心逻辑可无头模拟"约定）`, {
          actual: entry.importingPhaser.slice(0, 8),
        }));
    } else {
      facts.push(fact('isolation_ok', 'doctor', `${entry.dir} 未导入 phaser（可在 Node 无头模拟）`));
    }
  }

  // 无隔离目录时提示约定
  if (!iso.length) {
    facts.push(fact('isolation_none', 'doctor', '未发现 src/core 目录——若项目有纯逻辑层，建议按约定隔离（见 phaser4-flight-deck skill）'));
  }

  const blocking = facts.some((f) => f.classification === 'version_behind' && severity === 'error');
  const verdict = blocking ? 'FAILED' : 'PASSED';

  return envelope(verdict, blocking
    ? '版本落后且阈值设为 error'
    : `Phaser 项目健康检查完成（${facts.length} 项事实）`, {
    kind: 'doctor',
    decisiveStage: 'doctor',
    facts,
    nextSteps: [
      ...(fresh?.behind ? [`npm install phaser@${fresh.latest} 或确认当前版本为有意钉版`] : []),
      '运行 pdeck check 扫描 v4 API 使用问题',
      '运行 pdeck api 查询 Phaser API 事实',
    ],
  });
}
