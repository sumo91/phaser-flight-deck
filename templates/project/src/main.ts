import Phaser from 'phaser';
import { Game } from './core/GameState';
import { BattleScene } from './scenes/BattleScene';

// ===== 入口 =====
export const game = new Game();
const hasSave = game.load();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-layer',
  backgroundColor: '#0a0a14',
  scene: [BattleScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  roundPixels: false,
  banner: false,
});

// 首次进入初始化存档
if (!hasSave) {
  game.newGame('无名侠客');
  game.save();
}

window.addEventListener('beforeunload', () => game.save());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') game.save();
});
