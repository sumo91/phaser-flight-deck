# 全量回归（pdeck-regression）

**触发**：当用户要求"全量回归 / 完整验证 / 上线前检查"时

**执行**：

```bash
pdeck regression <项目目录> --timeout 600
```

若 `pdeck` 不在 PATH：`node <phaser-flight-deck目录>/cli/pdeck.mjs` 替换 `pdeck`。

**结果解读**：verdict=FAILED 时按 decisiveStage 修；INCONCLUSIVE=缺前置（基线/剖面）

**风险**：写入 .pdeck 证据（首次需确认）

> 确认门（prompt 约定）：若该命令涉及写入（见风险），执行前必须向用户说明并获同意。
