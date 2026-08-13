// ===== pdeck evidence：核查有界验证证据的新鲜度（只读）=====
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { detectProject } from '../lib/phaser-project.mjs';
import { envelope, fact, inconclusiveEnvelope } from '../result-envelope.mjs';

export function evidence(args, options) {
  const { project, limit = 12 } = options;
  const proj = detectProject(project ?? process.cwd());
  const reportsDir = join(proj.root, '.pdeck', 'reports');
  if (!existsSync(reportsDir)) {
    return inconclusiveEnvelope('evidence', '尚无验证证据（.pdeck/reports 为空）', [
      '运行 pdeck verify 生成第一份验证报告',
    ]);
  }
  const reports = readdirSync(reportsDir)
    .filter((name) => name.startsWith('verify-') && name.endsWith('.json'))
    .map((name) => {
      try {
        const full = join(reportsDir, name);
        const data = JSON.parse(readFileSync(full, 'utf8'));
        return { name, full, mtime: statSync(full).mtimeMs, verdict: data.verdict, decisiveStage: data.decisiveStage, timestamp: data.timestamp, elapsedMs: data.elapsedMs ?? null, factCount: (data.facts ?? []).length, artifacts: (data.artifacts ?? []).length };
      } catch {
        return { name, broken: true };
      }
    })
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    .slice(0, Math.min(limit, 24));

  if (!reports.length) {
    return inconclusiveEnvelope('evidence', '报告目录存在但无有效 verify 报告');
  }
  const latest = reports[0];
  const ageHours = latest.mtime ? Math.round((Date.now() - latest.mtime) / 3600000) : null;

  return envelope('PASSED', `最近验证：${latest.verdict}（${ageHours ?? '?'} 小时前）`, {
    kind: 'evidence',
    facts: reports.map((r) => fact('report', 'evidence',
      `${r.verdict}${r.decisiveStage ? ` @ ${r.decisiveStage}` : ''}${r.elapsedMs ? ` · ${Math.round(r.elapsedMs / 1000)}s` : ''} · ${r.timestamp ?? r.name}`,
      { actual: { ageHours: r.mtime ? Math.round((Date.now() - r.mtime) / 3600000) : null, facts: r.factCount, artifacts: r.artifacts } })),
    nextSteps: ['运行 pdeck verify 刷新证据', 'pdeck evidence --limit N 调整数量'],
  });
}
