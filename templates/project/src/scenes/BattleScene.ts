// ===== 诊断场景（就绪性场景，不是新手游戏）=====
// 渲染背景 + 版本标签 + 就绪标记，供 pdeck verify 验证 canvas/输入/渲染。
import Phaser from 'phaser';

export class BattleScene extends Phaser.Scene {
  constructor() {
    super('battle');
  }

  create() {
    const w = this.scale.width;
    const h = this.scale.height;

    // 背景（Graphics 矢量——大 Canvas 纹理有 GPU ReadPixels 回读风险）
    const g = this.add.graphics();
    g.setDepth(-10);
    g.fillStyle(0x141426, 1).fillRect(0, 0, w, h * 0.7);
    g.fillStyle(0x2a2a44, 1).fillRect(0, h * 0.7, w, h * 0.3);
    g.fillStyle(0x3a5a8a, 1).fillPoints(
      [new Phaser.Math.Vector2(0, h * 0.7), new Phaser.Math.Vector2(w * 0.25, h * 0.45), new Phaser.Math.Vector2(w * 0.6, h * 0.7), new Phaser.Math.Vector2(w, h * 0.5), new Phaser.Math.Vector2(w, h * 0.7)],
      true,
    );

    // 版本标签与就绪标记
    this.add.text(w / 2, h * 0.3, `Phaser ${Phaser.VERSION} · Flight Deck 诊断场景`, {
      fontFamily: 'serif', fontSize: '28px', color: '#ffd24a',
    }).setOrigin(0.5);

    // 呼吸动画实体
    const entity = this.add.circle(w / 2, h * 0.55, 24, 0x4ac8ff, 0.9);
    this.tweens.add({ targets: entity, scale: 1.25, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // 就绪标记（DOM）
    const marker = document.getElementById('ready-marker');
    if (marker) marker.textContent = '就绪';
    marker?.classList.add('ready');
  }
}
