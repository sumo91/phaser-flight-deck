// ===== pdeck init：保守脚手架 =====
// 原则（Phaser Project Toolkit）：写入前停手、默认 dry-run、绝不替你跑 npm install。
// 门：目标为空/仅含白名单文件才可写；已有 package.json 的目标拒绝。
// 模板：templates/project（Phaser 4.2.1 钉版 + core 零 Phaser 隔离 + 诊断场景 + 无头测试）。

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envelope, fact, inconclusiveEnvelope } from '../result-envelope.mjs';

const TEMPLATE_DIR = fileURLToPath(new URL('../../templates/project/', import.meta.url));
const ALLOWED_PREEXISTING = new Set(['.git', '.gitignore', 'README.md', 'LICENSE', '.pdeck']);

function collectTemplateFiles() {
  const files = [];
  const walk = (dir, base = '') => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = base ? `${base}/${entry}` : entry;
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full, rel);
      else files.push(rel);
    }
  };
  walk(TEMPLATE_DIR);
  return files;
}

export function init(args, options) {
  const { project, apply = false } = options;
  const target = resolve(project ?? process.cwd());

  if (!existsSync(target)) {
    return inconclusiveEnvelope('init', `目标目录不存在: ${target}`, ['先创建目录再运行 pdeck init']);
  }

  const existing = readdirSync(target);
  const blockers = existing.filter((entry) => !ALLOWED_PREEXISTING.has(entry));
  if (existing.includes('package.json')) {
    return inconclusiveEnvelope('init', '目标已存在 package.json——init 只面向新项目，拒绝写入', [
      '已有项目请使用 pdeck doctor / pdeck verify；如需迁移请保留原工具链手工适配',
    ]);
  }
  if (blockers.length) {
    return inconclusiveEnvelope('init', `目标目录含未识别文件（${blockers.slice(0, 5).join(', ')}）——停止于写入前`, [
      '清空目录、或仅保留 .git/README/LICENSE 后重试；不确定时不写',
    ]);
  }

  const files = collectTemplateFiles();
  const plan = files.map((rel) => join(target, rel));

  if (!apply) {
    return envelope('INCONCLUSIVE', `dry-run：将写入 ${files.length} 个文件（--apply 提交）`, {
      kind: 'init',
      facts: [
        fact('plan', 'init', '写入计划', { actual: files }),
        fact('dry_run', 'init', '未执行任何写入（默认 dry-run；显式 --apply 才提交）'),
      ],
      nextSteps: ['确认计划后 pdeck init --apply；随后在目标目录 npm install && npm test && pdeck verify'],
    });
  }

  try {
    for (const rel of files) {
      const content = readFileSync(join(TEMPLATE_DIR, rel));
      const dest = join(target, rel);
      mkdirSync(join(dest, '..'), { recursive: true });
      writeFileSync(dest, content);
    }
  } catch (error) {
    return inconclusiveEnvelope('init', `写入失败: ${error.message}`, ['检查目标目录权限后重试']);
  }

  return envelope('PASSED', `已写入 ${files.length} 个模板文件（Phaser 4.2.1 钉版）`, {
    kind: 'init',
    facts: [
      fact('written', 'init', `模板文件已就位`, { actual: files }),
      fact('not_installed', 'init', '未运行 npm install（网络操作由你/Agent 显式执行）'),
    ],
    nextSteps: [
      `cd ${target} && npm install`,
      'npm test（核心逻辑无头测试）',
      'npm run build && pdeck verify（从窄到宽验证阶梯）',
      'npm run dev（开发）',
    ],
  });
}
