# 官方 Phaser 技能 vendor 目录（待填充）

将 phaserjs/phaser 仓库 `skills/` 下的官方技能复制到这里，供 Pi 与 Claude 等宿主使用。
官方技能基于 4.0 基线编写，与 4.2.1 实测对照使用（见 ../phaser4-flight-deck/SKILL.md）。

已知官方技能（4.0 时代）：

- `v3-to-v4-migration` —— 全部破坏性变更（主参考）
- `v4-new-features`
- `filters-and-postfx`
- `game-setup-and-config`
- `events-system`

Vendor 方式（保持与引擎版本对齐）：

```bash
# 在 PhaserFlightDeck 根目录：
mkdir -p skills/vendor
git clone --depth 1 --branch v4.2.1 https://github.com/phaserjs/phaser /tmp/phaser-v4
cp -r /tmp/phaser-v4/skills/* skills/vendor/
rm -rf /tmp/phaser-v4
```

注意：vendor 后 `npm test` 会扫描 skills 目录吗？不会——`pdeck check` 只扫目标项目。
vendor 内容遵循 Phaser 仓库的 MIT 许可证，保留原始文件头。
