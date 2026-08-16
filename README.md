# Phaser Flight Deck

> **v0.5.2** · 67 tests · MIT License · Node ≥ 20

Agent toolchain for **Phaser 4 web games**: project health checks, v4 API static scanning,
an API-truth oracle over the bundled type definitions, a narrow-to-broad verification ladder,
dev-server lifecycle with headless-browser observation, script-driven robot-player playtesting,
visual regression, and a balance-simulation gate.
Zero-dependency CLI execution core + a single declarative command registry + a thin Pi extension
wrapper + project skills and a runtime probe.

*English readers: every command prints a bounded JSON envelope (`--json`) with a
PASSED/FAILED/INCONCLUSIVE/CANCELLED verdict, evidence facts, and deterministic next steps.*

为 **Phaser 4 网页游戏项目**提供健康检查、v4 API 静态扫描、API 事实预言机、
从窄到宽验证阶梯、dev server 生命周期与无头浏览器观察、剧本驱动机器人玩家玩测、
视觉回归与平衡模拟门。

设计原则（来自 Godot Flight Deck / Phaser Project Toolkit 实战）：

- **CLI 单一执行核心**：所有业务逻辑在 `cli/pdeck.mjs`（任意 agent shell 可用）
- **模型无关性**：结果一律为有界 Result Envelope（PASSED/FAILED/INCONCLUSIVE/CANCELLED + 确定性下一步）
- **版本即数据**：Phaser 4.2.1 已进入发布静默期——doctor 检查实际安装版本 vs registry 并报告静默期；规则表带版本号
- **证据与谎言分离**：启动/构建/渲染都要**实测**（HTTP 双栈探测、canvas 尺寸、pid 存活），
  不把"未验证的启动"或"别人的服务器响应"说成成功
- **边界**：基建与验证在界内；玩法判断在界外

## Requirements

| 需求 | 必需/可选 | 说明 |
|---|---|---|
| Node.js ≥ 20 | 必需 | CLI 与扩展运行时 |
| Google Chrome 或 Edge | 可选 | `verify` / `run snapshot|console|watch|observe|playtest` / `baseline` / `visual-test` 的浏览器证据需要；缺失时优雅降级为 INCONCLUSIVE + 安装指引 |
| playwright-core | 可选 | 首次 `npm install` 一并安装；缺失时同上降级 |
| git | 可选 | 仅 `vendor-skills` 需要 |
| tsx（项目内） | 可选 | 项目的 `.ts` 模拟 harness 需要 |

支持平台：Windows / macOS / Linux（端口预检与进程归属校验跨平台：Windows 用 netstat 双栈 + wmic，POSIX 用 lsof→ss + ps）。

## Installation（三选一）

**方式 A：直接使用（零安装）**

```bash
node <本目录>/cli/pdeck.mjs <command> ...      # 无需 npm install，核心命令零依赖
npm install                                    # 仅浏览器相关命令需要（playwright-core）
```

**方式 B：全局命令（npm link 或 PATH）**

```bash
cd <本目录> && npm install && npm link          # 获得全局 pdeck 命令
pdeck doctor <项目目录>
pdeck version
```

**方式 C：Pi Agent 集成（Agent 工具 + 技能）**

```bash
pi install <本目录>                            # 全局；或 cd <项目> && pi install -l <本目录> 项目级
# 或手工注册：settings.json 的 extensions 数组加入 <本目录>/extensions/phaser-flight-deck.ts，
# skills 数组加入 <本目录>/skills/phaser4-flight-deck
```

安装后 Pi 会话获得 11 个工具与 3 个命令（见 [Pi 集成](#pi-集成)）。
**注意**：新工具需要 `/reload` 或重启 Pi 才会出现在会话工具清单里（见 [运维规则](#运维规则)）。

## 快速开始

```bash
pdeck doctor <项目>                              # 项目健康：版本对照/工具链/core 隔离
pdeck check <项目>                               # v4 API 静态扫描 + 纹理 key 校验
pdeck api query fillPoints <项目> --depth 3      # d.ts 预言机
pdeck api exists setTintFill <项目>              # 存在性 + 已移除 API 交叉核对
pdeck verify <项目>                              # 验证阶梯：tsc→构建→真实浏览器→截图证据
pdeck run serve <项目>                           # dev server 生命周期（端口预检+双栈实测）
pdeck run observe <项目>                         # 复合观察：按需起服务→console→自动清理
pdeck run snapshot http://localhost:5173/
pdeck run console http://localhost:5173/ --seconds 5
pdeck run playtest <剧本.json> <项目>               # 机器人玩家玩测（按键/点击/断言/截图剧本）
pdeck baseline demo <项目>                       # 视觉回归基线
pdeck visual-test demo <项目>                    # 与基线像素比对
pdeck simulate <项目>                            # 平衡模拟门（需 test/simulate 契约 + 剖面）
pdeck regression <项目>                          # 一条命令跑完整全量回归 + json/md 报告
pdeck init <新目录>                              # 保守脚手架（dry-run 默认，--apply 提交）
pdeck evidence <项目>                            # 验证证据索引
pdeck help
```

所有命令支持 `--json`（机器可读信封）与 `--timeout`。完整契约：`pdeck describe <command> --json`。

## 命令

| 命令 | 职责 | 风险 |
|---|---|---|
| `pdeck doctor` | 项目健康：Phaser 识别、版本对照（静默期感知）、工具链、core 隔离 | 只读 |
| `pdeck check` | 19 条 v4 API 规则扫描 + 纹理 key 校验（动态工厂误报抑制） | 只读 |
| `pdeck api` | d.ts 预言机：query / exists（含已移除 API 交叉核对）/ version / describe | 只读 |
| `pdeck verify` | 验证阶梯：版本→tsc→构建→真实浏览器→截图证据（.pdeck/） | generated-write |
| `pdeck run` | serve（端口预检+双栈实测）/ snapshot / console（良性404过滤+环境噪音归类）/ probe / watch / **observe（自动起停复合观察）** / **playtest（剧本驱动机器人玩家：press/hold/click/expect/collect/capture，设计逻辑注入与断言）** | generated-write |
| `pdeck baseline` / `visual-test` | 视觉回归：基线截图 + 浏览器解码逐像素比对（阈值/容差可调） | generated-write |
| `pdeck simulate` / `simulate-profile` | 平衡模拟门：项目 test/simulate 契约 + 剖面区间回归检查 | 只读 / 生成写 |
| `pdeck regression` | **全量回归组合**：doctor→check→verify→simulate→visual 串行 → 一份有界信封 + json/md 报告 | generated-write |
| `pdeck evidence` | 验证证据索引（裁决/新鲜度/耗时） | 只读 |
| `pdeck init` | 保守脚手架（dry-run 默认，--apply 提交；从不代跑 npm install） | project-write |
| `pdeck vendor-skills` | vendor 官方 skills（git clone 钉版 tag） | host-write |

风险分级与 Pi 确认门：只读（none）直接执行；generated-write 首次触发时三选一授权
（永久/本次会话/拒绝）；project-write 与 host-write 同样走授权。见 [Pi 集成](#pi-集成)。

## 玩测剧本（run playtest）

JSON 剧本驱动机器人玩家在**真实 UI** 上玩，并可直接注入设计逻辑断言：

```json
{
  "name": "开局走一步",
  "steps": [
    { "do": "wait", "ms": 800 },
    { "do": "press", "key": "Enter" },
    { "do": "wait", "ms": 2500 },
    { "do": "expect", "that": "已进入游戏（会话初始化）", "eval": "() => !!(window.__session && window.__session.time)" },
    { "do": "collect", "that": "起点（借页面全局暂存）", "eval": "() => { const s = window.__game.scene.scenes.find(x => x.scene.key === 'Farm'); window.__pt = { x: s && s.player ? s.player.x : null }; return window.__pt; }" },
    { "do": "hold", "key": "d", "ms": 800 },
    { "do": "expect", "that": "玩家向右移动了", "eval": "() => { const s = window.__game.scene.scenes.find(x => x.scene.key === 'Farm'); return !!s.player && window.__pt !== null && s.player.x > window.__pt.x; }" },
    { "do": "capture", "as": "moved" }
  ]
}
```

| 动作 | 字段 | 说明 |
|---|---|---|
| `press` / `hold` | `key`（hold 另需 `ms` ≤10000） | 键盘；`click` 用 `x,y` 坐标 |
| `wait` | `ms` | 等待 |
| `expect` | `that`（描述）、`eval` | 页面内求值，假值/抛错 → FAILED（事实带步骤号） |
| `collect` | `that`、`eval` | 页面内求值并作为证据记录（有界） |
| `capture` | `as` | 截图落 `.pdeck/captures/playtest-<as>-*.png` |

- `eval` 支持 `'() => …'` 函数串与 `'…'` 纯表达式两种形式；**设计逻辑注入**直调项目暴露的
  `window.__session` / `window.__game` 等 DEV 句柄（前后对比可借页面全局暂存）
- 服务生命周期同 observe：`--url` 直连运行中的页面，或自动起停自己的服务
- 剧本校验（≤64 步、动作/字段合法）在起浏览器之前完成，错误信息带步骤号与 JSON 行列位置

## Pi 集成

安装后 Agent 获得工具：

`pdeck_project` · `pdeck_check` · `pdeck_api` · `pdeck_validate` · `pdeck_run` · `pdeck_init` ·
`pdeck_evidence` · `pdeck_vendor` · `pdeck_visual` · `pdeck_simulate` · `pdeck_regression`，
快捷命令 `/pdeck-doctor` · `/pdeck-verify` · `/pdeck-authorize`。

**授权模型**：写入类操作首次触发时三选一（永久授权写入 trust.json 可撤销 / 仅本次会话 / 拒绝，
300s 窗口）；`/pdeck-authorize` 可随时预授权或查看状态。

## 知识层

- `skills/phaser4-flight-deck/`：自研主技能——架构约定（core 零 Phaser 依赖）+ **实测踩坑录**
  （addCanvas 大纹理 GPU ReadPixels 卡死、纹理按规格缓存、场景生命周期、AudioContext 调度死循环、
  d.ts 残留声明 ≠ 运行时可用、vite 只绑 [::1]、端口共存歧义）+ 平衡模拟与浏览器冒烟模式
- `skills/vendor/`：`pdeck vendor-skills` 从 phaserjs/phaser 钉版 tag 引入官方技能（4.0 基线）

## 多宿主适配器

`npm run generate` 从单一契约源（`registry/commands.mjs` + 主技能）生成各宿主适配器包（`dist/`，已提交）：

| 宿主 | 包内容 | 确认门 |
|---|---|---|
| **Claude Code** | skills + `/pdeck-*` 4 个 slash commands + PreToolUse hooks | hooks 拦截写入类命令（最强） |
| **Cursor** | `.cursor/commands/` 4 个命令入口 + 技能 | prompt 约定（无 hooks） |
| **Codex** | `$HOME/.agents/skills/` 技能包 | prompt 约定 |
| **Pi** | extensions（11 工具 + trust.json 授权） | 工具内确认门（已有） |

适配器是提示层，不是逻辑层——CLI 永远是唯一执行核心；manual-only，不自动触发。
安装方式见 `dist/README.md`；一致性由 `tests/adapters.test.mjs` 守护
（命令覆盖率、宿主差异、MANIFEST 哈希、hooks 拦截清单）。

## 运维规则

1. **新工具 = 新会话**：扩展新增/修改工具后，当前会话的工具集是启动快照，需 `/reload` 或重启 Pi 生效（CLI 每次都是新进程，命令层改动立即生效）。
2. **工具目录路径别移动**：settings.json 里是绝对路径注册；移动后需同步修改 `extensions`/`skills` 数组。
3. **撤销授权**：删除工具目录 `trust.json`（或其中对应条目）；`/pdeck-authorize` 可查看/调整授权状态。
4. **vendor-skills 需要 GitHub 可达**：网络受限环境会快速 INCONCLUSIVE；可在可达环境执行后复制 `skills/vendor/`，或按 `skills/vendor/README.md` 手动操作。
5. **端口冲突策略**：`run serve` 预检拒绝外来占用（避免 localhost URL 歧义），换 `--port` 或先确认占用者；`run observe|playtest` 会自动起停自己的服务，不触碰既有进程——未显式指定端口时若默认口被外部占用（多项目并发开发常态）会自动尝试 5173-5178 候选，显式 `--port` 仍严格拒绝。

## 测试

```bash
npm test                                          # 67 项 = 61 CLI 回归 + 6 适配器一致性（校验已提交的 dist）
PDECK_TEST_FIXTURE=<Phaser项目路径> npm test      # 附带真实项目集成（verify 阶梯、serve 生命周期、视觉自比对、模拟门、玩测）
# 未设置夹具时集成测试自动跳过（56 通过 / 11 跳过）
```

## 目录

```
cli/pdeck.mjs            零依赖 CLI 入口（参数解析/嵌套动作路由/信封包装）
cli/result-envelope.mjs  有界证据优先信封（与 Pi 共用）
cli/lib/                 项目探测 / registry 对照 / v4 规则表 / 浏览器驱动 / 静态服务器 / 视觉比对 / 控制台分类 / 子进程
cli/commands/            doctor / check / api / verify / run / init / evidence / vendor / visual / simulate / regression
registry/commands.mjs    单一契约：CLI 选项、命令、Pi 字段 schema、风险分级
extensions/              Pi 薄封装扩展（参数映射+确认门+Envelope 透传）
skills/                  自研主技能 + 官方技能 vendor
probes/                  运行时探针契约（window.__pdeck，pdeck run probe 消费）
templates/project/       init 脚手架模板（Phaser 4.2.1 钉版）
tests/                   node --test 回归（67 项：cli.test + adapters.test）
scripts/                 generate-adapters.mjs（多宿主适配器生成器，零依赖；--out 可指定输出目录）
dist/                    生成的宿主适配器包（已提交，安装方式见 dist/README.md；测试守护其与契约源新鲜一致）
.github/workflows/       CI：ubuntu/windows × Node 20/24 矩阵跑 npm test
```

## 实战排障记录

见 [CHANGELOG.md](CHANGELOG.md)——Windows spawn/shell、netstat 双栈、vite [::1] 绑定、
端口共存歧义、npm.cmd 进程孤儿、模型回退与授权模型演进等真实环境坑的定位与对策。

## Contributing

欢迎提交 issue 与 PR。约定：

- 所有逻辑改动必须过 `npm test`；影响命令契约的改动同步更新 `registry/commands.mjs`（单一契约源）
- 新增命令遵循：CLI 命令模块（cli/commands/）→ 注册表（registry）→ pdeck.mjs 路由 → 测试 → CHANGELOG
- 风险分级只增不减：新写入类操作必须声明 risk 并在扩展确认门中处理

## License

[MIT](LICENSE) © 2026 Phaser Flight Deck contributors
