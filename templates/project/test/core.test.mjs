// ===== 核心逻辑无头测试（node --test，不依赖浏览器）=====
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, expToNext } from '../src/core/GameState.ts';

test('等级曲线：expToNext 单调递增', () => {
  assert.ok(expToNext(2) > expToNext(1));
  assert.ok(expToNext(10) > expToNext(5));
});

test('升级：经验溢出正确结转', () => {
  const g = new Game();
  g.newGame('测试侠');
  const need = expToNext(1);
  g.gainExp(need + 50);
  assert.equal(g.s.level, 2);
  assert.equal(g.s.exp, 50);
});

test('击杀循环：等级/金币/击杀数增长', () => {
  const g = new Game();
  g.newGame('测试侠');
  const before = { ...g.s };
  for (let i = 0; i < 20; i++) g.kill();
  assert.ok(g.s.kills === 20);
  assert.ok(g.s.gold > before.gold);
  assert.ok(g.s.level >= before.level);
});
