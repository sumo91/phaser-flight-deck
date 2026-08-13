# Changelog

## 0.3.0 — Phase 3：视觉回归 + 平衡模拟门（2026-08-13）

- **`pdeck baseline <name>`**：截取视觉回归基线（.pdeck/baselines/<name>.png；无 --url 时服务 dist，
  缺构建产物 → INCONCLUSIVE）。页面有未捕获异常时拒绝将截图作为可靠基线。
- **`pdeck visual-test <name>`**：截当前画面与基线**逐像素比对**——用浏览器解码两张 PNG
  （零新依赖），每通道差值 > threshold（默认 16）计为差异像素，差异率 > tolerance（默认 0.02）
  即 FAILED；分辨率不一致直接 FAILED。实测 SwordIdle 自比对 0.00%（1,024,000 像素）。
- **`pdeck simulate`**：**平衡回归门**。契约：项目提供 `test/simulate.mjs|ts`（读 SIM_HOURS，
  模拟挂机后 stdout 末尾输出一行 JSON 报告）。检查 level/region/realm/totalKills 是否落在
  .pdeck/simulate.json 剖面区间内，越界即 FAILED——数值改动引入的节奏回归会被自动抓住。
- **`pdeck simulate-profile`**：运行一次 harness 生成 ±30% 区间剖面（可手调）。
  实测 SwordIdle：2h 模拟 level 20/region 2/realm 3/kills 1725 全部落区间 PASSED。
- Pi 工具：`pdeck_visual`（baseline/test，generated-write）、`pdeck_simulate`（check 只读 / profile 生成写）。
- 共用子进程执行抽取为 lib/process.mjs（verify/simulate 复用，含 Windows shell 修复）。
- 测试 37 项全绿（视觉自比对、模拟门 PASSED/FAILED 双路径、契约缺失降级）。

## 0.2.1 — 授权模型重构 + 体验打磨（2026-08-13）

- **持久授权（trust.json）替代短超时确认**：写入类操作首次触发时弹**三选一**对话框
  （永久授权 / 仅本次会话 120s lease / 拒绝），窗口放宽到 300 秒；永久授权写入工具目录
  `trust.json`（删除即撤销），此后同类操作不再打断。新增 `/pdeck-authorize` 命令可随时
  预授权/查看状态。旧模型（每次确认 + 90s 超时）的问题：反应时间太短。
- **verify 与 run console 裁决一致**：良性错误过滤（favicon 404 等）提取为共用 lib，
  verify 不再出现"PASSED 但 facts 里有控制台错误"的自相矛盾信号。
- **耗时可见**：verify 摘要内联耗时（如"全部可运行阶段通过（8s）"）；报告 JSON 记录
  elapsedMs；evidence 索引展示每次耗时。
- **历史摘要内联**：verify 的 nextSteps 自动带上"最近验证: PASSED(9s) → ..."（最近 3 次）。
- **证据保留策略**：.pdeck/reports 与 captures 每类只留最近 10 份（只删本工具生成的
  verify-*/snapshot-* 文件，无关文件不受影响）。
- 工具结果标注授权状态（授权:永久/本次会话/只读）+ 耗时。
- 测试 33 项全绿（新增：共享过滤单测、保留策略单测）。

## 0.2.0 — Phase 2（2026-08-13）

验证阶梯与浏览器观察。

- **`pdeck verify`**：从窄到宽验证阶梯——版本一致性 → tsc --noEmit → 生产构建 →
  真实浏览器（canvas 非零尺寸、零页面异常、合成输入可达）→ 截图证据。
  决定性阶段 = 首个硬失败；缺失前置 → INCONCLUSIVE（不是失败）；证据写入 `.pdeck/captures` 与 `.pdeck/reports`。
- **`pdeck run`**（嵌套动作）：
  - `serve`：dev server 生命周期——直启 node vite 单一进程树；**端口预检拒绝外来占用**（避免 localhost URL 歧义）；双栈（IPv4/IPv6）HTTP 实测验证 + 自己的 pid 存活检查（不把别人的服务器响应当成功）；stop 带**命令行归属校验**（只杀本项目 vite，绝不误杀其它项目进程）
  - `snapshot`：无头 Chrome 截图（1280×800 默认）
  - `console`：控制台/页面错误采集，**良性 favicon 404 过滤**
  - `probe`：window.__pdeck 运行时探针查询（未装探针 → INCONCLUSIVE 降级）
  - `watch`：有界流式观察窗口
- **`pdeck init`**：保守脚手架（Phaser 4.2.1 钉版模板：core 隔离 + 诊断场景 + 无头测试）。
  默认 dry-run；`--apply` 才写入；非空目录/已有 package.json 停手；**从不代跑 npm install**。
- **`pdeck evidence`**：有界验证证据索引（新鲜度/裁决/facts 数）。
- **`pdeck vendor-skills`**：从 phaserjs/phaser 指定 tag git clone 更新 skills/vendor（host-write）。
- **Pi 扩展确认门**：风险分级（none / generated-write / project-write / host-write）。
  新增工具 `pdeck_validate` / `pdeck_run` / `pdeck_init` / `pdeck_evidence` / `pdeck_vendor` + 命令 `/pdeck-verify`。
- 依赖：`playwright-core`（浏览器动作按需加载，缺失时优雅降级 INCONCLUSIVE + 安装指引）。

### 实战排障记录（0.2.0 开发）

- Windows spawn `shell:true` 会拆断 `C:\Program Files\nodejs\node.exe` 路径空格——node 直调必须 `shell:false`
- `netstat -p TCP` 只列 IPv4、不带 -p 只列 IPv6——双栈监听需合并两次扫描
- vite 7 在 Windows 只绑 localhost 解析的首个地址（常为 [::1]）——HTTP 验证必须双栈探测
- 端口共存歧义：其它项目占 127.0.0.1:5173 时，vite 仍可绑 [::1]:5173 且 localhost URL 会命中别人——预检拒绝是唯一诚实策略
- npm.cmd 进程 pid 提前退出（vite 子进程孤行）——直接 spawn node vite.js 保证单一进程树

## 0.1.0 — Phase 1（2026-08-13）

首个可用版本：只读检查与 API 预言机。

- CLI 执行核心 `pdeck`（零依赖 Node ≥20）：`doctor`（版本对照/静默期感知/工具链/core 隔离）、
  `check`（19 条版本化 v4 API 规则 + 纹理 key 校验）、`api`（d.ts 预言机，exists 交叉核对移除规则）、
  `help`/`describe`/`version`
- 有界 Result Envelope（PASSED/FAILED/INCONCLUSIVE/CANCELLED + facts + nextSteps）
- 单一命令契约 `registry/commands.mjs`；Pi 薄封装扩展 `pdeck_project`/`pdeck_check`/`pdeck_api` + `/pdeck-doctor`
- 自研主技能 `skills/phaser4-flight-deck/`（架构约定 + 7 条实测踩坑录 + 模拟/冒烟模式）
- 运行时探针契约 `probes/flight-deck-probe.js`
