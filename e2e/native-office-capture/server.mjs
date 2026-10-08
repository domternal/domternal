import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/app.mjs', ['app.mjs', 'text/javascript']],
  ['/capture.mjs', ['capture.mjs', 'text/javascript']],
]);
const server = createServer(async (request, response) => {
  const asset = assets.get(request.url);
  if (request.method !== 'GET' || !asset) { response.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(new URL(asset[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(bytes);
  } catch { response.writeHead(500).end(); }
});
server.listen(5896, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); });
