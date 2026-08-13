// ===== 核心游戏状态（纯 TS，零 Phaser 依赖——可在 Node 无头模拟）=====
// 约定：src/core 与 src/data 不 import phaser（pdeck doctor 会检查 isolation）。

export function expToNext(level: number): number {
  return Math.round(90 * Math.pow(level, 2.0));
}

export interface SaveData {
  v: number;
  name: string;
  level: number;
  exp: number;
  gold: number;
  kills: number;
  lastSeen: number;
}

export const SAVE_KEY = 'phaser4-save-v1';

export function defaultSave(): SaveData {
  return { v: 1, name: '无名侠客', level: 1, exp: 0, gold: 0, kills: 0, lastSeen: Date.now() };
}

export class Game {
  s: SaveData = defaultSave();

  constructor() {}

  newGame(name: string) {
    this.s = defaultSave();
    this.s.name = name.trim() || '无名侠客';
    this.save();
  }

  load(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      this.s = { ...defaultSave(), ...JSON.parse(raw) };
      return true;
    } catch {
      return false;
    }
  }

  save() {
    try {
      this.s.lastSeen = Date.now();
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.s));
    } catch { /* 存储不可用 */ }
  }

  gainExp(amount: number) {
    this.s.exp += amount;
    while (this.s.exp >= expToNext(this.s.level)) {
      this.s.exp -= expToNext(this.s.level);
      this.s.level++;
    }
  }

  gainGold(amount: number) {
    this.s.gold += amount;
  }

  kill() {
    this.s.kills++;
    this.gainExp(5 + this.s.level * 2);
    this.gainGold(2 + this.s.level);
  }
}
