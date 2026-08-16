// ===== 多宿主适配器生成器（零依赖）=====
// 从单一契约源（registry/commands.mjs）生成各宿主适配器包：
//   dist/claude-code/  skills + slash commands + hooks（PreToolUse 确认门）
//   dist/cursor/       commands 提示词入口（无 hooks，prompt 约定确认）
//   dist/codex/        skills（官方 skills 路径）
//   dist/MANIFEST.json 全部生成文件的 SHA-256（可校验）
// 设计原则（Phaser Project Toolkit 模式）：
//   适配器是提示层，不是逻辑层——CLI 永远是唯一执行核心；manual-only，不自动触发。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_COMMANDS } from '../registry/commands.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// --out <dir>：生成到指定目录（一致性测试用它生成临时副本与已提交的 dist 比对）
const outFlag = process.argv.indexOf('--out');
const DIST = outFlag >= 0 ? resolve(process.argv[outFlag + 1]) : join(ROOT, 'dist');
const SOURCE_SKILL = join(ROOT, 'skills', 'phaser4-flight-deck', 'SKILL.md');
const FENCE = ['`', '`', '`'].join(''); // 代码围栏，拼接法避免模板字符串转义地狱

function readVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

// ===== 关键工作流命令（跨宿主一致的入口）=====
const WORKFLOW_COMMANDS = [
  {
    id: 'pdeck-regression',
    title: '全量回归',
    trigger: '当用户要求"全量回归 / 完整验证 / 上线前检查"时',
    command: 'pdeck regression <项目目录> --timeout 600',
    read: 'verdict=FAILED 时按 decisiveStage 修；INCONCLUSIVE=缺前置（基线/剖面）',
    risk: '写入 .pdeck 证据（首次需确认）',
  },
  {
    id: 'pdeck-verify',
    title: '验证阶梯',
    trigger: '当用户要求"验证 / verify / 检查能不能跑"时',
    command: 'pdeck verify <项目目录>',
    read: 'tsc→build→browser 任一阶段 FAILED 即失败；缺 Chrome/构建产物为 INCONCLUSIVE',
    risk: '写入 .pdeck 证据（首次需确认）',
  },
  {
    id: 'pdeck-doctor',
    title: '项目体检',
    trigger: '当用户要求"检查项目健康 / 版本对不对 / 环境就绪"时',
    command: 'pdeck doctor <项目目录>',
    read: '只读；version_current 与 release_quiet 事实最值得看',
    risk: '只读，无风险',
  },
  {
    id: 'pdeck-check',
    title: 'v4 API 扫描',
    trigger: '当用户要求"扫描 API / 检查 v4 兼容性 / 找已移除 API"时',
    command: 'pdeck check <项目目录>',
    read: 'removed_api（error 级）必须修；api_warning 是实测坑提醒',
    risk: '只读，无风险',
  },
];

// ===== 命令速查表（从 registry 自动生成）=====
function commandsTable() {
  const rows = Object.entries(CLI_COMMANDS)
    .filter(([name]) => !['help', 'version', 'describe'].includes(name))
    .map(([name, cmd]) => `| \`pdeck ${name}\` | ${cmd.summary} |`)
    .join('\n');
  return `| 命令 | 职责 |\n|---|---|\n${rows}`;
}

// ===== SKILL.md 生成（源技能 + 注入宿主段）=====
function hostNote(host) {
  if (host === 'claude-code') {
    return `## 宿主接入：Claude Code

- 技能路径：\`~/.claude/skills/phaser-flight-deck/\` 或项目 \`.claude/skills/\`
- 快捷命令：\`/pdeck-regression\` · \`/pdeck-verify\` · \`/pdeck-doctor\` · \`/pdeck-check\`（见 commands/）
- **确认门**：本包 hooks/pre_tool_use 示例拦截写入类命令（init --apply / vendor-skills / baseline / simulate-profile），
  首次使用前把 settings.json 示例合入 \`~/.claude/settings.json\`；
  未装 hooks 时，写入类命令执行前必须先向用户说明并获同意`;
  }
  if (host === 'cursor') {
    return `## 宿主接入：Cursor

- 命令文件：复制 dist/cursor/commands/ 到项目 \`.cursor/commands/\`（或全局）
- **确认门**：Cursor 无 hooks——写入类命令（init --apply / vendor-skills / baseline / simulate-profile）
  执行前必须先向用户说明并获同意（prompt 约定）`;
  }
  return `## 宿主接入：Codex

- 技能路径：\`$HOME/.agents/skills/phaser-flight-deck/\`
- **确认门**：prompt 约定——写入类命令执行前必须先向用户说明并获同意`;
}

function generateSkill(host) {
  const source = readFileSync(SOURCE_SKILL, 'utf8');
  // 在 frontmatter 后注入 pdeck 调用方式 + 命令表 + 宿主接入
  const version = readVersion();
  const injection = `

## pdeck 调用方式（宿主无关）

${FENCE}bash
pdeck <command> [args] --json          # 若 pdeck 已 npm link/在 PATH
node <phaser-flight-deck目录>/cli/pdeck.mjs <command> [args] --json   # 兑底直调
${FENCE}

所有命令输出有界 Result Envelope（PASSED/FAILED/INCONCLUSIVE/CANCELLED + facts + nextSteps）。
契约查询：\\\`pdeck describe <command> --json\\\`。

${commandsTable()}

${hostNote(host)}

_本文件由 scripts/generate-adapters.mjs 自动生成（v${version}），勿手改；源文件 skills/phaser4-flight-deck/SKILL.md。_
`;
  // 插入到 frontmatter 之后
  const marker = source.indexOf('\n---\n') + 5;
  return source.slice(0, marker) + injection + source.slice(marker);
}

// ===== slash command 文件生成 =====
function generateCommandFile(entry, host) {
  const confirmLine = host === 'claude-code'
    ? '> 确认门：写入类操作需 hooks 或用户明确同意（见 hooks/）。'
    : '> 确认门（prompt 约定）：若该命令涉及写入（见风险），执行前必须向用户说明并获同意。';
  return `# ${entry.title}（${entry.id}）

**触发**：${entry.trigger}

**执行**：

${FENCE}bash
${entry.command}
${FENCE}

若 \`pdeck\` 不在 PATH：\`node <phaser-flight-deck目录>/cli/pdeck.mjs\` 替换 \`pdeck\`。

**结果解读**：${entry.read}

**风险**：${entry.risk}

${confirmLine}
`;
}

// ===== Claude Code hooks =====
const CLAUDE_HOOK = `#!/usr/bin/env node
// Phaser Flight Deck 写入类命令确认钩子（Claude Code PreToolUse）
// 用法：把 dist/claude-code/hooks/settings.json 示例合入 ~/.claude/settings.json
import { stdin as input } from 'node:process';

let raw = '';
for await (const chunk of input) raw += chunk;

const event = JSON.parse(raw || '{}');
const toolName = event.tool_name;
const command = String(event.tool_input?.command ?? '');

const WRITE_RISK_PATTERNS = [
  /pdeck\\s+init[^\\n]*--apply/,
  /pdeck\\s+vendor-skills/,
  /pdeck\\s+baseline/,
  /pdeck\\s+simulate-profile/,
];

if (toolName === 'Bash' && WRITE_RISK_PATTERNS.some((pattern) => pattern.test(command))) {
  console.error(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: 'Phaser Flight Deck 写入类操作需要用户确认（风险分级见 registry/commands.mjs）',
    },
  }));
  process.exit(2);
}
process.exit(0);
`;

const CLAUDE_SETTINGS = `{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node <本目录>/dist/claude-code/hooks/pdeck-confirm.mjs"
          }
        ]
      }
    ]
  }
}
`;

// ===== 主生成流程 =====
function generate() {
  const version = readVersion();
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const manifest = {};
  const emit = (rel, content) => {
    const full = join(DIST, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
    manifest[rel] = createHash('sha256').update(content).digest('hex');
  };

  const hosts = ['claude-code', 'cursor', 'codex'];
  for (const host of hosts) {
    emit(`${host}/skills/phaser-flight-deck/SKILL.md`, generateSkill(host));
    if (host !== 'codex') {
      for (const entry of WORKFLOW_COMMANDS) {
        emit(`${host}/commands/${entry.id}.md`, generateCommandFile(entry, host));
      }
    }
  }

  // Claude Code hooks（仅此宿主有权限拦截能力）
  emit('claude-code/hooks/pdeck-confirm.mjs', CLAUDE_HOOK);
  emit('claude-code/hooks/settings.json.example', CLAUDE_SETTINGS);

  // 安装说明
  const installNote = `# 多宿主适配器包（自动生成，勿手改）

生成命令：\`npm run generate\`（源：registry/commands.mjs + skills/phaser4-flight-deck/SKILL.md）
版本：${version}

| 宿主 | 安装 |
|---|---|
| Claude Code | 复制 \`claude-code/skills/phaser-flight-deck\` 到 \`~/.claude/skills/\`；commands 到 \`~/.claude/commands/\`；hooks 按 settings.json.example 合入 |
| Cursor | 复制 \`cursor/commands/\` 到项目 \`.cursor/commands/\`；技能放 \`.cursor/skills/\` 或直接引用 |
| Codex | 复制 \`codex/skills/phaser-flight-deck\` 到 \`$HOME/.agents/skills/\` |
`;
  emit('README.md', installNote);

  // 不含时间戳：产物完全确定性——源未变则重新生成零 diff（否则每次 npm run generate 都弄脏工作区）
  emit('MANIFEST.json', JSON.stringify({ version, files: manifest }, null, 2));
  console.log(`已生成 ${Object.keys(manifest).length} 个适配器文件（v${version}）`);
}

generate();
