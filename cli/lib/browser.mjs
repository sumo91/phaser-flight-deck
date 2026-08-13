// ===== 浏览器驱动（playwright-core + 系统 Chrome/Edge，优雅降级）=====
import { existsSync } from 'node:fs';

const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function findBrowserExecutable() {
  for (const path of CHROME_PATHS) {
    if (existsSync(path)) return path;
  }
  return null;
}

export function browserAvailability() {
  const executable = findBrowserExecutable();
  return {
    executable,
    channel: executable && executable.toLowerCase().includes('edge') ? 'msedge' : 'chrome',
    missing: !executable ? '未找到系统 Chrome/Edge 浏览器' : null,
  };
}

let playwrightCache = null;

export async function loadPlaywright() {
  if (playwrightCache) return playwrightCache;
  try {
    playwrightCache = await import('playwright-core');
    return playwrightCache;
  } catch (error) {
    playwrightCache = { error: `playwright-core 不可用（cd <tool目录> && npm install 后重试）: ${error.message}` };
    return playwrightCache;
  }
}

export async function launchHeadless(options = {}) {
  const availability = browserAvailability();
  if (availability.missing) return { ok: false, error: availability.missing };
  const pw = await loadPlaywright();
  if (pw.error) return { ok: false, error: pw.error };
  try {
    const browser = await pw.chromium.launch({
      channel: availability.channel,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--mute-audio'],
      ...options,
    });
    return { ok: true, browser };
  } catch (error) {
    return { ok: false, error: `浏览器启动失败: ${error.message}` };
  }
}

// 打开页面并采集基础状态
export async function openPage(browser, url, viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage({ viewport });
  const consoleErrors = [];
  const pageErrors = [];
  const consoleWarnings = [];
  page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 300)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
    else if (msg.type() === 'warning') consoleWarnings.push(msg.text().slice(0, 300));
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  return { page, consoleErrors, pageErrors, consoleWarnings };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function collectBounded(list, limit = 12) {
  return list.slice(0, limit);
}
