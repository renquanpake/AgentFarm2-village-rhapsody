// AgentFarm2 静态文件服务器（托管 client/，支持 Range 供大资源）
import http from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../client', import.meta.url));
const PORT = Number(process.env.PORT || 8090);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.css': 'text/css', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.fnt': 'application/octet-stream', '.plist': 'application/octet-stream',
  '.fire': 'application/octet-stream', '.prefab': 'application/octet-stream', '.anim': 'application/octet-stream',
  '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = normalize(join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (!existsSync(filePath)) { res.writeHead(404); return res.end('not found'); }
  const st = statSync(filePath);
  const mime = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  res.setHeader('Cache-Control', 'no-cache');
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? parseInt(m[1]) : 0;
    const end = m && m[2] ? parseInt(m[2]) : st.size - 1;
    res.writeHead(206, { 'Content-Type': mime, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}` });
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    createReadStream(filePath).pipe(res);
  }
}).listen(PORT, () => console.log(`static server: http://127.0.0.1:${PORT}/`));
