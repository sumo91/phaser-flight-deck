# Phaser Flight Deck

Agent 工具链：为 **Phaser 4 网页游戏项目**提供健康检查、v4 API 静态扫描、API 事实预言机、
从窄到宽验证阶梯、dev server 生命周期与无头浏览器观察。
零依赖 CLI 执行核心 + 单一声明式命令契约 + Pi 薄封装扩展 + 项目技能与运行时探针。

设计原则（来自 Godot Flight Deck / Phaser Project Toolkit 实战）：

- **CLI 单一执行核心**：所有业务逻辑在 `cli/pdeck.mjs`（任意 agent shell 可用）
- **模型无关性**：结果一律为有界 Result Envelope（PASSED/FAILED/INCONCLUSIVE/CANCELLED + 确定性下一步）
- **版本即数据**：Phaser 4.2.1 已进入发布静默期——doctor 检查实际安装版本 vs registry 并报告静默期；规则表带版本号
- **证据与谎言分离**：启动/构建/渲染都要**实测**（HTTP 双栈探测、canvas 尺寸、pid 存活），
  不把"未验证的启动"或"别人的服务器响应"说成成功
- **边界**：基建与验证在界内；玩法判断在界外

## 快速开始

```bash
cd <工具目录> && npm install          # 首次（playwright-core，浏览器动作需要）
node <工具目录>/cli/pdeck.mjs doctor <项目目录>
node <工具目录>/cli/pdeck.mjs check <项目目录>
node <工具目录>/cli/pdeck.mjs api query fillPoints <项目目录> --depth 3
node <工具目录>/cli/pdeck.mjs api exists setTintFill <项目目录>
node <工具目录>/cli/pdeck.mjs verify <项目目录>          # 完整验证阶梯（需要系统 Chrome/Edge）
node <工具目录>/cli/pdeck.mjs run serve <项目目录>       # dev server 生命周期
node <工具目录>/cli/pdeck.mjs run snapshot http://localhost:5173/
node <工具目录>/cli/pdeck.mjs run console http://localhost:5173/ --seconds 5
node <工具目录>/cli/pdeck.mjs run probe http://localhost:5173/ --query '{"state":"state"}'
node <工具目录>/cli/pdeck.mjs evidence <项目目录>
node <工具目录>/cli/pdeck.mjs init <新目录>              # dry-run 脚手架
node <工具目录>/cli/pdeck.mjs help
```

## 命令

| 命令 | 职责 | 风险 |
|---|---|---|
| `pdeck doctor` | 项目健康：Phaser 识别、版本对照（静默期感知）、工具链、core 隔离 | 只读 |
| `pdeck check` | 19 条 v4 API 规则扫描 + 纹理 key 校验（动态工厂误报抑制） | 只读 |
| `pdeck api` | d.ts 预言机：query / exists（含已移除 API 交叉核对）/ version | 只读 |
| `pdeck verify` | 验证阶梯：版本→tsc→构建→真实浏览器→截图证据（.pdeck/） | generated-write |
| `pdeck run` | serve（端口预检+双栈实测）/ snapshot / console（良性404过滤）/ probe / watch | generated-write |
| `pdeck baseline` / `visual-test` | 视觉回归：基线截图 + 浏览器解码逐像素比对（阈值/容差可调） | generated-write |
| `pdeck simulate` / `simulate-profile` | 平衡模拟门：项目 test/simulate 契约 + 剖面区间回归检查 | 只读 / 生成写 |
| `pdeck evidence` | 验证证据索引（裁决/新鲜度/耗时） | 只读 |
| `pdeck init` | 保守脚手架（dry-run 默认，--apply 提交；从不代跑 npm install） | project-write |
| `pdeck vendor-skills` | vendor 官方 skills（git clone 钉版 tag） | host-write |

## Pi 集成

安装后（`pi install D:/00_Ai/Tools/PhaserFlightDeck`），Agent 获得工具：

`pdeck_project` · `pdeck_check` · `pdeck_api` · `pdeck_validate` · `pdeck_run` · `pdeck_init` ·
`pdeck_evidence` · `pdeck_vendor` · `pdeck_visual` · `pdeck_simulate`，
快捷命令 `/pdeck-doctor` · `/pdeck-verify` · `/pdeck-authorize`。

**授权模型**：写入类操作首次触发时三选一（永久授权写入 trust.json 可撤销 / 仅本次会话 / 拒绝，
300s 窗口）；`/pdeck-authorize` 可随时预授权或查看状态。

## 知识层

- `skills/phaser4-flight-deck/`：自研主技能——架构约定（core 零 Phaser 依赖）+ **实测踩坑录**
  （addCanvas 大纹理 GPU ReadPixels 卡死、纹理按规格缓存、场景生命周期、AudioContext 调度死循环、
  d.ts 残留声明 ≠ 运行时可用、vite 只绑 [::1]、端口共存歧义）+ 平衡模拟与浏览器冒烟模式
- `skills/vendor/`：`pdeck vendor-skills` 从 phaserjs/phaser 钉版 tag 引入官方技能（4.0 基线）

## 测试

```bash
npm test   # node --test：37 项（信封/规则/探测/合成夹具/init 门控 + 真实项目 verify 阶梯、serve 生命周期、视觉自比对、模拟门双路径）
```

## 目录

```
cli/pdeck.mjs            零依赖 CLI 入口（参数解析/嵌套动作路由/信封包装）
cli/result-envelope.mjs  有界证据优先信封（与 Pi 共用）
cli/lib/                 项目探测 / registry 对照 / v4 规则表 / 浏览器驱动 / 静态服务器
cli/commands/            doctor / check / api / verify / run / init / evidence / vendor
registry/commands.mjs    单一契约：CLI 选项、命令、Pi 字段 schema、风险分级
extensions/              Pi 薄封装扩展（参数映射+确认门+Envelope 透传）
skills/                  自研主技能 + 官方技能 vendor
probes/                  运行时探针契约（window.__pdeck，pdeck run probe 消费）
templates/project/       init 脚手架模板（Phaser 4.2.1 钉版）
tests/                   node --test 回归（31 项）
```

## 实战排障记录

见 [CHANGELOG.md](CHANGELOG.md) 0.2.0 节——Windows spawn/shell、netstat 双栈、vite [::1] 绑定、
端口共存歧义、npm.cmd 进程孤儿等 5 个真实环境坑的定位与对策。
