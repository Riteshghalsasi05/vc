const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const port = Number(process.env.PORT) || 5173;
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8'
};

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (error, stats) => {
    const target = !error && stats.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    fs.readFile(target, (readError, content) => {
      if (readError) {
        response.writeHead(readError.code === 'ENOENT' ? 404 : 500).end('File not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream' });
      response.end(content);
    });
  });
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other server or set PORT to a free port.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Virtual Classroom is running at http://localhost:${port}`);
});
