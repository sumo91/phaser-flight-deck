// ===== 适配器一致性测试 =====
// 校验生成的 dist/ 与单一契约源（registry/commands.mjs）一致：
// 每个 CLI 命令在技能文档中被提及、每宿主包结构完整、MANIFEST 哈希真实。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

test('adapters: 写入风险命令在 Claude hooks 拦截清单中', () => {
  const hook = readFileSync(join(DIST, 'claude-code', 'hooks', 'pdeck-confirm.mjs'), 'utf8');
  for (const pattern of ['init', 'vendor-skills', 'baseline', 'simulate-profile']) {
    assert.ok(hook.includes(pattern), `hooks 拦截 ${pattern}`);
  }
});
