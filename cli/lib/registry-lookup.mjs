// ===== npm registry 版本对照（离线容忍）=====
import { get } from 'node:https';

function fetchRegistry(url, timeoutMs, maxBytes, headers = {}) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const settle = (value) => {
      if (!settled) { settled = true; resolvePromise(value); }
    };
    const timer = setTimeout(() => settle({ ok: false, error: 'registry_lookup_timeout' }), timeoutMs);
    const req = get(url, { headers: { ...headers } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        clearTimeout(timer);
        return settle({ ok: false, error: `registry_http_${res.statusCode}` });
      }
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > maxBytes) {
          req.destroy();
          settle({ ok: false, error: 'registry_response_too_large' });
        }
      });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          settle({ ok: true, data: JSON.parse(body) });
        } catch (error) {
          settle({ ok: false, error: `registry_json_parse: ${error.message}` });
        }
      });
    });
    req.on('error', (error) => {
      clearTimeout(timer);
      settle({ ok: false, error: `registry_network: ${error.message}` });
    });
  });
}

// 完整版本时间线（含发布时间），供"引擎新鲜度/静默期"判断
// 使用 npm 精简 packument（Accept: vnd.npm.install-v1）避免大响应
const ABBREVIATED = { accept: 'application/vnd.npm.install-v1+json' };

export async function registryTimeline(packageName, timeoutMs = 8000) {
  const result = await fetchRegistry(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
    timeoutMs,
    1024 * 1024,
    ABBREVIATED,
  );
  if (!result.ok) return result;
  const { data } = result;
  const times = data.time ?? {};
  const versions = Object.entries(times)
    .filter(([key]) => key !== 'created' && key !== 'modified' && !key.includes('-'))
    .map(([version, published]) => ({ version, published }))
    .sort((a, b) => (a.published < b.published ? 1 : -1));
  return { ok: true, latest: data['dist-tags']?.latest ?? null, modified: times.modified ?? null, versions: versions.slice(0, 40) };
}

// 单版本快查（latest dist-tag）
export async function registryLatest(packageName, timeoutMs = 5000) {
  const result = await fetchRegistry(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    timeoutMs,
    64 * 1024,
  );
  if (!result.ok) return result;
  return { ok: true, version: typeof result.data.version === 'string' ? result.data.version : null };
}

// 静默期评估：距最近发布的天数
export function quietPeriodDays(timeline, now = Date.now()) {
  if (!timeline?.ok || !timeline.versions?.length) return null;
  const latestPublished = Date.parse(timeline.versions[0].published);
  if (!Number.isFinite(latestPublished)) return null;
  return Math.floor((now - latestPublished) / 86400000);
}
