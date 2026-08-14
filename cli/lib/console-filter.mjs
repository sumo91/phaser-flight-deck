// ===== 控制台错误分类（verify 与 run console/watch 共用，保证裁决一致性）=====

// 良性错误过滤：favicon 404 等资源噪声不应导致裁决失败
export function splitErrors(list) {
  const benign = [];
  const real = [];
  for (const line of list) {
    if (/favicon|404 \(Not Found\)/.test(line)) benign.push(line);
    else real.push(line);
  }
  return { benign, real };
}

// 观察者/环境噪音：无头 SwiftShader 的 GPU 驱动消息、readback 停顿提示——
// 是观察方式造成的，不是游戏问题（真机 GPU 无此项）
const ENV_NOISE_PATTERNS = [
  /GL Driver Message/,
  /GPU stall due to ReadPixels/,
  /SwiftShader/i,
  /GL_CLOSE_PATH_NV/,
  /this message will no longer repeat/,
];

export function isEnvNoise(line) {
  return ENV_NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

export function splitWarnings(list) {
  const envNoise = [];
  const real = [];
  for (const line of list) {
    if (isEnvNoise(line)) envNoise.push(line);
    else real.push(line);
  }
  return { envNoise, real };
}

export function collectBounded(list, limit = 12) {
  return list.slice(0, limit);
}
