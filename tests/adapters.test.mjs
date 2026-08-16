// ===== 适配器一致性测试 =====
// 校验**已提交**的 dist/ 与单一契约源（registry/commands.mjs + 主技能）一致：
// npm test 不再先跑 generate——本文件守护的是仓库里的 dist 是否新鲜且自洽，
// 改了 registry/技能却忘了 npm run generate + 提交，在这里失败。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CLI_COMMANDS } from '../registry/commands.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

test('adapters: 生成器产物齐全（3 宿主 × 技能 + 命令 + MANIFEST）', () => {
  for (const host of ['claude-code', 'cursor', 'codex']) {
    const skill = join(DIST, host, 'skills', 'phaser-flight-deck', 'SKILL.md');
    assert.ok(existsSync(skill), `${host} SKILL.md 存在`);
  }
  for (const host of ['claude-code', 'cursor']) {
    for (const cmd of ['pdeck-regression', 'pdeck-verify', 'pdeck-doctor', 'pdeck-check']) {
      assert.ok(existsSync(join(DIST, host, 'commands', `${cmd}.md`)), `${host}/${cmd}.md 存在`);
    }
  }
  assert.ok(existsSync(join(DIST, 'claude-code', 'hooks', 'pdeck-confirm.mjs')), 'Claude hooks 存在');
  assert.ok(existsSync(join(DIST, 'MANIFEST.json')), 'MANIFEST 存在');
});

test('adapters: 每个 CLI 命令都在技能文档的命令表中被提及（契约覆盖）', () => {
  const skill = readFileSync(join(DIST, 'claude-code', 'skills', 'phaser-flight-deck', 'SKILL.md'), 'utf8');
  const commands = Object.keys(CLI_COMMANDS).filter((name) => !['help', 'version', 'describe'].includes(name));
  for (const name of commands) {
    assert.ok(skill.includes(`pdeck ${name}`), `技能文档覆盖命令 ${name}`);
  }
});

test('adapters: 技能文档含宿主接入与确认门说明', () => {
  const claude = readFileSync(join(DIST, 'claude-code', 'skills', 'phaser-flight-deck', 'SKILL.md'), 'utf8');
  const cursor = readFileSync(join(DIST, 'cursor', 'skills', 'phaser-flight-deck', 'SKILL.md'), 'utf8');
  const codex = readFileSync(join(DIST, 'codex', 'skills', 'phaser-flight-deck', 'SKILL.md'), 'utf8');
  assert.match(claude, /PreToolUse|hooks/);
  assert.match(cursor, /无 hooks|prompt 约定/);
  assert.match(codex, /\$HOME\/.agents\/skills/);
});

test('adapters: MANIFEST 哈希与文件实际内容一致', () => {
  const manifest = JSON.parse(readFileSync(join(DIST, 'MANIFEST.json'), 'utf8'));
  const entries = Object.entries(manifest.files);
  assert.ok(entries.length >= 14, `manifest 至少 14 个文件（实际 ${entries.length}）`);
  for (const [rel, expected] of entries) {
    const actual = sha256(readFileSync(join(DIST, rel), 'utf8'));
    assert.equal(actual, expected, `哈希一致: ${rel}`);
  }
});

test('adapters: 已提交的 dist 与契约源新鲜一致（改 registry/技能后须重新生成提交）', () => {
  // 生成到临时目录，与已提交的 dist 逐文件比对——捕获"改了源忘提交 dist"的漂移
  const fresh = mkdtempSync(join(tmpdir(), 'pdeck-dist-'));
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'generate-adapters.mjs'), '--out', fresh], { timeout: 60000 });
    const listFiles = (dir, base = dir, acc = []) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) listFiles(full, base, acc);
        else acc.push(full.slice(base.length + 1));
      }
      return acc.sort();
    };
    const committed = listFiles(DIST);
    const generated = listFiles(fresh);
    assert.deepEqual(committed, generated, '文件清单一致（多余/缺失文件 = dist 过期）');
    for (const rel of generated) {
      assert.equal(
        readFileSync(join(DIST, rel), 'utf8'),
        readFileSync(join(fresh, rel), 'utf8'),
        `dist/${rel} 与契约源再生成结果不一致——运行 npm run generate 并提交`,
      );
    }
  } finally {
    rmSync(fresh, { recursive: true, force: true });
  }
});

test('adapters: 写入风险命令在 Claude hooks 拦截清单中', () => {
  const hook = readFileSync(join(DIST, 'claude-code', 'hooks', 'pdeck-confirm.mjs'), 'utf8');
  for (const pattern of ['init', 'vendor-skills', 'baseline', 'simulate-profile']) {
    assert.ok(hook.includes(pattern), `hooks 拦截 ${pattern}`);
  }
});
