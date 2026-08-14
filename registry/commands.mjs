// ===== Phaser Flight Deck 单一命令契约 =====
// CLI 参数、Pi Tool Schema、帮助文本的唯一来源。
// CLI 与 Pi 扩展共用本文件，任何新增命令/选项只在这里声明。

const option = (takesValue, valueName, description, extra = {}) => ({ takesValue, valueName, description, ...extra });

export const CLI_OPTIONS = Object.freeze({
  json: option(false, '', 'Emit JSON (result envelope)'),
  timeout: option(true, 'SECONDS', 'Wall-clock timeout'),
  project: option(true, 'PATH', 'Phaser project directory (defaults to cwd)'),
  file: option(true, 'PATH', 'Check a single file instead of the whole project'),
  offline: option(false, '', 'Skip npm registry network lookups'),
  severity: option(true, 'LEVEL', 'Failure severity threshold', { values: ['warn', 'error'] }),
  depth: option(true, 'N', 'API query result detail lines'),
  quiet: option(false, '', 'Suppress non-essential output'),
  url: option(true, 'URL', 'Target URL for browser observation (default: dev server URL)'),
  output: option(true, 'FILE', 'Screenshot output path'),
  port: option(true, 'N', 'Dev server port'),
  stop: option(false, '', 'Stop the running dev server'),
  seconds: option(true, 'N', 'Observation window seconds'),
  viewport: option(true, 'WxH', 'Browser viewport (default 1280x800)'),
  capture: option(false, '', 'Capture screenshot evidence during verify'),
  apply: option(false, '', 'Commit a write operation (init: write template files)'),
  'dry-run': option(false, '', 'Validate without committing'),
  tag: option(true, 'TAG', 'Git tag of the phaser repo to vendor skills from'),
  limit: option(true, 'N', 'Evidence index result limit'),
  query: option(true, 'JSON', 'Runtime probe query JSON list (window.__pdeck keys)'),
  tolerance: option(true, 'N', 'Visual changed-pixel ratio limit (default 0.02)'),
  threshold: option(true, 'N', 'Visual per-channel difference threshold 0-255 (default 16)'),
  hours: option(true, 'N', 'Simulation hours (default 48)'),
});

const positional = (name, required = false, description = '') => ({ name, required, description });
const command = (summary, usage, options = [], positionals = [], extra = {}) => ({
  summary, usage, options, positionals,
  minimumPositionals: positionals.filter((item) => item.required).length,
  maximumPositionals: positionals.length, ...extra,
});

export const CLI_COMMANDS = Object.freeze({
  help: command('Show command help', 'pdeck help [command]', [], [positional('command')]),
  version: command('Print the Phaser Flight Deck version', 'pdeck version'),
  describe: command('Describe a command contract', 'pdeck describe <command> [--json]', ['json'], [positional('command', true)]),
  doctor: command('Assess Phaser project health: engine version vs registry, toolchain, architecture isolation', 'pdeck doctor [project] [--json] [--offline] [--severity warn|error]', ['json', 'project', 'offline', 'severity', 'timeout'], [positional('project')]),
  check: command('Static-scan source for removed/changed Phaser v4 APIs and unresolved texture keys', 'pdeck check [project] [--file PATH] [--json] [--severity warn|error]', ['json', 'project', 'file', 'severity', 'timeout'], [positional('project')]),
  api: command('Query the bundled Phaser type definitions (d.ts oracle)', 'pdeck api <query|exists|version> [query-text] [project] [--depth N] [--json]', ['json', 'project', 'depth', 'timeout'], [positional('mode', true), positional('query'), positional('project')]),
  verify: command('Run the narrow-to-broad verification ladder: version consistency → tsc → build → real browser (canvas/console/input) → screenshot evidence', 'pdeck verify [project] [--json] [--timeout SECONDS] [--no-capture]', ['json', 'project', 'timeout', 'capture'], [positional('project')]),
  run: command('Dev server lifecycle and headless browser observation', 'pdeck run <serve|snapshot|console|probe|watch> [url|project] [--json] [--timeout SECONDS]', ['json', 'project', 'url', 'output', 'port', 'stop', 'seconds', 'viewport', 'timeout', 'query'], [positional('action', true, 'serve|snapshot|console|probe|watch'), positional('target', false, 'serve: 项目路径；其余动作: 目标 URL')], {
    defaultAction: 'serve',
    actions: {
      serve: { usage: 'pdeck run serve [project] [--port N] [--stop]', options: ['project', 'port', 'stop', 'json'], minimumPositionals: 1, maximumPositionals: 2 },
      snapshot: { usage: 'pdeck run snapshot <url> [project] [--output FILE] [--viewport WxH]', options: ['url', 'project', 'output', 'viewport', 'json', 'timeout'], minimumPositionals: 2, maximumPositionals: 3 },
      console: { usage: 'pdeck run console <url> [--seconds N]', options: ['url', 'seconds', 'json', 'timeout'], minimumPositionals: 2, maximumPositionals: 2 },
      probe: { usage: 'pdeck run probe <url> --query JSON', options: ['url', 'query', 'json', 'timeout'], minimumPositionals: 2, maximumPositionals: 2 },
      watch: { usage: 'pdeck run watch <url> [--seconds N]', options: ['url', 'seconds', 'json', 'timeout'], minimumPositionals: 2, maximumPositionals: 2 },
    },
  }),
  init: command('Conservative project scaffold (dry-run by default; --apply commits; never runs npm install)', 'pdeck init [project] [--apply] [--json]', ['json', 'project', 'apply'], [positional('project')]),
  baseline: command('Capture a visual regression baseline screenshot', 'pdeck baseline <name> [project] [--url URL] [--viewport WxH]', ['json', 'project', 'url', 'viewport', 'timeout'], [positional('name', true, '基准名（[A-Za-z0-9_-]）'), positional('project')]),
  'visual-test': command('Compare the current screen against a visual baseline (pixel diff, browser-decoded)', 'pdeck visual-test <name> [project] [--url URL] [--tolerance N] [--threshold N] [--viewport WxH]', ['json', 'project', 'url', 'viewport', 'tolerance', 'threshold', 'timeout'], [positional('name', true, '基准名'), positional('project')]),
  simulate: command('Run the project balance-simulation harness and check against the .pdeck profile bands (balance regression gate)', 'pdeck simulate [project] [--hours N] [--json] [--timeout SECONDS]', ['json', 'project', 'hours', 'timeout'], [positional('project')]),
  'simulate-profile': command('Generate the balance profile (.pdeck/simulate.json, ±30% bands) from one simulation run', 'pdeck simulate-profile [project] [--hours N] [--json] [--timeout SECONDS]', ['json', 'project', 'hours', 'timeout'], [positional('project')]),
  evidence: command('Inspect bounded verification evidence freshness (read-only)', 'pdeck evidence [project] [--limit N] [--json]', ['json', 'project', 'limit', 'timeout'], [positional('project')]),
  'vendor-skills': command('Vendor official Phaser skills from the phaserjs/phaser repo at a pinned tag (host-write)', 'pdeck vendor-skills [--tag v4.2.1] [--json]', ['json', 'tag', 'timeout'], []),
});

const field = (kind, options = {}) => ({ kind, optional: true, ...options });

// Pi 工具参数 Schema（薄封装扩展用它构建 typebox）
export const PI_FIELDS = Object.freeze({
  action: field('enum', {
    values: ['detect', 'doctor'],
    description: 'detect: locate the active trusted Phaser project; doctor: run the project health assessment',
  }),
  project: field('string', { description: 'Path inside the active trusted Phaser project; defaults to Pi cwd' }),
  timeout: field('number', { minimum: 1, maximum: 900, description: 'Wall-clock timeout in seconds' }),
  offline: field('boolean', { description: 'Skip npm registry network lookups' }),
  severity: field('enum', { values: ['warn', 'error'], description: 'Failure severity threshold for check/doctor' }),
  file: field('string', { maxLength: 512, description: 'Check a single file instead of the whole project' }),
  mode: field('enum', {
    values: ['query', 'exists', 'version', 'describe'],
    description: 'query: full-text search in phaser.d.ts; exists: boolean existence fact; version: installed engine version; describe: pdeck command contract (usage/options/positionals)',
  }),
  query: field('string', { maxLength: 200, description: 'Search text for api query/exists modes' }),
  depth: field('integer', { minimum: 1, maximum: 60, description: 'API query result detail lines' }),
  url: field('string', { maxLength: 512, description: 'Target URL for browser observation' }),
  output: field('string', { maxLength: 512, description: 'Screenshot output path' }),
  port: field('integer', { minimum: 1024, maximum: 65535, description: 'Dev server port' }),
  stop: field('boolean', { description: 'Stop the running dev server' }),
  seconds: field('integer', { minimum: 1, maximum: 60, description: 'Observation window seconds' }),
  viewport: field('string', { maxLength: 20, description: 'Browser viewport WxH (default 1280x800)' }),
  capture: field('boolean', { description: 'Capture screenshot evidence during verify' }),
  apply: field('boolean', { description: 'Commit a write operation (init)' }),
  tag: field('string', { maxLength: 40, description: 'Git tag of the phaser repo to vendor skills from' }),
  limit: field('integer', { minimum: 1, maximum: 24, description: 'Evidence index result limit' }),
  name: field('string', { minLength: 1, maxLength: 60, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$', description: 'Visual baseline name' }),
  tolerance: field('number', { minimum: 0, maximum: 1, description: 'Visual changed-pixel ratio limit (default 0.02)' }),
  threshold: field('number', { minimum: 0, maximum: 255, description: 'Visual per-channel difference threshold (default 16)' }),
  hours: field('integer', { minimum: 1, maximum: 720, description: 'Simulation hours (default 48)' }),
  runAction: field('enum', {
    values: ['serve', 'snapshot', 'console', 'probe', 'watch'],
    description: 'pdeck_run action: serve dev server lifecycle; snapshot screenshot; console error collection; probe runtime state via window.__pdeck; watch streamed observation',
  }),
  visualAction: field('enum', {
    values: ['baseline', 'test'],
    description: 'pdeck_visual action: baseline capture a reference screenshot; test compare current screen against the baseline (pixel diff)',
  }),
  simulateAction: field('enum', {
    values: ['check', 'profile'],
    description: 'pdeck_simulate action: check run the simulation harness against profile bands; profile generate .pdeck/simulate.json bands from one run',
  }),
});

// 工具家族 → 风险分级（扩展确认门依据）
export const TOOL_FAMILIES = Object.freeze({
  pdeck_project: 'none',
  pdeck_check: 'none',
  pdeck_api: 'none',
  pdeck_evidence: 'none',
  pdeck_validate: 'generated-write',   // verify 写 .pdeck/captures 与 reports
  pdeck_run: 'generated-write',        // snapshot 写截图；serve/console/watch 实为只读
  pdeck_init: 'project-write',         // 写项目模板文件
  pdeck_vendor: 'host-write',          // 写工具自身 skills/vendor
  pdeck_visual: 'generated-write',     // baseline/visual-test 写 .pdeck/baselines 与 captures
  pdeck_simulate: 'none',              // 运行项目自己的测试 harness（同 npm test 信任级别）；profile 动作由扩展按 generated-write 处理
});

// 命令 → 执行模块
export const COMMAND_MODULES = Object.freeze({
  doctor: 'doctor',
  check: 'check',
  api: 'api',
});
