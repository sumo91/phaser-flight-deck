// ===== Phaser 项目探测 =====
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function detectProject(dir = process.cwd()) {
  const root = resolve(dir);
  const packageJsonPath = join(root, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return { found: false, root, reason: 'no package.json — not an npm-managed project' };
  }
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    return { found: false, root, reason: `package.json unreadable: ${error.message}` };
  }
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  const declared = deps.phaser ?? null;
  const phaserPackagePath = join(root, 'node_modules', 'phaser', 'package.json');
  let installed = null;
  if (existsSync(phaserPackagePath)) {
    try {
      installed = JSON.parse(readFileSync(phaserPackagePath, 'utf8'));
    } catch { /* 读取失败视为未安装 */ }
  }
  const isPhaser = Boolean(declared || installed);
  return {
    found: isPhaser,
    root,
    reason: isPhaser ? undefined : 'no phaser dependency in package.json and no node_modules/phaser install',
    manifest,
    phaserDeclared: declared,
    phaserInstalled: installed?.version ?? null,
    phaserPackagePath,
    toolchain: {
      vite: existsSync(join(root, 'vite.config.ts')) || existsSync(join(root, 'vite.config.js')) || manifest.devDependencies?.vite,
      typescript: existsSync(join(root, 'tsconfig.json')) || manifest.devDependencies?.typescript,
      webpack: existsSync(join(root, 'webpack.config.js')),
      parcel: existsSync(join(root, '.parcelrc')),
    },
    scripts: manifest.scripts ?? {},
  };
}

// 逻辑目录隔离检查：core 目录不应 import phaser
export function isolationChecks(root) {
  const logicDirs = ['src/core'];
  const results = [];
  for (const dir of logicDirs) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    results.push({ dir, importingPhaser: scanDirForPhaserImport(abs) });
  }
  return results;
}

import { readdirSync, statSync } from 'node:fs';

function scanDirForPhaserImport(dir) {
  const hits = [];
  const walk = (current) => {
    let entries;
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = join(current, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) continue;
      try {
        const text = readFileSync(full, 'utf8');
        if (/import\s+.*['"]phaser['"]/m.test(text) || /require\s*\(\s*['"]phaser['"]\s*\)/m.test(text)) {
          hits.push(full);
        }
      } catch { /* 跳过不可读文件 */ }
    }
  };
  walk(dir);
  return hits;
}
