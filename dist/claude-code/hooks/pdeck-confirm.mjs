#!/usr/bin/env node
// Phaser Flight Deck 写入类命令确认钩子（Claude Code PreToolUse）
// 用法：把 dist/claude-code/hooks/settings.json 示例合入 ~/.claude/settings.json
import { stdin as input } from 'node:process';

let raw = '';
for await (const chunk of input) raw += chunk;

const event = JSON.parse(raw || '{}');
const toolName = event.tool_name;
const command = String(event.tool_input?.command ?? '');

const WRITE_RISK_PATTERNS = [
  /pdeck\s+init[^\n]*--apply/,
  /pdeck\s+vendor-skills/,
  /pdeck\s+baseline/,
  /pdeck\s+simulate-profile/,
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
