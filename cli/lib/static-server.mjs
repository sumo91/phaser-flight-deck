// ===== 零依赖静态服务器（verify 用，服务 dist/ 等构建产物）=====
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

export function startStaticServer(root, port = 0) {
  return new Promise((resolvePromise) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const rootDir = resolve(root);
        let filePath = join(rootDir, urlPath === '/' ? 'index.html' : urlPath);
        // 边界校验：解码后的 %2e%2e（..）可绕过客户端路径规范化逃出 root——解析后必须仍在 root 内
        if (filePath !== rootDir && !filePath.startsWith(rootDir + sep)) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('not found');
          return;
        }
        // SPA 兜底：无扩展名的路径 → index.html
        if (!extname(filePath)) filePath = join(rootDir, 'index.html');
        const info = await stat(filePath);
        if (info.isDirectory()) filePath = join(filePath, 'index.html');
        const body = await readFile(filePath);
        res.writeHead(200, { 'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
      }
    });
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      resolvePromise({ server, port: actualPort, url: `http://127.0.0.1:${actualPort}/` });
    });
    server.on('error', (error) => {
      resolvePromise({ server: null, error: `静态服务器启动失败: ${error.message}` });
    });
  });
}

export function stopStaticServer(server) {
  return new Promise((resolvePromise) => {
    if (!server) return resolvePromise();
    server.close(() => resolvePromise());
  });
}
