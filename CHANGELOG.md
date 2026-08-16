# Changelog

## 0.6.0 — 玩测内核增强：轮询断言、剧本变量、剧本驱动视觉回归（2026-08-16）

- **expect-within 轮询断言**：`{"do":"expect","within":2000}` 在毫秒窗口内轮询直到
  满足，瞬态假值/加载期变量未就绪不再一击致命——此前 README 示例剧本连栽 3 次全是
  "按了键但状态未就绪"类时序问题，从此由 within 消化；超时如实 FAILED 并报告实际
  等待时长与最后一次求值错误。
- **store + `{{变量}}` 跨步骤对比**：新动作 `store(as, eval)` 把页面内求值存入剧本
  变量，后续步骤字符串字段 `{{name}}` 引用（替换为 JSON 字面量）；"推进一天后金币
  增加了"不再需要页面全局暂存（`window.__pt`）写法。未定义变量以明确报错失败。
  `store` 同样支持 `within`：轮询到值非空再冻结——真实项目实测发现场景未就绪时
  会把瞬态 `null` 固化成常量、后续插值断言永远为假，故补此语义。
- **剧本驱动视觉回归（`--script` + `--at-step`）**：`baseline`/`visual-test` 复用
  playtest 执行内核（`driveSteps` 抽取共用），先把游戏驱动到任意可达状态（进入
  战斗/推进到某天/打开界面）再采基线/比对——视觉回归从"只保护 URL 入口态（标题屏）"
  升级为"保护任意可达状态"。剧本态走 dev server（自动起停），入口态保持 dist 静态
  服务；剧本断言失败时如实 FAILED 且不落基线/不比对。真实项目实测：确定性农田态
  同态 0.00%，动画战斗态同态 0.68%（帧差，默认容差内）。
- **基线健康审计**：`visual-test` 发现所选基线与其它基线内容完全相同（一张图复制
  多份的假丰富度）时附 `baseline_duplicate` 告警；`pdeck evidence` 列出全部副本组
  ——来源于真实试用：两个试用项目的"三张基线"实为同一张图复制三份，此前工具沉默。
- **修复 Pi 扩展 script 参数丢失**：`pdeck_run` 注册了 playtest 但工具 schema 未
  暴露 `script` 字段且 `buildArgs` 无映射——经扩展调用 playtest 时剧本路径被静默
  丢弃；`pdeck_visual` 同步补 `script`/`atStep`。playtest 归类为写入（截图证据）。
- 新增 9 项测试：within/store 校验、插值替换与未定义上报、driveSteps expect 轮询
  成功/超时、store-within 冻结/超时固化 null、变量跨步骤引用（桩页面）、基线查重
  纯函数、夹具级 baseline--script→visual-test--script 同态比对。

测试总数 76（70 CLI + 6 适配器）；无夹具 58 通过/12 跳过。

## 0.5.2 — 阶段 C：正确性收尾（2026-08-16）

- **#7 POSIX 端口预检落地**：`pidsByPort` 非 win32 不再返回空——lsof 优先（macOS）、
  ss 回退（精简 Linux），`ss -ltnp` 解析抽为纯函数 `parseSsListenPids`（可单元测试）；
  `processCommandLine` 用 `ps -o command=` 替代直接返回空串（归属校验/防误杀在
  POSIX 上真正生效）。README 宣称与实现不再不符。wmic/netstat 分支补 spawn 失败
  兜底（新版 Windows 移除 wmic 时按未知归属处理，不误杀）。
- **#11 fx-bloom/fx-shine 双序匹配**：`setPostPipeline('Bloom')` 参数在后的迁移指南
  常见写法不再漏报（此前只认 Bloom 在前）；保持原"同行任意字符"语义。
- **#10 静态服务器路径穿越加固**：解码后路径（%2e%2e 编码可绕过客户端规范化）
  解析后必须仍在 root 内，否则 404——带外文件不得泄露（只监听 127.0.0.1，
  风险本就低，此为纵深防御）。
- **版本单一来源**：pdeck.mjs 的 VERSION 改读 package.json（此前双维护、
  每轮发版手动同步两处）。
- 新增 4 项测试：fx 双序、ss 解析（端口全等/仅 LISTEN/去重）、路径穿越拒绝
  （%2e%2e 两种编码形态 + 正常路径不受影响）、平台分支可执行（本地 win32、
  CI ubuntu 实跑 POSIX 路径）。

测试总数 67（61 CLI + 6 适配器）；三配置全绿（56+11skip / 67/67 ×2）。

## 0.5.1 — 阶段 A：测试守护的真实性（2026-08-16）

- **#14 适配器测试守护已提交状态**：`npm test` 不再先跑 generate（原流程守护的是
  "生成器自洽"而非仓库事实——改了 registry 忘提交 dist 时照样全绿）。新增新鲜度
  测试：生成到临时目录与已提交 dist 逐文件比对，漂移即失败并给出
  "npm run generate 并提交"指引；MANIFEST 去掉时间戳字段——产物完全确定性，
  源未变则重新生成零 diff（此前每次 npm test 都弄脏工作区）。实测：篡改 dist
  双测试抓出、npm test 后工作区干净。
- **#12 CI 双平台矩阵**：ubuntu/windows × Node 20/24（此前仅 ubuntu+Node20，
  netstat 双栈/taskkill/npm.cmd/端口回退等 Windows 专项代码 CI 从未执行）。
- **视觉比对纯逻辑单元测试**：`countChangedPixels` 抽为导出纯函数（阈值判定/
  差异计数/短侧截断，含"恰等于阈值不计"的 > 语义边界），浏览器路径经
  `toString()` 序列化复用同一实现——visual-diff 首次获得无浏览器 CI 覆盖。

测试总数 63（57 CLI + 6 适配器）；无夹具 52 通过/11 跳过，双夹具 63/63 全绿。

## 0.5.0 — playtest：机器人玩家玩测（2026-08-16）

立项来源：真实项目实测发现工具链缺"玩家行为"维度——verify 只有单次输入可达性探测，
simulate 走项目自己的 harness。用现有积木（浏览器驱动 + DEV 注入点）验证两条路可行后正式落地：

- **`pdeck run playtest <script.json> [project|--url]`**：剧本驱动的机器人玩家玩测。
  7 种动作：`press(key)` / `hold(key,ms)` / `wait(ms)` / `click(x,y)`（输入），
  `expect(that,eval)` / `collect(that,eval)`（页面内求值——设计逻辑注入，可调
  `window.__session` 等项目注入点；前后对比可借页面全局暂存），`capture(as)`（截图证据）。
  expect 为假/求值抛错/页面未捕获异常 → FAILED（事实带步骤号）；服务生命周期与
  observe 相同（复用不碰、自起必清理）。剧本校验（≤64 步、动作/字段合法性）在
  起浏览器之前完成，错误信息带步骤号与 JSON 行列位置。
- **eval 双形式**：`'() => …'` 函数串（Node 侧构函后页面调用）与 `'…'` 纯表达式
  （直传求值）。字符串直传函数体会被 playwright 当表达式、返回函数对象本身
  （不可序列化 → undefined）——实测踩坑后区分处理。
- **#22 端口自动回退**：observe/playtest 未显式指定端口时，默认口被外部进程占用
  （多项目并发开发常态，本机 ZCamp 长期占用 5173 两次触发）则自动尝试 5173-5178
  候选——这类动作自己起停自己的服务、URL 自产自销，无 serve 的归属歧义。
  显式 `--port` 仍严格拒绝。
- **#8 补全**：registry `run.actions` 补上此前缺失的 `observe`（与新增 `playtest`）。
- observe/playtest 共用 `autoServerLifecycle` 助手（observe 行为不变）。

实测：StarValley 9 步剧本 7.7s——Enter 开局（day 1/money 500）→ hold D 移动
（x 200→288）→ 断言通过 → 截图证据；开发中两次剧本错误（缺引号、非防御访问）
均被诚实捕获（JSON 行列定位 / step_error 带步骤号）。

新增 3 项测试（剧本校验、静态页真实执行、夹具玩测——项目无关纯 DOM 断言）。
测试总数 59（54 CLI + 5 适配器）；双夹具 59/59 全绿。

## 0.4.4 — 平衡门剖面字段漂移检测（2026-08-16）

发现路径：对 SwordIdle 连跑两次同参模拟发现 gold 摆幅 2.9 倍且从未被检查——

- **双向漂移检测**：simulate 现在核对 harness 报告字段与剖面 bands 的对称性——
  报告有、剖面无（新增字段绕门）→ `unchecked_field`；剖面有、报告不再输出
  （stale band 未核对）→ `stale_band`。不改变裁决（没有基线无法定性），但在
  summary/facts/nextSteps 三处可见。
- 实测两个真实项目都有漂移：SwordIdle 的 `gold`、StarValley 的
  `money/daysSimulated/seedSpend`——剖面均为 harness 加字段之前生成的，
  这些字段此前一直绕过平衡门。
- 遗留（项目侧，#24）：SwordIdle 模拟 harness 未固定随机种子（同参两次
  gold 10991↔3788、level 19↔20），高方差字段入 band 会 flaky；StarValley
  全字段确定性（两次完全一致），可作参照。两个项目可择机重新
  `simulate-profile` 把新字段纳入区间。

新增 1 项漂移检测测试（双向）。测试总数 56（51 CLI + 5 适配器）。

## 0.4.3 — 纹理 key 检查项目级聚合（2026-08-16）

以 StarValley（JS 农场项目，集中式 PreloadScene）实测发现并修复：

- **纹理 key 跨文件误报（#20）**：key 可见性从逐文件改为**项目级两遍扫描**——先全项目
  收集静态创建点（`collectCreatedKeys`），再逐文件判悬空。接收者正则同步放宽：
  `tex.addCanvas(...)`/`const load = this.load` 等别名写法此前完全漏匹配
  （原正则硬编码 `.textures.addCanvas`/`.load.`）。实测 StarValley 16 处误报 →
  3 处残留，且残留均为模板字面量动态创建（`player-${dir}-${i}`），属静态分析的
  诚实盲区，提示文案如实说明。SwordIdle 的 addCanvas 实测警告与 0 悬空不变。
- **夹具断言去项目耦合（#21）**：`集成: check 真实项目` 此前断言输出含
  `/addCanvas/i`——在无 addCanvas 使用的项目上"因错误的原因通过"（匹配到 expected
  字段模板文字）。改为项目无关的结构断言（PASSED + scan_coverage）；
  addcanvas-usage 规则改由确定性单元测试覆盖。

新增 2 项测试（跨文件聚合、addcanvas-usage 单元）。测试总数 55（50 CLI + 5 适配器）；
StarValley 与 SwordIdle 双夹具均 55/55 全绿——夹具跨项目可移植。

## 0.4.2 — 真实项目工作流跑出来的四项修复（2026-08-16）

以 SwordIdle（Phaser 4.2.1 挂机游戏）为夹具完整跑通全工作流后修复：

1. **独立 `simulate` 取剖面时长**：未显式 `--hours` 时默认取剖面记录值（此前按 48h
   默认跑，对 2h 剖面产生四项 band 全越界的假 FAILED——R3 修复只落在了 regression
   路径）。时长来源以 `duration_source` 事实透明呈现；显式 `--hours` 仍优先。
2. **`serve --stop` 定位语义**：停止操作以 `.pdeck/server.json` 为归属锚点——非
   Phaser 目录里只要状态文件存在即可停止；找不到时给出"为何需要项目目录（防误杀）"
   的指引，不再误报"不是可识别的 Phaser 项目"。
3. **Node ≥24 DEP0190 消除**：三处 `shell:true + args` 组合（lib/process、verify、
   run 的 npm 调用）改为单命令串形式；命令均为内控常量，无注入面。
4. **watch --json 测试改异步 spawn**：原测试 execFileSync 冻结父进程事件循环导致
   自建服务器无法应答（实际测的是 goto 超时路径，20.8s）；改为异步 spawn 后走真实
   观察循环（2.9s），并在浏览器可用时断言进度行只出现在 stderr。

新增 3 项回归测试（剖面时长、stop 指引、非 Phaser 目录停止）。测试总数 53
（48 CLI + 5 适配器）；带真实夹具 53/53 全绿。

## 0.4.1 — 外部反馈修复：CLI 契约与诚实性（2026-08-15）

来自另一模型（DeepSeek）交叉评审的必修项修复：

1. **`parseProject` 位置参数按声明槽位左到右填充**：`pdeck api query <词>`（不带 project）
   的查询文本不再被吞成 project 路径；仅当 project 之前的槽位都已填满时，
   多出的参数才落入 project。
2. **`run watch --json` stdout 纯净**：观察进度行改走 stderr，stdout 只有最终 JSON
   信封——`--json` 的机器可读承诺不再被破坏。
3. **`--no-capture` 落地**：registry usage 早已写了它但解析器不认识——现在 verify
   真正支持 `--no-capture` 跳过截图（capture 阶段如实记 skipped）。
4. **doctor 未安装语义诚实化**：仅声明未安装时报 `version_unknown` 并给 npm install
   指引，不再谎称"安装版本与 registry latest 一致"（证据与谎言分离）。
5. **发布卫生**：package.json `files` 补 `templates/`（按 npm 包安装后 `init` 不再必挂）；
   package-lock.json 重建对齐 0.4.1。

新增 5 项回归测试（全部无需夹具，CI 可稳定跑）：api query 无 project、
watch --json 可解析、doctor 未安装语义、--no-capture 契约、npm pack 含模板且
解包产物 init 可用。测试总数 50（45 CLI + 5 适配器）。

附记：评审中一度怀疑"系统代理劫持 127.0.0.1 导致 goto 超时"并试改 browser.mjs，
实测推翻——超时真因是验收脚本用 execFileSync 冻结了父进程事件循环（服务器无法
应答）；未引入未证实的 workaround，browser.mjs 保持原样。

## 0.4.0 — 多宿主适配器（2026-08-14）

- **`npm run generate`**：从单一契约源（registry/commands.mjs + 主技能）生成三宿主适配器包（dist/ 已提交）：
  - **Claude Code**：skills + `/pdeck-regression|verify|doctor|check` 4 个 slash commands + PreToolUse hooks（拦截 init --apply/vendor-skills/baseline/simulate-profile 写入类命令，ask 决策）
  - **Cursor**：`.cursor/commands/` 4 个命令入口 + 技能（无 hooks → prompt 约定确认门）
  - **Codex**：`$HOME/.agents/skills/` 技能包
  - **Pi**：已有（11 工具 + trust.json 授权）
- **MANIFEST.json**：15 个生成文件 SHA-256 可校验
- **一致性测试**（5 项）：命令覆盖率（每个 CLI 命令都在技能命令表中）、宿主差异断言、MANIFEST 哈希、hooks 拦截清单
- 适配器是提示层不是逻辑层——CLI 唯一执行核心；manual-only，不自动触发
- 安装说明见 dist/README.md；测试总数 45（40 CLI + 5 适配器）

## 0.3.2 — 修订计划 R1-R5（2026-08-14）

- **R1 `run observe`**：复合观察动作——按需起服务（复用已有则不碰）→ console 观察 →
  **自己起的必自动清理**（finally 保证）。生命周期以 lifecycle 事实记录在案。
- **R2 file:// CORS 直达提示**：console/observe 发现 CORS/file:///ERR_FAILED 特征错误时，
  nextSteps 直接给出"用 HTTP URL"的出路（有真实 file:// 测试用例）。
- **R3 `pdeck regression`**：全量回归组合——doctor→check→verify→simulate→visual 串行，
  聚合成一份有界信封 + `.pdeck/reports/regression-*.json|md` 报告；缺失前置的阶段如实
  INCONCLUSIVE（不伪造）；simulate 时长自动取剖面记录值（修掉了 48h 默认值导致的假失败）。
  实测 SwordIdle 五阶段 20s 全绿。
- **R4 vendor-skills 加固**：git 自带 60s 超时 + 网络受限（Connection reset 等）快速
  INCONCLUSIVE 并给出手动替代出路（本机 GitHub 不可达，待可达环境执行）。
- **R5 运维规则文档化**：新工具=新会话、目录勿移动、trust.json 撤销、vendor 需 GitHub、
  端口冲突策略——写入 README 与主技能。
- Pi 新工具 `pdeck_regression`（generated-write）。测试 43 项全绿。

## 0.3.1 — 外部反馈修复（2026-08-14）

来自另一项目 Agent 的真实使用反馈（6 个磨合点），逐条修复：

1. **契约靠猜 → tsx 自动回退**：.mjs harness 直跑 node 遇到模块解析错误（Cannot find module）
   且项目装有 tsx 时自动重试；无 tsx 时错误信息给出两个明确选项（装 tsx 或自包含）。
2. **词汇表硬编码 → 泛型契约**：band 字段不再限 {level,region,realm,totalKills}——报告里
   **任何数值字段**（除 hours 与 _ 前缀）自动生成 band。农场游戏用 {crops,coins,happiness}
   同样生效（有测试）。旧战斗字段向后兼容。
3. **提示指向不存在的入口 → 契约内联**：所有 simulate 错误信息内联契约三行说明；
   `pdeck_api` 新增 mode=describe（query 传命令名返回 usage/options/positionals）。
4. **失败不给原始输出 → 尾部进摘要**：解析失败时 summary 直接带原始 stdout/stderr 尾部（≤400 字）。
5. **探针路径找不到 → 实际绝对路径 + 内联最小契约**：probe 提示用 import.meta.url 打印
   **本机真实路径**，并给出三行手写最小契约（window.__pdeck.query 下任意只读函数）。
6. **观察者自扰 → 环境噪音归类**：GL Driver Message / GPU stall ReadPixels / SwiftShader
   等无头观察产物单独归为 env_noise 事实，不再混入 console_warnings 干扰判断
   （verify/console/watch 三处一致）。

测试 40 项全绿（新增：环境噪音分类、农场字段泛型契约、解析失败尾部可见）。

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
