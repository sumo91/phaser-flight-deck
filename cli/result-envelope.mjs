// ===== 有界证据优先的结果信封 =====
// 与 Godot Flight Deck 同哲学的精简版：
// 第一次返回给 Agent 的内容必须是有界的；完整证据落盘或由 --json 输出。
// Verdict: PASSED / FAILED / INCONCLUSIVE / CANCELLED

const MAX_FACTS = 24;
const MAX_NEXT_STEPS = 6;
const MAX_SUMMARY_CHARS = 500;
const MAX_TEXT_CHARS = 240;
const MAX_RENDER_BYTES = 12 * 1024;
const MAX_RENDER_LINES = 120;

export function boundedText(value, maximum = MAX_TEXT_CHARS) {
  if (value === undefined || value === null) return '';
  const normalized = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, Math.max(0, maximum - 1))}…`;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function boundedScalar(value) {
  if (finite(value) || typeof value === 'boolean' || value === null) return value;
  if (typeof value === 'string') return boundedText(value);
  return undefined;
}

export function boundedEvidenceValue(value, depth = 0) {
  if (depth > 2) return undefined;
  if (typeof value === 'string') return boundedText(value);
  if (finite(value) || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => boundedEvidenceValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 8)
        .map(([key, item]) => [boundedText(key, 80), boundedEvidenceValue(item, depth + 1)])
        .filter(([key, item]) => key && item !== undefined),
    );
  }
  return undefined;
}

export function fact(classification, source, summary, values = {}) {
  return {
    classification,
    source,
    summary: boundedText(summary || classification),
    ...(values.expected !== undefined ? { expected: boundedEvidenceValue(values.expected) } : {}),
    ...(values.actual !== undefined ? { actual: boundedEvidenceValue(values.actual) } : {}),
  };
}

const VALID_VERDICTS = new Set(['PASSED', 'FAILED', 'INCONCLUSIVE', 'CANCELLED']);

export function envelope(verdict, summary, values = {}) {
  if (!VALID_VERDICTS.has(verdict)) throw new Error(`invalid verdict: ${verdict}`);
  const env = {
    verdict,
    summary: boundedText(summary, MAX_SUMMARY_CHARS),
    ...(values.kind ? { kind: boundedText(values.kind, 60) } : {}),
    ...(values.decisiveStage ? { decisiveStage: boundedText(values.decisiveStage, 80) } : {}),
    facts: (values.facts ?? []).slice(0, MAX_FACTS),
    ...(values.artifacts && values.artifacts.length ? { artifacts: values.artifacts.slice(0, 12).map((item) => boundedText(item, 512)) } : {}),
    nextSteps: (values.nextSteps ?? []).slice(0, MAX_NEXT_STEPS).map((item) => boundedText(item, 240)),
    ...(values.reportPath ? { reportPath: boundedText(values.reportPath, 512) } : {}),
  };
  return env;
}

export function renderEnvelope(env, options = {}) {
  const { json = false } = options;
  if (json) return JSON.stringify(env, null, 2);
  const lines = [];
  lines.push(`verdict: ${env.verdict}`);
  lines.push(`summary: ${env.summary}`);
  if (env.kind) lines.push(`kind: ${env.kind}`);
  if (env.decisiveStage) lines.push(`decisive: ${env.decisiveStage}`);
  if (env.facts.length) {
    lines.push('facts:');
    for (const f of env.facts) {
      const expected = f.expected !== undefined ? ` expected=${JSON.stringify(f.expected)}` : '';
      const actual = f.actual !== undefined ? ` actual=${JSON.stringify(f.actual)}` : '';
      lines.push(`  [${f.classification}] ${f.source}: ${f.summary}${expected}${actual}`);
    }
  }
  if (env.artifacts && env.artifacts.length) {
    lines.push('artifacts:');
    for (const a of env.artifacts) lines.push(`  ${a}`);
  }
  if (env.reportPath) lines.push(`report: ${env.reportPath}`);
  if (env.nextSteps.length) {
    lines.push('next:');
    for (const s of env.nextSteps) lines.push(`  - ${s}`);
  }
  const text = lines.join('\n');
  return text.length <= MAX_RENDER_BYTES ? text : `${text.slice(0, MAX_RENDER_BYTES)}…(truncated)`;
}

// 执行失败的统一信封
export function failureEnvelope(classification, source, message, nextSteps = []) {
  return envelope('FAILED', message, {
    kind: 'execution',
    decisiveStage: source,
    facts: [fact(classification, source, message)],
    nextSteps,
  });
}

export function inconclusiveEnvelope(source, message, nextSteps = []) {
  return envelope('INCONCLUSIVE', message, {
    kind: 'execution',
    decisiveStage: source,
    facts: [fact('precondition_missing', source, message)],
    nextSteps,
  });
}
