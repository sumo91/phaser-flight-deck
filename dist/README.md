# 多宿主适配器包（自动生成，勿手改）

生成命令：`npm run generate`（源：registry/commands.mjs + skills/phaser4-flight-deck/SKILL.md）
版本：0.6.0

| 宿主 | 安装 |
|---|---|
| Claude Code | 复制 `claude-code/skills/phaser-flight-deck` 到 `~/.claude/skills/`；commands 到 `~/.claude/commands/`；hooks 按 settings.json.example 合入。Windows 推荐把技能目录做成指向 `~/.agents/skills/phaser-flight-deck` 的 junction |
| Cursor | 复制 `cursor/commands/` 到项目 `.cursor/commands/`；技能目录 `.cursor/skills/` 同样建议链接到唯一源 |
| Codex | 复制 `codex/skills/phaser-flight-deck` 到 `$HOME/.agents/skills/`（唯一安装源即此处） |
