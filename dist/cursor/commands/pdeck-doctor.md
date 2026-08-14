# 项目体检（pdeck-doctor）

**触发**：当用户要求"检查项目健康 / 版本对不对 / 环境就绪"时

**执行**：

```bash
pdeck doctor <项目目录>
```

若 `pdeck` 不在 PATH：`node <phaser-flight-deck目录>/cli/pdeck.mjs` 替换 `pdeck`。

**结果解读**：只读；version_current 与 release_quiet 事实最值得看

**风险**：只读，无风险

> 确认门（prompt 约定）：若该命令涉及写入（见风险），执行前必须向用户说明并获同意。
