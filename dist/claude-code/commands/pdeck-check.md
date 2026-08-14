# v4 API 扫描（pdeck-check）

**触发**：当用户要求"扫描 API / 检查 v4 兼容性 / 找已移除 API"时

**执行**：

```bash
pdeck check <项目目录>
```

若 `pdeck` 不在 PATH：`node <phaser-flight-deck目录>/cli/pdeck.mjs` 替换 `pdeck`。

**结果解读**：removed_api（error 级）必须修；api_warning 是实测坑提醒

**风险**：只读，无风险

> 确认门：写入类操作需 hooks 或用户明确同意（见 hooks/）。
