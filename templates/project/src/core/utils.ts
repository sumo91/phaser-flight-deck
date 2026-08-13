// ===== 通用工具（纯 TS，零 Phaser 依赖——可在 Node 无头测试）=====
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const chance = (p: number): boolean => Math.random() < p;

export function fmt(n: number): string {
  if (!isFinite(n)) return '∞';
  const abs = Math.abs(n);
  if (abs < 10000) return Math.floor(n).toString();
  if (abs < 1e8) return trim1(n / 1e4) + '万';
  if (abs < 1e12) return trim1(n / 1e8) + '亿';
  return trim1(n / 1e12) + '万亿';
}
function trim1(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

export type Listener = (ev: any) => void;
export class Emitter {
  private map = new Map<string, Set<Listener>>();
  on(ev: string, fn: Listener): () => void {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev)!.add(fn);
    return () => this.map.get(ev)?.delete(fn);
  }
  emit(ev: string, data?: any): void {
    this.map.get(ev)?.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
  }
}
