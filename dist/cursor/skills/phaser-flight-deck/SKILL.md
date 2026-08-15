---
name: phaser4-flight-deck
description: >
  Phaser 4 项目开发主约定与实测踩坑录。用于：新建/维护 Phaser 4 项目时确立架构与验证流程；
  排查渲染卡死、纹理问题、场景生命周期 bug；搭建可无头模拟的核心逻辑层；
  使用 pdeck CLI（doctor/check/api）做健康检查与 API 事实查询。
  触发词：Phaser 4、phaser4、pdeck、纹理卡死、addCanvas、挂机模拟、无头验证。
---


## pdeck 调用方式（宿主无关）

```bash
pdeck <command> [args] --json          # 若 pdeck 已 npm link/在 PATH
node <phaser-flight-deck目录>/cli/pdeck.mjs <command> [args] --json   # 兑底直调
```

所有命令输出有界 Result Envelope（PASSED/FAILED/INCONCLUSIVE/CANCELLED + facts + nextSteps）。
契约查询：\`pdeck describe <command> --json\`。

| 命令 | 职责 |
|---|---|
| `pdeck doctor` | Assess Phaser project health: engine version vs registry, toolchain, architecture isolation |
| `pdeck check` | Static-scan source for removed/changed Phaser v4 APIs and unresolved texture keys |
| `pdeck api` | Query the bundled Phaser type definitions (d.ts oracle) |
| `pdeck verify` | Run the narrow-to-broad verification ladder: version consistency → tsc → build → real browser (canvas/console/input) → screenshot evidence |
| `pdeck run` | Dev server lifecycle and headless browser observation |
| `pdeck init` | Conservative project scaffold (dry-run by default; --apply commits; never runs npm install) |
| `pdeck baseline` | Capture a visual regression baseline screenshot |
| `pdeck visual-test` | Compare the current screen against a visual baseline (pixel diff, browser-decoded) |
| `pdeck simulate` | Run the project balance-simulation harness and check against the .pdeck profile bands (balance regression gate) |
| `pdeck simulate-profile` | Generate the balance profile (.pdeck/simulate.json, ±30% bands) from one simulation run |
| `pdeck regression` | Run the full regression composite: doctor → check → verify → simulate → visual-test → one bounded report (.pdeck/reports/regression-*.json|md) |
| `pdeck evidence` | Inspect bounded verification evidence freshness (read-only) |
| `pdeck vendor-skills` | Vendor official Phaser skills from the phaserjs/phaser repo at a pinned tag (host-write) |

## 宿主接入：Cursor

- 命令文件：复制 dist/cursor/commands/ 到项目 `.cursor/commands/`（或全局）
- **确认门**：Cursor 无 hooks——写入类命令（init --apply / vendor-skills / baseline / simulate-profile）
  执行前必须先向用户说明并获同意（prompt 约定）

_本文件由 scripts/generate-adapters.mjs 自动生成（v0.4.3），勿手改；源文件 skills/phaser4-flight-deck/SKILL.md。_

# Phaser 4 Flight Deck 主技能

## 架构约定（本项目铁律）

1. **核心逻辑零 Phaser 依赖**：战斗/数值/存档/掉落放 `src/core` 与 `src/data`，
   只 import 纯 TS 模块。收益：Node 里可无头模拟数天进度验证平衡（`npx tsx` 即可跑）。
   `pdeck doctor` 会检查 `src/core` 是否 import phaser（isolation_ok）。
2. **Phaser 只做渲染**：`src/scenes` 薄场景层，`src/ui` DOM 界面（面板/背包/技能表用 DOM 远比 Phaser 组件省力）。
3. **版本钉死**：`phaser@4.2.1`（2026-07-09 后进入发布静默期；稳定可用，别假设官方持续更新）。
4. **纹理 key 有纪律**：key 是裸字符串无类型安全；用统一的资源工厂（如 `getTex(key, fn)`）集中创建与缓存。

## 实测踩坑录（官方文档没有的，4.2.1 实测）

### 1. addCanvas 大纹理 = GPU ReadPixels 卡死（最危险）
`textures.addCanvas(key, bigCanvas)` 对 ≥256px 级纹理有 GPU 回读（readback）风险——
实测 1280×720 背景 Canvas 纹理把渲染线程卡死在原生 GL 调用：主线程冻结、
`Debugger.pause` 断不下来、页面无响应，控制台警告 `GPU stall due to ReadPixels`。
**对策**：大背景改用 `Graphics` 矢量绘制（fillPoints/山/渐变带）；addCanvas 只用于小纹理（角色/图标）。
`pdeck check` 会标记每个 addCanvas 使用点。

### 2. 纹理按"外观规格"缓存，别按唯一 id
按 spawnId/uid 生成纹理 key → 每击杀累积一张纹理（数小时泄漏）。
**对策**：key 由外观参数拼成（颜色+武器+形状），同类型怪物共享。

### 3. 场景生命周期顺序
`create()` 里用到的东西必须**先创建**。在对象创建前调用会抛
`Cannot read properties of undefined`，且 Phaser 吞掉异常进入半初始化状态（极难排查）。
先建环境粒子/占位纹理，再调 `applyBackground()` 之类的方法。

### 4. Scene 保留名冲突
`scene.game / add / load / scale / input / time / tweens` 已被占用——
给场景写自己的引用字段（如 `core`），TS 严格模式会报 TS2416/TS2612。

### 5. Web Audio 调度器死循环（无头环境必炸）
`while (t < now + 1.2)` 中 `t` 若不推进，AudioContext 在无头/挂起时 currentTime 不走 →
主线程永久锁死。**对策**：`t += stepDur` 在循环内推进 + 循环守卫 `guard < 8`。

### 6. 每帧新建粒子发射器
`add.particles(...)` 每次调用创建发射器，攻击/暴击高频路径里要复用或快速销毁。

### 7. 类型里存在 ≠ 运行时可用
`setTintFill` 在 v4 的 d.ts 中仍有残留声明但运行时已移除。
API 事实用 `pdeck api exists`（会交叉核对移除规则表），不要只 grep 类型文件。

## 验证工作流

```bash
pdeck doctor .          # 项目健康：版本对照/工具链/隔离检查
pdeck check .           # v4 API 静态扫描 + 纹理 key 校验
pdeck api query <词> .  # d.ts 预言机
pdeck api exists <词> . # 存在性 + 已移除 API 交叉核对
pdeck verify .          # 从窄到宽阶梯（tsc→构建→真实浏览器→截图证据）
pdeck baseline <名> .   # 视觉回归基线
pdeck visual-test <名> .# 与基线像素比对（容差/阈值可调）
pdeck simulate .        # 平衡模拟门（test/simulate 契约 + 剖面区间）
```

**平衡模拟契约**（pdeck simulate 消费）：项目提供 `test/simulate.mjs|ts`，读 `SIM_HOURS` 环境变量，
模拟挂机后向 stdout 最后一行输出 JSON 报告：
`{"hours":48,"crops":123,"coins":456}` —— **任何数值字段（除 hours 与 _ 前缀）都会自动生成 band 区间**，
战斗/农场/经营游戏各自命名均可。.ts 版本可正常 import 项目核心模块（tsx 运行）；.mjs 遇到
相对 import 失败且项目装有 tsx 时会自动回退重试。
先 `pdeck simulate-profile` 生成 ±30% 区间（.pdeck/simulate.json），此后数值改动用
`pdeck simulate` 做**平衡回归门**：越界即 FAILED，刻意调整后重新 profile。

**视觉回归**：`pdeck baseline <名>` 建基准（dist 或 --url），`pdeck visual-test <名>` 用浏览器
解码两张 PNG 做逐像素比对（threshold 16/容差 0.02 默认），尺寸不一致即 FAILED。

**平衡模拟模式**（核心逻辑无头验证，契约版）：
```ts
// test/simulate.ts —— 读 SIM_HOURS，复用 balance.test 的 idleBot 策略
const g = new Game(); g.newGame('模拟侠客', 'sword');
for (let i = 0; i < hours * 3600; i++) { g.combatTick(1, true); if (i % 60 === 0) idleBot(g); }
console.log(JSON.stringify({ hours, level: g.s.level, region: g.s.region, ... }));
```

**浏览器冒烟模式**（Playwright + 系统 Chrome）：
起 vite preview → 建号 → 断言金币/日志增长 → 截图 → 检查控制台错误 →
重载验证存档续玩。无头环境为软件渲染（SwiftShader），性能数据与真机 GPU 有差异，
卡死类问题真机未必复现——标注不确定性。

## 相关官方技能（vendor 基线，4.0 时代编写，与 4.2.1 对照使用）

- `v3-to-v4-migration`：全部破坏性变更清单（本技能不重复）
- `v4-new-features` / `filters-and-postfx` / `game-setup-and-config` / `events-system`
