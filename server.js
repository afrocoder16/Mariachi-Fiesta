const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
}

loadEnv(path.join(ROOT, '.env'));

const { SquareApiError, createPaymentRequest, fetchMenuItems, getPublicConfig, verifySquareConnection } = require('./square-config');
const port = Number(process.env.PORT) || 3000;

const publicFiles = new Set([
  'index.html',
  'privacy.html',
  'order-policy.html',
  'styles.css',
  'script.js',
  'shopping-cart.js',
  'site-config.js',
]);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 50_000) throw new SquareApiError('Request body is too large.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new SquareApiError('Request body must be valid JSON.', 400);
  }
}

function serveStatic(requestPath, response, method = 'GET') {
  const relativePath = requestPath === '/' ? 'index.html' : decodeURIComponent(requestPath.slice(1));
  const allowed = publicFiles.has(relativePath) || relativePath.startsWith('images/');
  if (!allowed || relativePath.includes('..')) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const filePath = path.join(ROOT, relativePath);
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': relativePath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'X-Frame-Options': 'DENY',
    });
    response.end(method === 'HEAD' ? undefined : contents);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(response, 200, { ok: true, squareEnvironment: getPublicConfig().environment });
    }
    if (request.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(response, 200, getPublicConfig());
    }
    if (request.method === 'GET' && url.pathname === '/api/square-status') {
      return sendJson(response, 200, await verifySquareConnection());
    }
    if (request.method === 'GET' && url.pathname === '/api/menu') {
      return sendJson(response, 200, { categories: await fetchMenuItems() });
    }
    if (request.method === 'POST' && url.pathname === '/api/payments') {
      const result = await createPaymentRequest(await readJson(request));
      return sendJson(response, 200, { payment: result });
    }
    if (url.pathname.startsWith('/api/')) {
      return sendJson(response, 404, { error: 'API route not found.' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      return response.end('Method not allowed');
    }
    return serveStatic(url.pathname, response, request.method);
  } catch (error) {
    const status = error instanceof SquareApiError ? error.status : 500;
    console.error(`[Server] ${request.method} ${url.pathname}:`, error.message);
    return sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: status === 500 ? 'Square is temporarily unavailable. Please try again.' : error.message,
      ...(process.env.NODE_ENV === 'development' && error.details?.length ? { details: error.details } : {}),
    });
  }
});

server.listen(port, () => {
  console.log(`[Server] Mariachi Fiesta is running at http://localhost:${port}`);
});
