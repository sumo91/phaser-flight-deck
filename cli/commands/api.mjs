// ===== pdeck api：打包类型定义预言机 =====
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectProject } from '../lib/phaser-project.mjs';
import { envelope, fact, inconclusiveEnvelope } from '../result-envelope.mjs';

const DTS_PATH = join('node_modules', 'phaser', 'types', 'phaser.d.ts');

function loadDts(root) {
  const path = join(root, DTS_PATH);
  if (!existsSync(path)) return { error: `未找到 ${DTS_PATH}（先 npm install phaser）` };
  try {
    return { path, lines: readFileSync(path, 'utf8').split('\n') };
  } catch (error) {
    return { error: `读取失败: ${error.message}` };
  }
}

// 提取某个匹配行上方的 JSDoc 注释块（最多 4 行）
function docContext(lines, index) {
  const doc = [];
  for (let i = index - 1; i >= Math.max(0, index - 5); i--) {
    const line = lines[i].trim();
    if (line.startsWith('/**') || line.startsWith('*') || line.startsWith('*/')) {
      doc.unshift(line);
      if (line.startsWith('/**')) break;
    } else if (doc.length === 0) {
      break; // 无紧邻文档块
    } else {
      break;
    }
  }
  return doc;
}

export async function api(args, options) {
  const mode = options.mode ?? args[0];
  const query = options.query ?? args[1];
  const { project, depth = 8 } = options;
  const proj = detectProject(project ?? process.cwd());
  const root = proj.found ? proj.root : (project ? project : process.cwd());
  const dts = loadDts(root);
  if (dts.error) {
    return inconclusiveEnvelope('api', dts.error, ['npm install phaser 后重试，或 --project 指定已安装的项目']);
  }

  if (mode === 'version') {
    return envelope('PASSED', `已安装 Phaser 版本: ${proj.phaserInstalled ?? '未知'}`, {
      kind: 'api-version',
      facts: [fact('installed_version', 'api', '来自 node_modules/phaser/package.json', {
        actual: { version: proj.phaserInstalled, dts: join(root, DTS_PATH) },
      })],
    });
  }

  const text = (query ?? '').trim();
  if (!text) {
    return inconclusiveEnvelope('api', 'api query/exists 需要查询文本（第二个参数）');
  }

  // exists：只回答"存在与否"（不含片段，避免污染上下文），并交叉核对已移除 API 规则表
  if (mode === 'exists') {
    let count = 0;
    for (const line of dts.lines) {
      if (line.includes(text)) { count++; if (count >= 50) break; }
    }
    const found = count > 0;
    const facts = [fact(found ? 'exists' : 'not_exists', 'api', `"${text}"`, { actual: { matches: Math.min(count, 50) } })];
    let removedWarning = null;
    if (found) {
      const { V4_RULES: rules } = await import('../lib/rules-v4.mjs');
      const removed = rules.find((rule) => rule.severity === 'error' && rule.summary.toLowerCase().includes(text.toLowerCase()));
      if (removed) {
        removedWarning = removed;
        facts.push(fact('removed_api_in_types', 'api', `⚠ "${text}" 出现在类型定义中，但按 v${removed.since} 迁移指南已移除/不可用`, {
          expected: removed.fix,
        }));
      }
    }
    return envelope('PASSED', `Phaser 类型定义中 ${found ? '存在' : '不存在'} "${text}"${removedWarning ? '，但该 API 在 v4 已移除（见 facts）' : ''}`, {
      kind: 'api-exists',
      facts,
      nextSteps: removedWarning
        ? [`${removedWarning.fix}；类型定义残留声明不代表运行时可用`]
        : found ? [] : ['用 pdeck api query 搜索近似名称，或核对是否拼写错误/已移除 API（pdeck check 可扫已移除 API）'],
    });
  }

  // query：返回精确匹配行 + 文档上下文
  const matches = [];
  for (let i = 0; i < dts.lines.length; i++) {
    if (dts.lines[i].includes(text)) {
      const doc = docContext(dts.lines, i);
      matches.push({ line: i + 1, doc, declaration: dts.lines[i].trim().slice(0, 220) });
      if (matches.length >= depth) break;
    }
  }
  if (!matches.length) {
    return envelope('INCONCLUSIVE', `类型定义中未找到 "${text}"`, {
      kind: 'api-query',
      facts: [fact('no_match', 'api', `"${text}" 无匹配（共扫描 ${dts.lines.length} 行）`)],
      nextSteps: ['可能是 v4 已移除 API——运行 pdeck check；或尝试更短的关键词'],
    });
  }
  return envelope('PASSED', `找到 ${matches.length} 处匹配`, {
    kind: 'api-query',
    facts: matches.slice(0, depth).map((m) => fact('declaration', 'api', `行 ${m.line}: ${m.declaration}`, {
      actual: m.doc.length ? { doc: m.doc.join(' ') } : undefined,
    })),
    nextSteps: ['用更精确的关键词缩小范围；要判断"是否存在"用 pdeck api exists <词>'],
  });
}
