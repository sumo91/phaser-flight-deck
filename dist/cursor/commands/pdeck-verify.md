# 验证阶梯（pdeck-verify）

**触发**：当用户要求"验证 / verify / 检查能不能跑"时

**执行**：

```bash
pdeck verify <项目目录>
```

若 `pdeck` 不在 PATH：`node <phaser-flight-deck目录>/cli/pdeck.mjs` 替换 `pdeck`。

**结果解读**：tsc→build→browser 任一阶段 FAILED 即失败；缺 Chrome/构建产物为 INCONCLUSIVE

**风险**：写入 .pdeck 证据（首次需确认）

> 确认门（prompt 约定）：若该命令涉及写入（见风险），执行前必须向用户说明并获同意。
