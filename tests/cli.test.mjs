// ===== Phaser Flight Deck CLI 测试（node --test）=====
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { envelope, renderEnvelope, boundedText, failureEnvelope } from '../cli/result-envelope.mjs';
import { scanSource, textureKeyFindings, V4_RULES } from '../cli/lib/rules-v4.mjs';
import { splitErrors, splitWarnings } from '../cli/lib/console-filter.mjs';
import { pruneEvidenceFiles } from '../cli/commands/verify.mjs';
import { detectProject } from '../cli/lib/phaser-project.mjs';
import { quietPeriodDays } from '../cli/lib/registry-lookup.mjs';

const CLI = fileURLToPath(new URL('../cli/pdeck.mjs', import.meta.url));
const FIXTURE = 'D:/00_Ai/Deepseek/WebGames/Phaser4Games/SwordIdle';
const hasFixture = existsSync(join(FIXTURE, 'node_modules', 'phaser', 'package.json'));

function pdeck(args, cwd = process.cwd(), timeoutMs = 60000) {
  return execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: timeoutMs });
}

// ===== 信封 =====
test('envelope: verdict 校验', () => {
  assert.throws(() => envelope('BROKEN', 'x'), /invalid verdict/);
  const env = envelope('PASSED', 'ok', { facts: [] });
  assert.equal(env.verdict, 'PASSED');
});

test('envelope: 有界摘要', () => {
  const env = envelope('FAILED', 'x'.repeat(5000));
  assert.ok(env.summary.length <= 500);
  const env2 = failureEnvelope('command_error', 'test', 'boom');
  assert.equal(env2.verdict, 'FAILED');
  assert.equal(env2.facts[0].classification, 'command_error');
});

test('envelope: 渲染截断', () => {
  const env = envelope('PASSED', 's', { facts: Array.from({ length: 50 }, (_, i) => ({ classification: 'f', source: 's', summary: `fact ${i}` })) });
  assert.ok(env.facts.length <= 24);
  const text = renderEnvelope(env);
  assert.ok(text.length <= 12 * 1024 + 32);
  assert.ok(renderEnvelope(env, { json: true }).startsWith('{'));
});

// ===== 规则表 =====
test('scanSource: 捕获已移除 API', () => {
  const findings = scanSource('bad.ts', 'sprite.setTintFill(0xff0000);\nconst a = Phaser.Math.PI2;\nconst p = new Phaser.Geom.Point(1,2);\nconst ok = sprite.setTint(0xff0000);\n');
  const ids = findings.map((f) => f.rule);
  assert.ok(ids.includes('tint-fill'));
  assert.ok(ids.includes('math-pi2'));
  assert.ok(ids.includes('geom-point'));
  assert.ok(!findings.some((f) => f.rule === 'tint-fill' && f.line !== 1));
  assert.equal(findings.find((f) => f.rule === 'tint-fill').severity, 'error');
});

test('scanSource: severity=error 只报 error 规则', () => {
  const content = 'const t = Phaser.Math.TAU;\nsprite.setTintFill(0xffffff);';
  const findings = scanSource('warn.ts', content, V4_RULES, { severity: 'error' });
  assert.ok(findings.every((f) => f.severity === 'error'));
  assert.equal(findings.length, 1);
});

test('scanSource: 语义警告规则', () => {
  const findings = scanSource('w.ts', 'const t = Phaser.Math.TAU;\nconst g = new Phaser.GameObjects.Shader(scene, 1, 2);\n');
  assert.ok(findings.some((f) => f.rule === 'math-tau' && f.severity === 'warn'));
  assert.ok(findings.some((f) => f.rule === 'shader-constructor'));
});

test('textureKeyFindings: 悬空 key 检测', () => {
  const findings = textureKeyFindings('scene.ts', `this.add.image(100, 100, 'missing_key');\nthis.load.image('loaded_key', 'x.png');\nthis.add.sprite(0, 0, 'loaded_key');\n`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].key, 'missing_key');
});

test('textureKeyFindings: 动态纹理工厂抑制误报', () => {
  const findings = textureKeyFindings('scene.ts', `this.add.image(100, 100, 'player_tex');\nthis.textures.addCanvas(key, canvas);\nconst getTex = (k, f) => {};\n`);
  assert.equal(findings.length, 0);
});

test('rules: 全部规则有 fix 与 source', () => {
  for (const rule of V4_RULES) {
    assert.ok(rule.fix.length > 0, rule.id);
    assert.ok(['official-migration-guide', 'session-empirical'].includes(rule.source), rule.id);
    assert.ok(['error', 'warn'].includes(rule.severity), rule.id);
  }
});

// ===== 项目探测 =====
test('detectProject: 非项目拒绝', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-empty-'));
  const result = detectProject(dir);
  assert.equal(result.found, false);
  rmSync(dir, { recursive: true, force: true });
});

test('detectProject: 合成 Phaser 项目', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-fake-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake', dependencies: { phaser: '^4.2.1' } }));
  const result = detectProject(dir);
  assert.equal(result.found, true);
  assert.equal(result.phaserDeclared, '^4.2.1');
  assert.equal(result.phaserInstalled, null);
  rmSync(dir, { recursive: true, force: true });
});

// ===== 注册表工具（离线逻辑）=====
test('quietPeriodDays: 数据完备时计算天数', () => {
  const timeline = { ok: true, versions: [{ version: '4.2.1', published: '2026-07-09T00:00:00Z' }] };
  const now = Date.parse('2026-08-13T00:00:00Z');
  assert.equal(quietPeriodDays(timeline, now), 35);
  assert.equal(quietPeriodDays({ ok: false }, now), null);
});

// ===== 合成 fixture 集成（check 命令直接调用）=====
test('check: 合成坏项目报 error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-bad-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'bad', dependencies: { phaser: '4.2.1' } }));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'Bad.ts'), 'sprite.setTintFill(0xff0000);\nconst t = Phaser.Math.PI2;\n');
  const { check } = await import('../cli/commands/check.mjs');
  const env = check([], { project: dir });
  assert.equal(env.verdict, 'FAILED');
  assert.ok(env.facts.some((f) => f.classification === 'removed_api'));
  rmSync(dir, { recursive: true, force: true });
});

test('check: 干净项目 PASSED', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-clean-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'clean', dependencies: { phaser: '4.2.1' } }));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'Good.ts'), 'this.load.image("hero", "hero.png");\nthis.add.sprite(0, 0, "hero");\n');
  const { check } = await import('../cli/commands/check.mjs');
  const env = check([], { project: dir });
  assert.equal(env.verdict, 'PASSED');
  rmSync(dir, { recursive: true, force: true });
});

// ===== CLI 冒烟（真实子进程）=====
test('CLI: version/help/describe', () => {
  assert.match(pdeck(['version']), /phaser-flight-deck \d+\.\d+\.\d+/);
  assert.match(pdeck(['help']), /doctor/);
  const desc = JSON.parse(pdeck(['describe', 'check', '--json']));
  assert.equal(desc.name, 'check');
});

test('CLI: 未知命令 exit 2', () => {
  assert.throws(() => pdeck(['nope']), (err) => err.status === 2);
});

test('CLI: 未知选项 exit 2', () => {
  assert.throws(() => pdeck(['doctor', '--nope']), (err) => err.status === 2);
});

// ===== 控制台错误分类（verify 与 run console 共用）=====
test('splitErrors: favicon 404 归为良性', () => {
  const { benign, real } = splitErrors([
    'Failed to load resource: the server responded with a status of 404 (Not Found)',
    'Uncaught TypeError: x is not a function',
    'GET /favicon.ico 404',
  ]);
  assert.equal(benign.length, 2);
  assert.equal(real.length, 1);
});

test('splitWarnings: 观察者环境噪音单独归类', () => {
  const { envNoise, real } = splitWarnings([
    '[.WebGL-0x123]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels',
    'Deprecation warning: use new API',
    'GL Driver Message (this message will no longer repeat)',
  ]);
  assert.equal(envNoise.length, 2);
  assert.equal(real.length, 1);
});

// ===== 证据保留策略 =====
test('pruneEvidenceFiles: 每类只留最近 10 份', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-prune-'));
  mkdirSync(join(dir, '.pdeck', 'reports'), { recursive: true });
  mkdirSync(join(dir, '.pdeck', 'captures'), { recursive: true });
  for (let i = 0; i < 14; i++) {
    writeFileSync(join(dir, '.pdeck', 'reports', `verify-2026-08-${String(i).padStart(2, '0')}.json`), '{}');
    writeFileSync(join(dir, '.pdeck', 'captures', `verify-2026-08-${String(i).padStart(2, '0')}.png`), 'x');
  }
  for (let i = 0; i < 3; i++) {
    writeFileSync(join(dir, '.pdeck', 'captures', `snapshot-2026-08-0${i}.png`), 'x');
  }
  writeFileSync(join(dir, '.pdeck', 'captures', 'keep-me.txt'), 'x'); // 非本工具文件不删
  const removed = pruneEvidenceFiles(dir);
  const reports = readdirSync(join(dir, '.pdeck', 'reports'));
  const captures = readdirSync(join(dir, '.pdeck', 'captures'));
  assert.equal(removed, 8); // 报告 14→10（4）+ 截图 14→10（4）；snapshot 3 份未超限
  assert.equal(reports.length, 10);
  assert.ok(captures.includes('keep-me.txt'), '无关文件不受影响');
  assert.equal(captures.filter((n) => n.startsWith('verify-')).length, 10);
  rmSync(dir, { recursive: true, force: true });
});
// ===== 真实项目集成（SwordIdle 夹具）=====
test('集成: doctor 真实项目 PASSED', { skip: !hasFixture }, () => {
  const out = pdeck(['doctor', FIXTURE, '--offline']);
  assert.match(out, /verdict: PASSED/);
  assert.match(out, /isolation_ok/);
});

test('集成: check 真实项目（我们的 v4 干净代码）', { skip: !hasFixture }, () => {
  const out = pdeck(['check', FIXTURE]);
  assert.match(out, /verdict: PASSED/);
  assert.match(out, /addCanvas|addcanvas/i); // 诚实的实测警告
});

test('集成: api 预言机', { skip: !hasFixture }, () => {
  const out = pdeck(['api', 'query', 'fillPoints', FIXTURE, '--depth', '1']);
  assert.match(out, /verdict: PASSED/);
  assert.match(out, /fillPoints/);
  const exists = pdeck(['api', 'exists', 'setTintFill', FIXTURE]);
  assert.match(exists, /removed_api_in_types/); // 类型残留 + 规则表交叉核对
});

// ===== Phase 2：init（dry-run 门控）=====
test('init: 非空目录拒绝写入', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-init-bad-'));
  writeFileSync(join(dir, 'random.txt'), 'x');
  const out = pdeck(['init', dir]);
  assert.match(out, /停止于写入前|INCONCLUSIVE/);
  assert.ok(!existsSync(join(dir, 'package.json')), '未写入任何文件');
  rmSync(dir, { recursive: true, force: true });
});

test('init: 已有 package.json 拒绝', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-init-pkg-'));
  writeFileSync(join(dir, 'package.json'), '{}');
  const out = pdeck(['init', dir]);
  assert.match(out, /拒绝写入/);
  rmSync(dir, { recursive: true, force: true });
});

test('init: dry-run 不写文件，--apply 写入 12 个模板文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-init-ok-'));
  const dry = pdeck(['init', dir]);
  assert.match(dry, /dry-run/);
  assert.ok(!existsSync(join(dir, 'package.json')));
  const applied = pdeck(['init', dir, '--apply']);
  assert.match(applied, /verdict: PASSED/);
  assert.ok(existsSync(join(dir, 'package.json')));
  assert.ok(existsSync(join(dir, 'src', 'core', 'GameState.ts')));
  assert.ok(existsSync(join(dir, 'test', 'core.test.mjs')));
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies.phaser, '4.2.1');
  rmSync(dir, { recursive: true, force: true });
});

test('init: 不存在目录 INCONCLUSIVE', () => {
  const out = pdeck(['init', join(tmpdir(), 'definitely-not-exists-' + Date.now())]);
  assert.match(out, /目标目录不存在/);
});

// ===== Phase 2：evidence =====
test('evidence: 无报告时 INCONCLUSIVE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-evid-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { phaser: '4.2.1' } }));
  const out = pdeck(['evidence', dir]);
  assert.match(out, /INCONCLUSIVE/);
  rmSync(dir, { recursive: true, force: true });
});

test('集成: evidence 真实项目有验证证据', { skip: !hasFixture }, () => {
  const out = pdeck(['evidence', FIXTURE]);
  assert.match(out, /verdict: PASSED/);
  assert.match(out, /最近验证/);
});

// ===== Phase 2：verify（需 playwright + Chrome，可用时）=====
test('集成: verify 真实项目（完整阶梯）', { skip: !hasFixture, timeout: 600000 }, () => {
  const out = pdeck(['verify', FIXTURE], FIXTURE, 600000);
  assert.match(out, /verdict: (PASSED|INCONCLUSIVE)/);
  assert.match(out, /verify\./);
});

// ===== Phase 2：run serve 生命周期（用高端口避免与其它项目冲突）=====
test('run: serve→snapshot→stop 完整生命周期', { skip: !hasFixture, timeout: 300000 }, () => {
  const port = String(55000 + Math.floor(Math.random() * 1000));
  const served = pdeck(['run', 'serve', '--port', port, FIXTURE], FIXTURE, 300000);
  assert.match(served, /verdict: PASSED/);
  const snapshot = pdeck(['run', 'snapshot', `http://localhost:${port}/`, '--output', join(tmpdir(), `pdeck-snap-${port}.png`)], FIXTURE, 120000);
  assert.match(snapshot, /verdict: PASSED/);
  const stopped = pdeck(['run', 'serve', '--stop', '--port', port, FIXTURE], FIXTURE, 120000);
  assert.match(stopped, /verdict: PASSED/);
});

// ===== Phase 3：视觉回归（需 playwright + Chrome + dist，可用时）=====
test('visual: baseline→visual-test 自比对零差异', { skip: !hasFixture, timeout: 300000 }, () => {
  const base = pdeck(['baseline', 'ph3-self', FIXTURE], FIXTURE, 180000);
  assert.match(base, /verdict: PASSED/);
  assert.ok(existsSync(join(FIXTURE, '.pdeck', 'baselines', 'ph3-self.png')));
  const testOut = pdeck(['visual-test', 'ph3-self', FIXTURE, '--tolerance', '0.01'], FIXTURE, 180000);
  assert.match(testOut, /verdict: (PASSED|FAILED)/);
  // 同一 build 的画面自比对应稳定（抗抖动容差 0.05）
  const loose = pdeck(['visual-test', 'ph3-self', FIXTURE, '--tolerance', '0.05'], FIXTURE, 180000);
  assert.match(loose, /verdict: PASSED/);
});

test('visual: 非法基准名拒绝', { skip: !hasFixture }, () => {
  const out = pdeck(['baseline', '非法名!!', FIXTURE], FIXTURE, 60000);
  assert.match(out, /INCONCLUSIVE/);
  const missing = pdeck(['visual-test', 'never-existed', FIXTURE], FIXTURE, 60000);
  assert.match(missing, /基准不存在/);
});

// ===== Phase 3：平衡模拟门（合成 fixture）=====
test('simulate: 契约缺失 INCONCLUSIVE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-sim-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { phaser: '4.2.1' } }));
  const out = pdeck(['simulate', dir], dir, 120000);
  assert.match(out, /未找到模拟契约/);
  rmSync(dir, { recursive: true, force: true });
});

test('simulate: profile 生成 → 区间检查 PASSED/FAILED', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-sim2-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { phaser: '4.2.1' } }));
  mkdirSync(join(dir, 'test'));
  const harness = `const h = Number(process.env.SIM_HOURS || 48);
console.log(JSON.stringify({ hours: h, level: 100 + h, region: 5, regionName: 'fixture', realm: 3, totalKills: h * 100, gold: h * 1000 }));`;
  writeFileSync(join(dir, 'test', 'simulate.mjs'), harness);
  const prof = pdeck(['simulate-profile', '--hours', '10', dir], dir, 120000);
  assert.match(prof, /verdict: PASSED/);
  const profile = JSON.parse(readFileSync(join(dir, '.pdeck', 'simulate.json'), 'utf8'));
  assert.equal(profile.bands.level.min < 110 && profile.bands.level.max > 110, true);
  const ok = pdeck(['simulate', '--hours', '10', dir], dir, 120000);
  assert.match(ok, /verdict: PASSED/);
  assert.throws(
    () => pdeck(['simulate', '--hours', '90', dir], dir, 120000),
    (err) => {
      assert.equal(err.status, 1, 'FAILED 裁决退出码为 1');
      assert.match(err.stdout, /verdict: FAILED/);
      assert.match(err.stdout, /band_violation/);
      return true;
    },
  );
  rmSync(dir, { recursive: true, force: true });
});

test('simulate: 泛型契约——农场字段名同样生成 band（外部反馈 #2）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-farm-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { phaser: '4.2.1' } }));
  mkdirSync(join(dir, 'test'));
  const harness = `const h = Number(process.env.SIM_HOURS || 48);
console.log(JSON.stringify({ hours: h, crops: h * 10, coins: h * 100, happiness: 42 }));`;
  writeFileSync(join(dir, 'test', 'simulate.mjs'), harness);
  const prof = pdeck(['simulate-profile', '--hours', '5', dir], dir, 120000);
  assert.match(prof, /verdict: PASSED/);
  const profile = JSON.parse(readFileSync(join(dir, '.pdeck', 'simulate.json'), 'utf8'));
  assert.deepEqual(Object.keys(profile.bands).sort(), ['coins', 'crops', 'happiness']);
  const ok = pdeck(['simulate', '--hours', '5', dir], dir, 120000);
  assert.match(ok, /verdict: PASSED/);
  assert.match(ok, /crops/);
  rmSync(dir, { recursive: true, force: true });
});

test('simulate: 解析失败附原始输出尾部（外部反馈 #4）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdeck-badout-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { phaser: '4.2.1' } }));
  mkdirSync(join(dir, 'test'));
  writeFileSync(join(dir, 'test', 'simulate.mjs'), `console.log('not json at all');`);
  assert.throws(
    () => pdeck(['simulate-profile', '--hours', '5', dir], dir, 120000),
    (err) => {
      assert.equal(err.status, 1);
      assert.match(err.stdout, /原始输出尾部: not json at all/);
      return true;
    },
  );
  rmSync(dir, { recursive: true, force: true });
});
