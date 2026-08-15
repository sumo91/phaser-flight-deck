// ===== pdeck check =====
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { detectProject } from '../lib/phaser-project.mjs';
import { scanSource, textureKeyFindings, collectCreatedKeys, SOURCE_EXT, V4_RULES } from '../lib/rules-v4.mjs';
import { envelope, fact, inconclusiveEnvelope } from '../result-envelope.mjs';

const MAX_FILES = 4000;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.pi', 'build', 'coverage', '.cache']);

function collectSourceFiles(root, file) {
  if (file) {
    const abs = resolve(root, file);
    return existsSync(abs) ? [abs] : [];
  }
  const files = [];
  const walk = (dir, deadline) => {
    if (files.length >= MAX_FILES || Date.now() > deadline) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full, deadline); continue; }
      if (SOURCE_EXT.test(entry)) files.push(full);
    }
  };
  walk(root, Date.now() + 30000);
  return files;
}

export function check(args, options) {
  const { project, file, severity = 'warn', timeout = 60 } = options;
  const proj = detectProject(project ?? process.cwd());
  if (!proj.found) {
    return inconclusiveEnvelope('check', `不是可识别的 Phaser 项目: ${proj.reason}`, [
      '在含 phaser 依赖的 package.json 目录下运行，或使用 --project 指定路径',
    ]);
  }

  const files = collectSourceFiles(proj.root, file);
  if (!files.length) {
    return inconclusiveEnvelope('check', file ? `文件不存在或不是源文件: ${file}` : '未发现可扫描的源文件');
  }

  // 第一遍：全项目收集静态创建的纹理 key（集中式 PreloadScene 模式下，跨文件引用不是悬空 key）
  const projectKeys = new Set();
  if (files.length > 1 || !file) {
    for (const full of files) {
      let content;
      try { content = readFileSync(full, 'utf8'); } catch { continue; }
      for (const key of collectCreatedKeys(content)) projectKeys.add(key);
    }
  }

  const findings = [];
  const keyFindings = [];
  let scanned = 0;
  const deadline = Date.now() + Math.min(timeout, 120) * 1000;
  for (const full of files) {
    if (Date.now() > deadline) {
      findings.push({ file: '(扫描超时)', line: 0, rule: 'scan_timeout', severity: 'warn', summary: `扫描在 ${scanned}/${files.length} 文件处超时` });
      break;
    }
    let content;
    try { content = readFileSync(full, 'utf8'); } catch { continue; }
    scanned++;
    const rel = relative(proj.root, full);
    const fileFindings = scanSource(rel, content, V4_RULES, { severity });
    for (const f of fileFindings) findings.push(f);
    const keys = textureKeyFindings(rel, content, { projectKeys });
    for (const k of keys) keyFindings.push({ ...k, file: rel });
  }

  // 判定
  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');
  const failOnWarn = severity === 'warn' && options.failOnWarn === true; // 仅当显式要求
  const verdict = errors.length ? 'FAILED' : (failOnWarn && warns.length ? 'FAILED' : 'PASSED');

  const facts = [];
  facts.push(fact('scan_coverage', 'check', `已扫描 ${scanned} 个源文件`, { actual: { scanned, total: files.length } }));
  if (errors.length) {
    for (const f of errors.slice(0, 12)) {
      facts.push(fact('removed_api', 'check', `${f.summary}（v${f.since} 起）`, {
        actual: { file: f.file, line: f.line, snippet: f.snippet },
        expected: f.fix,
      }));
    }
    if (errors.length > 12) facts.push(fact('removed_api_more', 'check', `其余 ${errors.length - 12} 处同类问题见完整报告`));
  }
  if (warns.length) {
    for (const f of warns.slice(0, 6)) {
      facts.push(fact('api_warning', 'check', f.summary, {
        actual: { file: f.file, line: f.line, snippet: f.snippet },
        expected: f.fix,
      }));
    }
    if (warns.length > 6) facts.push(fact('api_warning_more', 'check', `其余 ${warns.length - 6} 处警告见完整报告`));
  }
  if (keyFindings.length) {
    for (const k of keyFindings.slice(0, 6)) {
      facts.push(fact('unresolved_texture_key', 'check', `纹理 key "${k.key}" 未在全项目可见创建`, {
        actual: { file: k.file, snippet: k.snippet },
        expected: k.hint,
      }));
    }
  }
  if (!errors.length && !warns.length && !keyFindings.length) {
    facts.push(fact('clean', 'check', '未发现 v4 已移除 API、语义变化警告或悬空纹理 key'));
  }

  const summary = errors.length
    ? `发现 ${errors.length} 处已移除 API（error）${warns.length ? `、${warns.length} 处警告` : ''}`
    : warns.length || keyFindings.length
      ? `无 error，有 ${warns.length} 处警告、${keyFindings.length} 处悬空纹理 key`
      : '静态扫描通过：未发现 v4 API 问题';

  return envelope(verdict, summary, {
    kind: 'check',
    decisiveStage: 'check',
    facts,
    nextSteps: verdict === 'FAILED'
      ? [...new Set(errors.map((f) => f.fix))].slice(0, 6)
      : keyFindings.length
        ? ['核对运行时动态创建的纹理 key 是否为误报']
        : ['运行 pdeck doctor 查看项目健康全貌'],
  });
}
