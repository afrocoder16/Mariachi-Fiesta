const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
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

const { SquareApiError, createCheckoutRequest, createPaymentRequest, fetchMenuItems, getPublicConfig } = require('./square-config');
const configuredPort = Number(process.env.PORT);
const port = Number.isInteger(configuredPort) && configuredPort >= 0 ? configuredPort : 3000;
const squareEnvironment = getPublicConfig().environment;
const squareWebOrigin = squareEnvironment === 'production'
  ? 'https://web.squarecdn.com'
  : 'https://sandbox.web.squarecdn.com';
const squarePciOrigin = squareEnvironment === 'production'
  ? 'https://pci-connect.squareup.com'
  : 'https://pci-connect.squareupsandbox.com';
// Hash of the Restaurant JSON-LD block in index.html. The security test keeps
// this value synchronized if that structured data changes.
const structuredDataHash = "'sha256-CPNOCjQfz5veTz4vHsllIUuYo/bBQIuQTr4C2A0vfVI='";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' ${structuredDataHash} ${squareWebOrigin}`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${squareWebOrigin}`,
  "font-src 'self' data: https://fonts.gstatic.com https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net",
  "img-src 'self' data: https:",
  `frame-src 'self' https://maps.google.com https://www.google.com ${squareWebOrigin}`,
  `connect-src 'self' https://places.googleapis.com ${squareWebOrigin} ${squarePciOrigin} https://o160250.ingest.sentry.io`,
  "media-src 'self'",
  "worker-src 'self'",
].join('; ');
const securityHeaders = Object.freeze({
  'Content-Security-Policy': contentSecurityPolicy,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY',
  'X-Permitted-Cross-Domain-Policies': 'none',
  ...(squareEnvironment === 'production' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
});
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_MAX_BUCKETS = 10_000;
const rateLimitedPaths = new Set(['/api/menu', '/api/checkout', '/api/payments']);
const rateLimitBuckets = new Map();

function normalizeIp(value) {
  const candidate = String(value || '').trim();
  if (candidate.startsWith('::ffff:') && net.isIP(candidate.slice(7)) === 4) return candidate.slice(7);
  return net.isIP(candidate) ? candidate : '';
}

const trustedProxyIps = new Set(
  String(process.env.TRUSTED_PROXY_IPS || '')
    .split(',')
    .map(normalizeIp)
    .filter(Boolean)
);

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

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, message, extraHeaders = {}) {
  response.writeHead(status, {
    ...securityHeaders,
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(message);
}

function getClientIp(request) {
  const remoteIp = normalizeIp(request.socket.remoteAddress) || 'unknown';
  if (!trustedProxyIps.has(remoteIp)) return remoteIp;

  // Only a configured reverse proxy may supply the forwarding chain. Walk it
  // from the trusted socket toward the client so a user-provided leftmost
  // X-Forwarded-For value cannot skip over an untrusted address.
  const forwarded = String(request.headers['x-forwarded-for'] || '')
    .split(',')
    .map(normalizeIp)
    .filter(Boolean);
  let clientIp = remoteIp;
  for (let index = forwarded.length - 1; index >= 0 && trustedProxyIps.has(clientIp); index -= 1) {
    clientIp = forwarded[index];
  }
  return clientIp;
}

function checkRateLimit(request, pathname) {
  const now = Date.now();
  const key = `${getClientIp(request)}:${pathname}`;
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    if (!bucket && rateLimitBuckets.size >= RATE_LIMIT_MAX_BUCKETS) {
      return {
        allowed: false,
        headers: {
          'RateLimit-Limit': String(RATE_LIMIT_MAX),
          'RateLimit-Remaining': '0',
          'RateLimit-Reset': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)),
          'Retry-After': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)),
        },
      };
    }
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.count += 1;

  const remaining = Math.max(0, RATE_LIMIT_MAX - bucket.count);
  const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return {
    allowed: bucket.count <= RATE_LIMIT_MAX,
    headers: {
      'RateLimit-Limit': String(RATE_LIMIT_MAX),
      'RateLimit-Remaining': String(remaining),
      'RateLimit-Reset': String(resetSeconds),
      ...(bucket.count > RATE_LIMIT_MAX ? { 'Retry-After': String(resetSeconds) } : {}),
    },
  };
}

const rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  rateLimitBuckets.forEach((bucket, key) => {
    if (now >= bucket.resetAt) rateLimitBuckets.delete(key);
  });
}, RATE_LIMIT_WINDOW_MS);
rateLimitCleanup.unref();

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

function requireJsonContentType(request) {
  const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new SquareApiError('Content-Type must be application/json.', 415);
  }
}

function serveStatic(requestPath, response, method = 'GET') {
  const relativePath = requestPath === '/' ? 'index.html' : decodeURIComponent(requestPath.slice(1));
  const allowed = publicFiles.has(relativePath) || relativePath.startsWith('images/');
  if (!allowed || relativePath.includes('..')) {
    return sendText(response, 404, 'Not found');
  }

  const filePath = path.join(ROOT, relativePath);
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      return sendText(response, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : 'Server error');
    }
    response.writeHead(200, {
      ...securityHeaders,
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': relativePath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
    });
    response.end(method === 'HEAD' ? undefined : contents);
  });
}

const server = http.createServer(async (request, response) => {
  let url;

  try {
    // request.url is path-relative; a fixed base prevents a malformed Host
    // header from becoming an input to URL parsing.
    url = new URL(request.url || '/', 'http://localhost');
    let rateLimitHeaders = {};
    if (rateLimitedPaths.has(url.pathname)) {
      const rateLimit = checkRateLimit(request, url.pathname);
      rateLimitHeaders = rateLimit.headers;
      if (!rateLimit.allowed) {
        return sendJson(response, 429, { error: 'Too many requests. Please wait a minute and try again.' }, rateLimitHeaders);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(response, 200, { ok: true, squareEnvironment: getPublicConfig().environment });
    }
    if (request.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(response, 200, getPublicConfig());
    }
    if (request.method === 'GET' && url.pathname === '/api/menu') {
      return sendJson(response, 200, { categories: await fetchMenuItems() }, rateLimitHeaders);
    }
    if (request.method === 'POST' && url.pathname === '/api/checkout') {
      requireJsonContentType(request);
      const checkout = await createCheckoutRequest(await readJson(request));
      return sendJson(response, 200, { checkout }, rateLimitHeaders);
    }
    if (request.method === 'POST' && url.pathname === '/api/payments') {
      requireJsonContentType(request);
      const result = await createPaymentRequest(await readJson(request));
      return sendJson(response, 200, { payment: result }, rateLimitHeaders);
    }
    if (url.pathname.startsWith('/api/')) {
      return sendJson(response, 404, { error: 'API route not found.' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendText(response, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }
    return serveStatic(url.pathname, response, request.method);
  } catch (error) {
    const status = error instanceof SquareApiError ? error.status : 500;
    console.error(`[Server] ${request.method} ${url?.pathname || '[invalid request]'}:`, error.message);
    return sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: status >= 500 ? 'Square is temporarily unavailable. Please try again.' : error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.data && typeof error.data === 'object' ? error.data : {}),
      ...(process.env.NODE_ENV === 'development' && error.details?.length ? { details: error.details } : {}),
    });
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

server.listen(port, () => {
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : port;
  console.log(`[Server] Mariachi Fiesta is running on port ${listeningPort}`);
});

module.exports = { server };
