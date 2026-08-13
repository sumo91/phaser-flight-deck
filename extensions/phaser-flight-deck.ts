// ===== Phaser Flight Deck — Pi 薄封装扩展 =====
// 只做：可信项目发现、严格参数映射、超时/截断、结果信封透传、分级确认门。
// 不做：任何业务逻辑（全部在零依赖 CLI cli/pdeck.mjs 中）。
// 风险分级（registry TOOL_FAMILIES）：
//   none           → 直接执行（doctor/check/api/evidence）
//   generated-write→ 会话内确认一次 + 120s approval lease（verify 截图/报告、run 快照）
//   project-write  → 每次确认（init --apply）
//   host-write     → 每次确认（vendor-skills 写工具自身）

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PI_FIELDS, TOOL_FAMILIES } from "../registry/commands.mjs";

const CLI_FILE = fileURLToPath(new URL("../cli/pdeck.mjs", import.meta.url));
const TRUST_FILE = fileURLToPath(new URL("../trust.json", import.meta.url));
const LEASE_MS = 120 * 1000;
const GRANT_DIALOG_TIMEOUT_MS = 300 * 1000;

const RISK_LABELS: Record<string, string> = {
  "generated-write": "验证/观察证据（.pdeck 截图与报告）",
  "project-write": "项目文件（init 脚手架）",
  "host-write": "工具自身目录（vendor 官方技能）",
};

interface ToolParams {
  action?: string;
  runAction?: string;
  visualAction?: string;
  simulateAction?: string;
  mode?: string;
  query?: string;
  project?: string;
  timeout?: number;
  offline?: boolean;
  severity?: string;
  file?: string;
  depth?: number;
  url?: string;
  output?: string;
  port?: number;
  stop?: boolean;
  seconds?: number;
  viewport?: string;
  capture?: boolean;
  apply?: boolean;
  tag?: string;
  limit?: number;
  name?: string;
  tolerance?: number;
  threshold?: number;
  hours?: number;
}

function fieldSchema(fieldName: keyof typeof PI_FIELDS) {
  const definition = PI_FIELDS[fieldName] as any;
  const constraints: Record<string, unknown> = {};
  if (definition.description) constraints.description = definition.description;
  if (definition.kind === "string") {
    if (definition.minLength) constraints.minLength = definition.minLength;
    if (definition.maxLength) constraints.maxLength = definition.maxLength;
    if (definition.pattern) constraints.pattern = definition.pattern;
  } else if (definition.kind === "number" || definition.kind === "integer") {
    if (definition.minimum !== undefined) constraints.minimum = definition.minimum;
    if (definition.maximum !== undefined) constraints.maximum = definition.maximum;
    if (definition.kind === "integer") return Type.Optional(Type.Integer(constraints));
  } else if (definition.kind === "boolean") {
    return Type.Optional(Type.Boolean(constraints));
  } else if (definition.kind === "enum") {
    return Type.Optional(Type.Union(definition.values.map((value: string) => Type.Literal(value))));
  }
  return Type.Optional(Type.String(constraints));
}

function buildArgs(command: string, params: ToolParams): string[] {
  const args: string[] = [command];
  if (command === "run" && params.runAction) args.push(params.runAction);
  if (command === "api" && params.mode) args.push(params.mode);
  if (command === "api" && params.query) args.push(params.query);
  if ((command === "baseline" || command === "visual-test") && params.name) args.push(params.name);
  if (params.project) args.push("--project", params.project);
  if (params.offline) args.push("--offline");
  if (params.severity) args.push("--severity", params.severity);
  if (params.file) args.push("--file", params.file);
  if (params.depth !== undefined) args.push("--depth", String(params.depth));
  if (params.url) args.push("--url", params.url);
  if (params.output) args.push("--output", params.output);
  if (params.port !== undefined) args.push("--port", String(params.port));
  if (params.stop) args.push("--stop");
  if (params.seconds !== undefined) args.push("--seconds", String(params.seconds));
  if (params.viewport) args.push("--viewport", params.viewport);
  if (params.query && command === "run") args.push("--query", params.query);
  if (params.apply) args.push("--apply");
  if (params.tag) args.push("--tag", params.tag);
  if (params.limit !== undefined) args.push("--limit", String(params.limit));
  if (params.tolerance !== undefined) args.push("--tolerance", String(params.tolerance));
  if (params.threshold !== undefined) args.push("--threshold", String(params.threshold));
  if (params.hours !== undefined) args.push("--hours", String(params.hours));
  args.push("--json");
  return args;
}

function runCli(command: string, params: ToolParams, timeoutSeconds: number): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeoutMs = Math.min(Math.max(timeoutSeconds ?? 120, 1), 900) * 1000;
    execFile(
      process.execPath,
      [CLI_FILE, ...buildArgs(command, params)],
      { timeout: timeoutMs, maxBuffer: 512 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const output = (stdout || "").trim() || (stderr || "").trim();
        if (error && !output) {
          rejectPromise(new Error(`pdeck ${command} 执行失败: ${error.message}`));
          return;
        }
        resolvePromise(output);
      },
    );
  });
}

function parseEnvelope(output: string): { env: any; ok: boolean } {
  try {
    const env = JSON.parse(output);
    if (env && typeof env === "object" && "verdict" in env) return { env, ok: true };
  } catch { /* 非 JSON → 原样返回 */ }
  return { env: output, ok: false };
}

function toolResult(output: string, auth = "none") {
  const { env, ok } = parseEnvelope(output);
  const authLabel = auth === "trust" ? "授权:永久" : auth === "session" ? "授权:本次会话" : "只读";
  const elapsed = ok && env.elapsedMs !== undefined ? ` · ${Math.round(env.elapsedMs / 1000)}s` : "";
  const text = ok
    ? `verdict: ${env.verdict} · ${authLabel}${elapsed}\nsummary: ${env.summary}\n` +
      (env.facts ?? []).map((f: any) => `[${f.classification}] ${f.source}: ${f.summary}${f.expected !== undefined ? `\n  expected: ${JSON.stringify(f.expected)}` : ""}${f.actual !== undefined ? `\n  actual: ${JSON.stringify(f.actual)}` : ""}`).join("\n") +
      (env.nextSteps?.length ? `\nnext:\n${env.nextSteps.map((s: string) => `  - ${s}`).join("\n")}` : "")
    : output.slice(0, 4000);
  return {
    content: [{ type: "text" as const, text: text.slice(0, 6000) }],
    details: { verdict: ok ? env.verdict : "ERROR", ...(ok ? { kind: env.kind, facts: (env.facts ?? []).length, elapsedMs: env.elapsedMs, auth } : {}) },
  };
}

// ===== 持久授权（trust.json）=====
// 设计目标：安装时/首次使用时授权一次，此后不再打断；删除 trust.json 对应条目即撤销。
interface TrustFile {
  version: number;
  granted: Record<string, boolean>;
  grantedAt: string;
}

function readTrust(): TrustFile | null {
  try {
    if (!existsSync(TRUST_FILE)) return null;
    const data = JSON.parse(readFileSync(TRUST_FILE, "utf8"));
    if (data && typeof data === "object" && data.version === 1 && data.granted) return data;
  } catch { /* 损坏视为未授权 */ }
  return null;
}

function writeTrust(granted: Record<string, boolean>) {
  const trust: TrustFile = { version: 1, granted, grantedAt: new Date().toISOString() };
  writeFileSync(TRUST_FILE, JSON.stringify(trust, null, 2));
}

interface LeaseEntry { project: string; action: string; until: number }
const leases = new Map<string, LeaseEntry>();

function leaseKey(family: string, action: string, project: string) {
  return `${family}:${action}:${project}`;
}

// 返回授权状态；null = 放行；字符串 = 拒绝原因
async function requireConfirmation(
  ctx: ExtensionContext,
  family: string,
  action: string,
  project: string,
  precheck: string,
): Promise<{ denied?: string; auth: "none" | "trust" | "session" }> {
  const risk = (TOOL_FAMILIES as any)[family] ?? "none";
  if (risk === "none") return { auth: "none" };
  if (!ctx.hasUI) return { denied: "无 UI 环境：写入类操作被拒绝（策略要求授权）", auth: "none" };

  // 持久授权：安装时/首次使用时已同意 → 直接放行
  const trust = readTrust();
  if (trust?.granted[risk] === true) return { auth: "trust" };

  // 会话 lease（用户选了"仅本次会话"时）
  const key = leaseKey(family, action, project);
  const existing = leases.get(key);
  if (existing && existing.until > Date.now()) return { auth: "session" };

  // 首次授权对话框：永久 / 本次会话 / 拒绝（300s 宽松窗口，超时即拒绝）
  const label = RISK_LABELS[risk] ?? risk;
  let choice: string | undefined;
  try {
    choice = await Promise.race([
      ctx.ui.select(`Phaser Flight Deck 写入授权（首次）`, [
        `永久授权：${label}（写入 trust.json，删除即撤销）`,
        "仅本次会话（120 秒内同类操作不再询问）",
        "拒绝",
      ]),
      new Promise<string | undefined>((resolvePromise) => setTimeout(() => resolvePromise(undefined), GRANT_DIALOG_TIMEOUT_MS)),
    ]);
  } catch { choice = undefined; }

  if (choice?.startsWith("永久授权")) {
    const current = readTrust()?.granted ?? {};
    writeTrust({ ...current, [risk]: true });
    return { auth: "trust" };
  }
  if (choice?.startsWith("仅本次会话")) {
    leases.set(key, { project, action, until: Date.now() + LEASE_MS });
    return { auth: "session" };
  }
  return { denied: choice?.startsWith("拒绝") ? "用户拒绝授权" : "授权对话框超时（默认拒绝）", auth: "none" };
}

export default function phaserFlightDeck(pi: ExtensionAPI) {
  pi.registerTool({
    name: "pdeck_project",
    label: "Phaser Project",
    description:
      "Detect or diagnose the active trusted Phaser project. action=detect locates the project; action=doctor runs the health assessment: installed engine version vs npm registry (release quiet-period awareness), toolchain presence, and core-logic isolation from Phaser imports.",
    parameters: Type.Object({
      action: fieldSchema("action"),
      project: fieldSchema("project"),
      timeout: fieldSchema("timeout"),
      offline: fieldSchema("offline"),
      severity: fieldSchema("severity"),
    }),
    async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, ctx: ExtensionContext) {
      const gate = await requireConfirmation(ctx, "pdeck_project", params.action ?? "doctor", params.project ?? ctx.cwd, "doctor 为只读操作");
      if (gate.denied) return { content: [{ type: "text" as const, text: `拒绝执行: ${gate.denied}` }], details: { verdict: "CANCELLED" } };
      const output = await runCli("doctor", params, params.timeout ?? 60);
      return toolResult(output, gate.auth);
    },
  });

  pi.registerTool({
    name: "pdeck_check",
    label: "Phaser Check",
    description:
      "Static-scan a Phaser project's sources for removed/changed v4 APIs (setTintFill, Math.PI2, Geom.Point, Struct.Set/Map, FX, BitmapMask, Light2D pipeline, Mesh/Plane, TAU semantics, addCanvas usage risks) and unresolved texture-key references. Read-only; returns a bounded result envelope.",
    parameters: Type.Object({
      project: fieldSchema("project"),
      timeout: fieldSchema("timeout"),
      severity: fieldSchema("severity"),
      file: fieldSchema("file"),
    }),
    async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, _ctx: ExtensionContext) {
      const output = await runCli("check", params, params.timeout ?? 60);
      return toolResult(output);
    },
  });

  pi.registerTool({
    name: "pdeck_api",
    label: "Phaser API",
    description:
      "Query the bundled phaser.d.ts type definitions (the API oracle). mode=query searches declarations with doc context; mode=exists answers existence and cross-checks removed-API rules (types may contain stale declarations); mode=version reports the installed engine version.",
    parameters: Type.Object({
      mode: fieldSchema("mode"),
      query: fieldSchema("query"),
      project: fieldSchema("project"),
      timeout: fieldSchema("timeout"),
      depth: fieldSchema("depth"),
    }),
    async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, _ctx: ExtensionContext) {
      const output = await runCli("api", params, params.timeout ?? 60);
      return toolResult(output);
    },
  });

  pi.registerTool({
    name: "pdeck_validate",
    label: "Phaser Validate",
    description:
      "Run the narrow-to-broad verification ladder: declared-vs-installed version consistency → tsc --noEmit → production build → real browser (exactly one visible canvas, zero page errors, input reachability) → screenshot evidence into .pdeck/captures. First hard failure is the decisive stage; missing preconditions return INCONCLUSIVE. Writes only into .pdeck/ (generated-write).",
    parameters: Type.Object({
      project: fieldSchema("project"),
      timeout: fieldSchema("timeout"),
      capture: fieldSchema("capture"),
    }),
    async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, ctx: ExtensionContext) {
      const gate = await requireConfirmation(ctx, "pdeck_validate", "verify", params.project ?? ctx.cwd,
        "verify 将执行 tsc/构建并在真实浏览器中打开游戏，截图与报告写入项目 .pdeck/ 目录。");
      if (gate.denied) return { content: [{ type: "text" as const, text: `拒绝执行: ${gate.denied}` }], details: { verdict: "CANCELLED" } };
      const output = await runCli("verify", params, params.timeout ?? 300);
      return toolResult(output, gate.auth);
    },
  });

  pi.registerTool({
    name: "pdeck_run",
    label: "Phaser Run",
    description:
      "Dev server lifecycle and headless browser observation. runAction=serve starts/stops the project dev server (port pre-check refuses foreign-occupied ports, dual-stack HTTP verification); snapshot takes a screenshot; console collects page/console errors with benign-404 filtering; probe queries window.__pdeck runtime state; watch streams a bounded observation window.",
    parameters: Type.Object({
      runAction: fieldSchema("runAction"),
      project: fieldSchema("project"),
      url: fieldSchema("url"),
      output: fieldSchema("output"),
      port: fieldSchema("port"),
      stop: fieldSchema("stop"),
      seconds: fieldSchema("seconds"),
      viewport: fieldSchema("viewport"),
      query: fieldSchema("query"),
      timeout: fieldSchema("timeout"),
    }),
    async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, ctx: ExtensionContext) {
      const action = params.runAction ?? "serve";
      const writes = action === "snapshot";
      const gate = await requireConfirmation(ctx, "pdeck_run", action, params.project ?? ctx.cwd,
        writes ? "snapshot 将把截图写入 .pdeck/captures。" : `${action} 为只读观察（serve 会启动/停止本项目的 dev server）。`);
      if (gate.denied) return { content: [{ type: "text" as const, text: `拒绝执行: ${gate.denied}` }], details: { verdict: "CANCELLED" } };
      const output = await runCli("run", params, params.timeout ?? 120);
      return toolResult(output, gate.auth);
    },
  });

  pi.registerTool({
    name: "pdeck_init",
    label: "Phaser Init",
    description:
      "Conservative project scaffold (dry-run by default). Template: Phaser 4.2.1 pinned + Vite + TS with core-logic isolation, diagnostic scene and headless tests. Stops before writes on non-empty targets or existing package.json. NEVER runs npm install. apply=true commits after confirmation (project-write).",
    parameters: Type.Object({
      project: fieldSchema("project"),
      apply: fieldSchema("apply"),
      timeout: fieldSchema("timeout"),
    }),
    async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, ctx: ExtensionContext) {
      let auth = "none";
      if (params.apply) {
        const gate = await requireConfirmation(ctx, "pdeck_init", "apply", params.project ?? ctx.cwd,
          "init --apply 将向目标目录写入模板文件（package.json/tsconfig/vite 配置/源代码骨架）。目标须为空或仅含 .git/README。");
        if (gate.denied) return { content: [{ type: "text" as const, text: `拒绝执行: ${gate.denied}` }], details: { verdict: "CANCELLED" } };
        auth = gate.auth;
      }
      const output = await runCli("init", params, 60);
      return toolResult(output, auth);
    },
  });

  pi.registerTool({
    name: "pdeck_evidence",
    label: "Phaser Evidence",
    description: "Inspect bounded verification evidence freshness (.pdeck/reports). Read-only.",
    parameters: Type.Object({
      project: fieldSchema("project"),
      limit: fieldSchema("limit"),
      timeout: fieldSchema("timeout"),
    }),
    async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, _ctx: ExtensionContext) {
      const output = await runCli("evidence", params, 60);
      return toolResult(output);
    },
  });

  pi.registerTool({
    name: "pdeck_vendor",
    label: "Phaser Vendor Skills",
    description:
      "Vendor official Phaser skills from phaserjs/phaser at a pinned tag into this tool's skills/vendor directory (host-write, always confirmed). Official skills are 4.0-baseline; use alongside the session-empirical main skill.",
    parameters: Type.Object({
      tag: fieldSchema("tag"),
      timeout: fieldSchema("timeout"),
    }),
    async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, ctx: ExtensionContext) {
      const gate = await requireConfirmation(ctx, "pdeck_vendor", "vendor-skills", "<tool>",
        `vendor-skills 将用 git clone（tag ${params.tag ?? "v4.2.1"}）更新本工具 skills/vendor/ 目录（host-write）。`);
      if (gate.denied) return { content: [{ type: "text" as const, text: `拒绝执行: ${gate.denied}` }], details: { verdict: "CANCELLED" } };
      const output = await runCli("vendor-skills", params, 120);
      return toolResult(output, gate.auth);
    },
  });

  pi.registerTool({
    name: "pdeck_visual",
    label: "Phaser Visual",
    description:
      "Visual regression for Phaser games. visualAction=baseline captures a reference screenshot (.pdeck/baselines/<name>.png) from dist or a running URL; visualAction=test captures the current screen and compares pixel-by-pixel against the baseline (browser-decoded PNG, threshold 16 default, tolerance 0.02 default). generated-write risk; writes only into .pdeck/.",
    parameters: Type.Object({
      visualAction: fieldSchema("visualAction"),
      name: fieldSchema("name"),
      project: fieldSchema("project"),
      url: fieldSchema("url"),
      viewport: fieldSchema("viewport"),
      tolerance: fieldSchema("tolerance"),
      threshold: fieldSchema("threshold"),
      timeout: fieldSchema("timeout"),
    }),
    async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, ctx: ExtensionContext) {
      const action = params.visualAction ?? "baseline";
      const gate = await requireConfirmation(ctx, "pdeck_visual", action, params.project ?? ctx.cwd,
        `${action} 将把截图/基线写入项目 .pdeck/（baselines 与 captures）。`);
      if (gate.denied) return { content: [{ type: "text" as const, text: `拒绝执行: ${gate.denied}` }], details: { verdict: "CANCELLED" } };
      const output = await runCli(action === "baseline" ? "baseline" : "visual-test", params, params.timeout ?? 120);
      return toolResult(output, gate.auth);
    },
  });

  pi.registerTool({
    name: "pdeck_simulate",
    label: "Phaser Simulate",
    description:
      "Balance simulation gate for Phaser projects. simulateAction=check runs the project's test/simulate harness (SIM_HOURS env, JSON report to stdout) and verifies level/region/realm/kills stay inside .pdeck/simulate.json bands; simulateAction=profile generates the bands (±30%) from one run. check is read-only (none risk); profile writes .pdeck/simulate.json (generated-write).",
    parameters: Type.Object({
      simulateAction: fieldSchema("simulateAction"),
      project: fieldSchema("project"),
      hours: fieldSchema("hours"),
      timeout: fieldSchema("timeout"),
    }),
    async execute(_toolCallId, params: ToolParams, _signal, _onUpdate, ctx: ExtensionContext) {
      const action = params.simulateAction ?? "check";
      if (action === "profile") {
        const gate = await requireConfirmation(ctx, "pdeck_simulate", "profile", params.project ?? ctx.cwd,
          "simulate-profile 将运行项目的模拟 harness 并写入 .pdeck/simulate.json（期望区间）。");
        if (gate.denied) return { content: [{ type: "text" as const, text: `拒绝执行: ${gate.denied}` }], details: { verdict: "CANCELLED" } };
        const output = await runCli("simulate-profile", params, params.timeout ?? 600);
        return toolResult(output, gate.auth);
      }
      const output = await runCli("simulate", params, params.timeout ?? 600);
      return toolResult(output, "none");
    },
  });

  pi.registerCommand("pdeck-doctor", {
    description: "Run pdeck doctor on the current Phaser project",
    handler: async (_args, ctx) => {
      const output = await runCli("doctor", { project: ctx.cwd, timeout: 60 }, 60);
      const { env, ok } = parseEnvelope(output);
      const text = ok ? `pdeck doctor → ${env.verdict}\n${env.summary}` : output.slice(0, 2000);
      ctx.ui.notify(text, ok && env.verdict === "FAILED" ? "error" : "info");
      return text;
    },
  });

  pi.registerCommand("pdeck-verify", {
    description: "Run pdeck verify on the current Phaser project (narrow-to-broad ladder)",
    handler: async (_args, ctx) => {
      const gate = await requireConfirmation(ctx, "pdeck_validate", "verify", ctx.cwd,
        "verify 将执行 tsc/构建/真实浏览器验证，证据写入项目 .pdeck/。");
      if (gate.denied) { ctx.ui.notify(`拒绝执行: ${gate.denied}`, "error"); return gate.denied; }
      const output = await runCli("verify", { project: ctx.cwd, timeout: 300 }, 300);
      const { env, ok } = parseEnvelope(output);
      ctx.ui.notify(ok ? `pdeck verify → ${env.verdict}${env.decisiveStage ? ` @ ${env.decisiveStage}` : ""}` : "verify 输出异常", ok && env.verdict === "FAILED" ? "error" : "info");
      return ok ? `pdeck verify → ${env.verdict}\n${env.summary}` : output.slice(0, 2000);
    },
  });

  pi.registerCommand("pdeck-authorize", {
    description: "Open the Phaser Flight Deck authorization dialog (grant write levels permanently; delete trust.json to revoke)",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return "无 UI 环境：无法交互授权（可手工编辑工具目录 trust.json）";
      const risk = (TOOL_FAMILIES as any);
      const summary = Object.entries(risk)
        .filter(([, level]) => level !== "none")
        .map(([family, level]) => `${family}: ${RISK_LABELS[level as string] ?? level}`)
        .join("\n");
      const choice = await ctx.ui.select("Phaser Flight Deck 授权级别（可多轮）", [
        "全部永久授权（generated-write + project-write + host-write）",
        "仅授权证据写入（generated-write：verify/run 截图报告）",
        "授权项目写入（project-write：init 脚手架）",
        "授权宿主写入（host-write：vendor 技能）",
        "查看当前授权状态",
        "取消",
      ]);
      const trust = readTrust();
      const current = trust?.granted ?? {};
      if (choice?.startsWith("全部永久授权")) {
        writeTrust({ ...current, "generated-write": true, "project-write": true, "host-write": true });
        ctx.ui.notify("已永久授权全部写入级别（删除 trust.json 撤销）", "info");
        return "已授权: generated-write + project-write + host-write";
      }
      if (choice?.startsWith("仅授权证据")) {
        writeTrust({ ...current, "generated-write": true });
        return "已授权: generated-write";
      }
      if (choice?.startsWith("授权项目")) {
        writeTrust({ ...current, "project-write": true });
        return "已授权: project-write";
      }
      if (choice?.startsWith("授权宿主")) {
        writeTrust({ ...current, "host-write": true });
        return "已授权: host-write";
      }
      if (choice?.startsWith("查看")) {
        return `当前授权: ${JSON.stringify(current)}${trust ? `（grantedAt ${trust.grantedAt}）` : "（无 trust.json，全部未授权）"}`;
      }
      return "已取消";
    },
  });
}
