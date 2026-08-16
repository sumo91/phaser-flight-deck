// ===== Phaser v4 API 规则表（版本化）=====
// 来源：官方 v3→v4 迁移指南（skills/v3-to-v4-migration，4.0 基线）
//       + Phaser Flight Deck 实测踩坑（source: session-empirical，4.2.1 实测）
// 每条规则声明引入版本 since，允许按项目实际安装版本裁剪。

const RULE = (id, severity, since, summary, pattern, fix, source, extra = {}) => ({
  id, severity, since, summary, fix, source,
  pattern: pattern instanceof RegExp ? pattern : new RegExp(pattern),
  ...extra,
});

export const V4_RULES = Object.freeze([

  // ===== 已移除 API（error）=====
  RULE('tint-fill', 'error', '4.0.0',
    'setTintFill()/tintFill 已移除',
    /\.setTintFill\s*\(/,
    'sprite.setTint(color).setTintMode(Phaser.TintModes.FILL)',
    'official-migration-guide'),
  RULE('math-pi2', 'error', '4.0.0',
    'Math.PI2 已移除',
    /Phaser\.Math\.PI2\b/,
    '使用 Phaser.Math.TAU（v4 中 TAU = 2π）',
    'official-migration-guide'),
  RULE('geom-point', 'error', '4.0.0',
    'Geom.Point 已移除，改用 Math.Vector2',
    /Phaser\.Geom\.Point\b/,
    'new Phaser.Math.Vector2(x, y)',
    'official-migration-guide'),
  RULE('struct-set', 'error', '4.0.0',
    'Phaser.Struct.Set 已移除',
    /Phaser\.Struct\.Set\b/,
    '使用原生 Set',
    'official-migration-guide'),
  RULE('struct-map', 'error', '4.0.0',
    'Phaser.Struct.Map 已移除',
    /Phaser\.Struct\.Map\b/,
    '使用原生 Map',
    'official-migration-guide'),
  RULE('create-generate-texture', 'error', '4.0.0',
    'Create.GenerateTexture / TextureManager.generate 已移除',
    /Phaser\.Create\.GenerateTexture\b|\.textures\.generate\s*\(/,
    '用 document.createElement("canvas") 自绘 + textures.addCanvas(key, canvas)',
    'official-migration-guide'),
  RULE('bitmap-mask', 'error', '4.0.0',
    'BitmapMask 已移除',
    /Phaser\.Display\.Masks\.BitmapMask\b/,
    '用 Mask filter：sprite.filters.internal.addMask(maskObject)',
    'official-migration-guide'),
  // FX 规则双序匹配：Bloom/Shine 无论出现在 setPostPipeline/postFX 之前还是之后都命中
  //（`sprite.setPostPipeline('Bloom')` 是迁移指南里的常见写法，单向匹配会漏报；
  //  同原规则语义：同行任意字符、不跨行）
  RULE('fx-bloom', 'error', '4.0.0',
    'FX Bloom 已移除',
    /\bBloom\b.*(?:setPostPipeline|postFX|\bFX\b)|(?:setPostPipeline|postFX|\bFX\b).*\bBloom\b/,
    'Phaser.Actions.AddEffectBloom()',
    'official-migration-guide'),
  RULE('fx-shine', 'error', '4.0.0',
    'FX Shine 已移除',
    /\bShine\b.*(?:setPostPipeline|postFX|\bFX\b)|(?:setPostPipeline|postFX|\bFX\b).*\bShine\b/,
    'Phaser.Actions.AddEffectShine()',
    'official-migration-guide'),
  RULE('pipeline-light2d', 'error', '4.0.0',
    'setPipeline("Light2D") 光照管线已移除',
    /\.setPipeline\s*\(\s*['"]Light2D['"]\s*\)/,
    'sprite.setLighting(true)',
    'official-migration-guide'),
  RULE('mesh-plane', 'error', '4.0.0',
    'Mesh/Plane 游戏对象已移除',
    /\b(?:new\s+Phaser\.GameObjects\.)?(Mesh|Plane)\s*\(/,
    'v4 移除有限 3D 实现；2D 用 Image/Shape 组合',
    'official-migration-guide'),
  RULE('camera3d', 'error', '4.0.0',
    'Camera3D 插件已移除',
    /Camera3D\b/,
    'v4 无内置 3D 相机',
    'official-migration-guide'),
  RULE('sin-cos-table', 'error', '4.0.0',
    'Math.SinCosTableGenerator 已移除',
    /SinCosTableGenerator\b/,
    '直接使用 Math.sin/Math.cos',
    'official-migration-guide'),

  // ===== 语义变化（warn）=====
  RULE('math-tau', 'warn', '4.0.0',
    'Math.TAU 语义变化：v3 为 π/2，v4 为 2π',
    /Phaser\.Math\.TAU\b/,
    '若原本期望 π/2，改用 Phaser.Math.PI_OVER_2',
    'official-migration-guide'),
  RULE('colormatrix-methods', 'warn', '4.0.0',
    'ColorMatrix 滤镜方法移至 .colorMatrix 属性',
    /(?:\.sepia\(\)|\.greyscale\(\)|\.grayscale\(\))/,
    'colorMatrix.colorMatrix.sepia()',
    'official-migration-guide'),
  RULE('dynamictexture-render', 'warn', '4.0.0',
    'DynamicTexture/RenderTexture 绘制后需调用 render()',
    /\b(?:DynamicTexture|RenderTexture)\b/,
    'v4 中绘制命令被缓冲，须显式 render() 才生效',
    'official-migration-guide'),
  RULE('round-pixels', 'warn', '4.0.0',
    'roundPixels 默认值变为 false',
    /roundPixels\s*:\s*true/,
    'v4 默认关闭；如需逐对象控制用 vertexRoundMode',
    'official-migration-guide'),
  RULE('shader-constructor', 'warn', '4.0.0',
    'Shader 构造签名改为 ShaderQuadConfig 对象',
    /new\s+Phaser\.GameObjects\.Shader\s*\(\s*[^,{]/,
    'v4 需传入配置对象，时间/分辨率等 uniform 不再自动设置',
    'official-migration-guide'),

  // ===== 实测性能/正确性坑（session-empirical，4.2.1 实测）=====
  RULE('addcanvas-usage', 'warn', '4.2.1',
    'textures.addCanvas 使用点：大纹理有 GPU ReadPixels 回读卡死风险；高频/唯一 key 调用会累积纹理',
    /\.textures\.addCanvas\s*\(/,
    '实测：1280×720 Canvas 纹理曾卡死主线程（GL readback）；大背景改用 Graphics 矢量绘制；纹理 key 按外观规格缓存，勿在循环内按唯一 id 生成。',
    'session-empirical'),
]);

export const RULE_IDS = Object.freeze(Object.fromEntries(V4_RULES.map((rule) => [rule.id, rule])));

// 在文件内容中匹配规则，返回有界 findings
export function scanSource(filePath, content, rules = V4_RULES, options = {}) {
  const findings = [];
  const lines = content.split('\n');
  for (const rule of rules) {
    if (options.severity === 'error' && rule.severity !== 'error') continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(line);
      if (!match) continue;
      findings.push({
        file: filePath,
        line: i + 1,
        rule: rule.id,
        severity: rule.severity,
        since: rule.since,
        summary: rule.summary,
        snippet: line.trim().slice(0, 140),
        fix: rule.fix,
        source: rule.source,
      });
    }
  }
  return findings;
}

// 纹理 key 引用校验（启发式）
// createdPatterns 复用于项目级聚合：集中式 PreloadScene 是 Phaser 常见模式，
// 逐文件判定会对跨文件引用成片误报——先全项目收集创建点，再逐文件判悬空。
// 接收者放宽：tex.addCanvas / const load = this.load 等别名写法都要能命中（StarValley 实测）。
const TEXTURE_CREATED_PATTERNS = [
  /\.addCanvas\s*\(\s*['"]([^'"]+)['"]/,
  /\bload\s*\.\s*(?:image|spritesheet|atlas|multiatlas)\s*\(\s*['"]([^'"]+)['"]/,
  /\.generateTexture\s*\(\s*['"]([^'"]+)['"]/,
  /\.addDynamicTexture\s*\(\s*['"]([^'"]+)['"]/,
];

// 收集一个文件内容中静态创建的纹理 key（供项目级聚合）
export function collectCreatedKeys(content) {
  const keys = new Set();
  for (const line of content.split('\n')) {
    for (const pattern of TEXTURE_CREATED_PATTERNS) {
      const m = pattern.exec(line);
      if (m) keys.add(m[1]);
    }
  }
  return keys;
}

export function textureKeyFindings(filePath, content, options = {}) {
  const findings = [];
  const created = new Set();
  const used = [];
  const lines = content.split('\n');
  // 动态纹理工厂（addCanvas/getTex 用变量 key）→ 该文件的未解析 key 不可靠，整体跳过
  let dynamicFactory = false;
  const factoryPatterns = [
    /\.addCanvas\s*\(\s*[A-Za-z_$][\w$]*\s*,/,
    /\bgetTex\s*\(\s*[A-Za-z_$][\w$]*\s*,/,
  ];
  const usedPatterns = [
    /\.add\.(?:image|sprite|tileSprite|particles)\s*\(\s*[^,]+,\s*[^,]+,\s*['"]([^'"]+)['"]/,
    /\.textures\.get\s*\(\s*['"]([^'"]+)['"]/,
    /\.setTexture\s*\(\s*['"]([^'"]+)['"]/,
  ];
  for (const line of lines) {
    if (!dynamicFactory && factoryPatterns.some((pattern) => pattern.test(line))) dynamicFactory = true;
    for (const pattern of TEXTURE_CREATED_PATTERNS) {
      const m = pattern.exec(line);
      if (m) created.add(m[1]);
    }
    for (const pattern of usedPatterns) {
      const m = pattern.exec(line);
      if (m) used.push({ key: m[1], line: line.trim().slice(0, 140) });
    }
  }
  if (dynamicFactory) return findings; // 动态工厂：本文件 key 校验不可靠，静默跳过
  const projectKeys = options.projectKeys;
  for (const use of used) {
    if (created.has(use.key)) continue;
    if (projectKeys && projectKeys.has(use.key)) continue; // 全项目任意文件的静态创建点
    // 排除明显动态 key（拼接/变量）
    if (/[+$.]/.test(use.key)) continue;
    findings.push({ key: use.key, snippet: use.line, hint: 'key 未在全项目可见的创建点（load/addCanvas/generateTexture）中找到——运行时动态创建除外' });
  }
  return findings;
}

// 源文件扩展名过滤
export const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|gd)$/;
