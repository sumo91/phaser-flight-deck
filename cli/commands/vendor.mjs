// ===== pdeck vendor-skills：vendor 官方 Phaser skills（host-write，扩展确认门管理）=====
// 从 phaserjs/phaser 仓库指定 tag 复制 skills/ 到本工具 skills/vendor/。
// 官方技能基于 4.0 基线编写；与 4.2.1 实测对照使用（见自研主技能）。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { envelope, fact, inconclusiveEnvelope } from '../result-envelope.mjs';

const VENDOR_DIR = fileURLToPath(new URL('../../skills/vendor/', import.meta.url));

function runGit(args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn('git', args, { cwd, shell: process.platform === 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolvePromise({ ok: false, error: `git 不可用: ${error.message}` }));
    child.on('close', (code) => resolvePromise({ ok: code === 0, error: code === 0 ? null : stderr.slice(0, 300) }));
  });
}

export async function vendorSkills(args, options) {
  const { tag = 'v4.2.1', timeout = 120 } = options;
  if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    return inconclusiveEnvelope('vendor-skills', `tag 格式需为 vX.Y.Z（收到: ${tag}）`, ['pdeck vendor-skills --tag v4.2.1']);
  }
  const temp = join(tmpdir(), `phaser-skills-${Date.now()}`);
  mkdirSync(temp, { recursive: true });
  try {
    const clone = await runGit(['clone', '--depth', '1', '--branch', tag, 'https://github.com/phaserjs/phaser', temp], undefined);
    if (!clone.ok) {
      return inconclusiveEnvelope('vendor-skills', `git clone 失败: ${clone.error}`, ['确认 git 可用且网络可达 github.com，重试']);
    }
    const srcSkills = join(temp, 'skills');
    if (!existsSync(srcSkills)) {
      return inconclusiveEnvelope('vendor-skills', `tag ${tag} 仓库中无 skills/ 目录`, ['核对官方仓库结构后重试']);
    }
    const skills = readdirSync(srcSkills);
    mkdirSync(VENDOR_DIR, { recursive: true });
    let copied = 0;
    for (const name of skills) {
      const from = join(srcSkills, name);
      const to = join(VENDOR_DIR, name);
      rmSync(to, { recursive: true, force: true });
      cpSync(from, to, { recursive: true });
      copied++;
    }
    // 保留说明文件
    const readmeKeep = join(VENDOR_DIR, 'README.md');
    return envelope('PASSED', `已 vendor ${copied} 个官方技能（tag ${tag}）`, {
      kind: 'vendor-skills',
      facts: [
        fact('vendored', 'vendor-skills', `skills/vendor/ 已更新`, { actual: { tag, skills: skills.slice(0, 12) } }),
        fact('baseline_note', 'vendor-skills', '官方技能基于 4.0 基线编写，与 4.2.1 实测对照使用', { expected: readmeKeep }),
      ],
      nextSteps: ['阅读 skills/vendor/*/SKILL.md；以 skills/phaser4-flight-deck 的实测踩坑录为准'],
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
