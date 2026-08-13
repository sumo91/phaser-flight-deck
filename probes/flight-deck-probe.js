// ===== Phaser Flight Deck 运行时探针（项目可选引入）=====
// 用法：游戏入口 import 后调用 installProbe(game, yourGameState)，即可被
// 未来的 pdeck run snapshot/probe 命令通过 window.__pdeck 查询运行状态。
// Phase 1 仅定义契约；Phase 2 的 pdeck run 将消费此契约。

/**
 * 安装探针：在 window 上暴露只读运行状态与操作句柄。
 * @param {object} phaserGame Phaser.Game 实例
 * @param {object} state 可选：游戏核心状态对象（含 stats/s 等），暴露给查询
 */
export function installProbe(phaserGame, state = null) {
  const probe = {
    installed: true,
    version: '0.1.0',
    // 只读查询
    query: {
      fps: () => {
        const loop = phaserGame?.loop;
        return loop ? { actualFps: Math.round(loop.actualFps * 10) / 10 } : null;
      },
      sceneKeys: () => (phaserGame?.scene ? phaserGame.scene.getScenes(true).map((s) => s.scene.key) : []),
      state: () => {
        if (!state) return null;
        const s = state.s ?? state;
        return {
          level: s.level,
          region: s.region,
          gold: s.gold,
          totalKills: s.totalKills,
          realm: s.realm,
          reinc: s.reinc,
          totalPlayMs: s.totalPlayMs,
        };
      },
      combat: () => {
        if (!state?.combat) return null;
        const c = state.combat;
        return {
          enemyName: c.enemy?.name ?? null,
          enemyHp: c.enemy?.hp ?? null,
          enemyMaxHp: c.enemy?.maxHp ?? null,
          enemyIsBoss: c.enemy?.isBoss ?? false,
          dead: c.dead ?? false,
          meditating: c.meditating ?? false,
          shield: c.shield ?? 0,
        };
      },
    },
  };
  window.__pdeck = probe;
  return probe;
}

export default installProbe;
