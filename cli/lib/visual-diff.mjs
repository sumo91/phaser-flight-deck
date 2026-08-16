// ===== 像素级视觉比对（用浏览器当 PNG 解码器，零新依赖）=====
import { readFileSync } from 'node:fs';
import { launchHeadless } from './browser.mjs';

// 纯比对逻辑（无浏览器依赖，可单元测试）：任一通道差值 > threshold 计为差异像素。
// 浏览器路径通过 toString() 序列化本函数在页面内执行——一份实现两处用。
export function countChangedPixels(dataA, dataB, threshold = 16) {
  const pixels = Math.floor(Math.min(dataA.length, dataB.length) / 4);
  let changed = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    if (
      Math.abs(dataA[i] - dataB[i]) > threshold
      || Math.abs(dataA[i + 1] - dataB[i + 1]) > threshold
      || Math.abs(dataA[i + 2] - dataB[i + 2]) > threshold
    ) changed++;
  }
  return { changed, total: pixels, ratio: pixels ? changed / pixels : 0 };
}

export async function pixelDiff(baselinePath, currentPath, options = {}) {
  const threshold = options.threshold ?? 16;
  const viewport = options.viewport ?? { width: 1280, height: 800 };
  const launched = await launchHeadless();
  if (!launched.ok) return { ok: false, error: launched.error };
  try {
    let b64a;
    let b64b;
    try {
      b64a = readFileSync(baselinePath).toString('base64');
      b64b = readFileSync(currentPath).toString('base64');
    } catch (error) {
      return { ok: false, error: `读取图片失败: ${error.message}` };
    }
    const page = await launched.browser.newPage({ viewport });
    try {
      await page.setContent('<html><body style="margin:0"></body></html>');
      const result = await page.evaluate(async ({ b64a, b64b, threshold, compareSrc }) => {
        const load = (b64) => new Promise((resolvePromise, rejectPromise) => {
          const img = new Image();
          img.onload = () => resolvePromise(img);
          img.onerror = () => rejectPromise(new Error('image decode failed'));
          img.src = 'data:image/png;base64,' + b64;
        });
        const [imgA, imgB] = [await load(b64a), await load(b64b)];
        if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
          return { mismatch: true, sizeA: [imgA.width, imgA.height], sizeB: [imgB.width, imgB.height] };
        }
        const w = imgA.width;
        const h = imgA.height;
        const make = (img) => {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, w, h).data;
        };
        const compare = new Function('return (' + compareSrc + ')')();
        return { mismatch: false, width: w, height: h, ...compare(make(imgA), make(imgB), threshold) };
      }, { b64a, b64b, threshold, compareSrc: countChangedPixels.toString() });
      return { ok: true, ...result };
    } finally {
      await page.close().catch(() => {});
    }
  } catch (error) {
    return { ok: false, error: `视觉比对失败: ${error.message}` };
  } finally {
    await launched.browser.close().catch(() => {});
  }
}
