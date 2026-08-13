// ===== 控制台错误分类（verify 与 run console 共用，保证裁决一致性）=====

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

export function collectBounded(list, limit = 12) {
  return list.slice(0, limit);
}
