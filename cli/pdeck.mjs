#!/usr/bin/env node
// ===== Phaser Flight Deck CLI（零依赖执行核心）=====
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { CLI_COMMANDS, CLI_OPTIONS } from '../registry/commands.mjs';
import { failureEnvelope, renderEnvelope } from './result-envelope.mjs';

const VERSION = '0.4.2';

function parseArgv(argv) {
  const tokens = [...argv];
  const parsed = { command: null, positionals: [], options: {} };
  while (tokens.length) {
    const token = tokens.shift();
    if (token.startsWith('--')) {
      const name = token.slice(2);
      const spec = CLI_OPTIONS[name];
      if (!spec) throw new UsageError(`未知选项 --${name}（pdeck help 查看全部选项）`);
      if (spec.takesValue) {
        const value = tokens.shift();
        if (value === undefined || value.startsWith('--')) {
          throw new UsageError(`选项 --${name} 需要值 ${spec.valueName}`);
        }
        parsed.options[name] = value;
      } else {
        parsed.options[name] = true;
      }
    } else if (!parsed.command) {
      parsed.command = token;
    } else {
      parsed.positionals.push(token);
    }
  }
  return parsed;
}

function parseProject(parsed) {
  // project 来源优先级：--project > 命令声明中的 project 位置参数
  const options = { ...parsed.options };
  if (options.project) return options;
  const cmd = parsed.command ? CLI_COMMANDS[parsed.command] : null;
  if (!cmd) return options;
  const projectIndex = cmd.positionals.findIndex((p) => p.name === 'project');
  if (projectIndex < 0) return options;
  // 位置参数按声明顺序左到右填充槽位；只有 project 之前的槽位都已填满时，
  // 多出的参数才落入 project——否则 `api query <词>` 的查询文本会被吞成 project
  if (parsed.positionals.length > projectIndex) {
    options.project = parsed.positionals.splice(projectIndex, 1)[0];
  }
  return options;
}

function helpText(commandName) {
  if (!commandName) {
    const lines = ['Phaser Flight Deck — Phaser 4 项目检查与验证工具', '', '用法: pdeck <command> [args] [--json]', '', '命令:'];
    for (const [name, cmd] of Object.entries(CLI_COMMANDS)) {
      if (['describe', 'help', 'version'].includes(name)) continue;
      lines.push(`  ${name.padEnd(14)} ${cmd.summary}`);
    }
    lines.push('', '导航: pdeck help [command] | pdeck describe <command> [--json] | pdeck version');
    return lines.join('\n');
  }
  const cmd = CLI_COMMANDS[commandName];
  if (!cmd) return `未知命令: ${commandName}\n\n${helpText()}`;
  const lines = [`${commandName} — ${cmd.summary}`, '', `用法: ${cmd.usage}`];
  if (cmd.positionals.length) {
    lines.push('', '参数:');
    for (const p of cmd.positionals) {
      lines.push(`  ${p.name}${p.required ? '（必需）' : '（可选）'} ${p.description}`);
    }
  }
  const opts = [...new Set(cmd.options)].map((o) => CLI_OPTIONS[o]).filter(Boolean);
  if (opts.length) {
    lines.push('', '选项:');
    for (const o of opts) {
      lines.push(`  --${cmd.options.find((name) => CLI_OPTIONS[name] === o)}${o.takesValue ? ` <${o.valueName}>` : ''}  ${o.description}${o.values ? `（${o.values.join('|')}）` : ''}`);
    }
  }
  return lines.join('\n');
}

class UsageError extends Error {}

const COMMANDS = {
  async doctor(args, options) {
    const { doctor } = await import('./commands/doctor.mjs');
    return doctor(args, options);
  },
  async check(args, options) {
    const { check } = await import('./commands/check.mjs');
    return check(args, options);
  },
  async api(args, options) {
    const { api } = await import('./commands/api.mjs');
    return api(args, options);
  },
  async verify(args, options) {
    const { verify } = await import('./commands/verify.mjs');
    return verify(args, options);
  },
  async run(args, options) {
    const { run } = await import('./commands/run.mjs');
    return run(args, options);
  },
  async init(args, options) {
    const { init } = await import('./commands/init.mjs');
    return init(args, options);
  },
  async evidence(args, options) {
    const { evidence } = await import('./commands/evidence.mjs');
    return evidence(args, options);
  },
  async 'vendor-skills'(args, options) {
    const { vendorSkills } = await import('./commands/vendor.mjs');
    return vendorSkills(args, options);
  },
  async baseline(args, options) {
    const { baseline } = await import('./commands/visual.mjs');
    return baseline(args, options);
  },
  async 'visual-test'(args, options) {
    const { visualTest } = await import('./commands/visual.mjs');
    return visualTest(args, options);
  },
  async simulate(args, options) {
    const { simulate } = await import('./commands/simulate.mjs');
    return simulate(args, options);
  },
  async 'simulate-profile'(args, options) {
    const { simulateProfile } = await import('./commands/simulate.mjs');
    return simulateProfile(args, options);
  },
  async regression(args, options) {
    const { regression } = await import('./commands/regression.mjs');
    return regression(args, options);
  },
};

async function main() {
  let parsed;
  try {
    parsed = parseArgv(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`用法错误: ${error.message}`);
      process.exit(2);
    }
    throw error;
  }

  const { command, positionals } = parsed;
  const options = parseProject(parsed);
  // run 嵌套动作：第一个位置参数为 action
  if (command === 'run' && positionals.length && !options.action) {
    const known = ['serve', 'snapshot', 'console', 'probe', 'watch', 'observe'];
    const first = positionals[0];
    if (known.includes(first)) {
      options.action = positionals.shift();
    }
  }
  const timeout = options.timeout ? Number(options.timeout) : undefined;
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 1 || timeout > 900)) {
    console.error('用法错误: --timeout 需为 1..900 的秒数');
    process.exit(2);
  }
  if (timeout) options.timeout = timeout;

  // 命令路由
  if (!command || command === 'help') {
    console.log(helpText(positionals[0]));
    return;
  }
  if (command === 'version') {
    console.log(`phaser-flight-deck ${VERSION}`);
    return;
  }
  if (command === 'describe') {
    const target = positionals[0];
    const cmd = CLI_COMMANDS[target];
    if (!cmd) {
      console.error(`未知命令: ${target}`);
      process.exit(2);
    }
    const desc = { name: target, summary: cmd.summary, usage: cmd.usage, positionals: cmd.positionals, options: cmd.options };
    console.log(options.json ? JSON.stringify(desc, null, 2) : helpText(target));
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`未知命令: ${command}\n\n${helpText()}`);
    process.exit(2);
  }

  // 执行 + 信封包装
  const start = Date.now();
  let env;
  try {
    env = await Promise.race([
      handler(positionals, options),
      new Promise((_, reject) => {
        const ms = (options.timeout ?? 60) * 1000;
        setTimeout(() => reject(Object.assign(new Error('command_timeout'), { resultClassification: 'timeout' })), ms);
      }),
    ]);
  } catch (error) {
    env = failureEnvelope(error.resultClassification ?? 'command_error', command, error.message, ['pdeck help 查看用法']);
  }
  if (env && typeof env === 'object' && 'verdict' in env) {
    env.elapsedMs = Date.now() - start;
    const text = renderEnvelope(env, { json: Boolean(options.json) });
    console.log(text);
    process.exit(env.verdict === 'FAILED' ? 1 : 0);
  }
  console.error('内部错误: 命令未返回结果信封');
  process.exit(1);
}

main().catch((error) => {
  console.error(renderEnvelope(failureEnvelope('internal_error', 'cli', error.message)));
  process.exit(1);
});
