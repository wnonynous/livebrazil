'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createVpnManager } = require('./vpn/manager');
const { healthRoute } = require('./routes/health');
const { createVpnRoutes } = require('./routes/vpn');

const ALLOWED_ORIGINS = new Set([
  'https://discord.com',
  'https://ptb.discord.com',
  'https://canary.discord.com',
  // Algumas versões do Discord Desktop usam um documento local/opaco.
  'null'
]);

function loadOrCreateToken(root) {
  const dataDir = path.join(root, 'data');
  const tokenPath = path.join(dataDir, 'auth-token.txt');
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (existing.length >= 32) return { token: existing, tokenPath, created: false };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'w' });
  return { token, tokenPath, created: true };
}

function safeEqual(actual, expected) {
  const a = Buffer.from(actual || '', 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
  if (request.headers['access-control-request-private-network'] === 'true') {
    headers['Access-Control-Allow-Private-Network'] = 'true';
  }
  return headers;
}

function createApp({ config, logger, manager, token }) {
  const vpnRoutes = createVpnRoutes(manager);
  const routes = new Map([
    ['GET /health', { public: true, handler: healthRoute }],
    ['GET /vpn/status', { handler: vpnRoutes.status }],
    ['POST /vpn/on', { handler: vpnRoutes.on }],
    ['POST /vpn/off', { handler: vpnRoutes.off }]
  ]);

  function sendJson(request, response, statusCode, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(request)
    });
    response.end(body);
  }

  return async function app(request, response) {
    try {
      const origin = request.headers.origin;
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return sendJson(request, response, 403, { success: false, error: 'ORIGIN_NOT_ALLOWED' });
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { ...corsHeaders(request), 'Content-Length': '0' });
        return response.end();
      }
      const url = new URL(request.url, `http://${config.host}:${config.port}`);
      if (url.search) {
        return sendJson(request, response, 400, { success: false, error: 'QUERY_NOT_ALLOWED' });
      }
      const route = routes.get(`${request.method} ${url.pathname}`);
      if (!route) return sendJson(request, response, 404, { success: false, error: 'NOT_FOUND' });
      if (!route.public) {
        const authorization = request.headers.authorization || '';
        const candidate = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        if (!safeEqual(candidate, token)) {
          return sendJson(request, response, 401, { success: false, error: 'UNAUTHORIZED' });
        }
      }
      if (url.pathname.startsWith('/vpn/') &&
          (Number(request.headers['content-length'] || 0) > 0 || request.headers['transfer-encoding'])) {
        request.resume();
        return sendJson(request, response, 400, { success: false, error: 'REQUEST_BODY_NOT_ALLOWED' });
      }
      return await route.handler(request, response, (res, code, body) => sendJson(request, res, code, body));
    } catch (error) {
      logger.error(`${error.code || 'INTERNAL_ERROR'}: ${error.message}`);
      const statusCode = error.statusCode || (error.code === 'UNSUPPORTED_PLATFORM' ? 501 : 500);
      return sendJson(request, response, statusCode, {
        success: false,
        error: error.code || 'INTERNAL_ERROR',
        message: error.message
      });
    }
  };
}

async function start() {
  const config = loadConfig();
  const logger = createLogger(config.root, config.debug);
  const auth = loadOrCreateToken(config.root);
  const manager = createVpnManager(config, logger);
  const server = http.createServer(createApp({ config, logger, manager, token: auth.token }));
  server.requestTimeout = config.requestTimeout + 5000;
  server.headersTimeout = config.requestTimeout + 10000;

  server.listen(config.port, '127.0.0.1', async () => {
    logger.info('LiveBrazil Helper started');
    logger.info(`Listening on 127.0.0.1:${config.port}`);
    console.log('\nLiveBrazil Helper 1.0.0');
    console.log(`Listening: http://127.0.0.1:${config.port}`);
    console.log(`Authentication token: ${auth.created ? `created at ${auth.tokenPath}` : `loaded from ${auth.tokenPath}`}`);
    console.log('\nVPN:');
    console.log(`  Name: ${config.vpnConnectionName}`);
    try {
      const vpn = await manager.status();
      console.log(`  Found: ${vpn.exists ? 'yes' : 'no'}`);
      console.log(`  Status: ${vpn.connected ? 'connected' : 'disconnected'}`);
    } catch (error) {
      console.log(`  Found: unavailable (${error.code || 'error'})`);
      console.log('  Status: unavailable');
    }
    console.log('\nReady.');
  });

  server.on('error', (error) => {
    logger.error(`Server error: ${error.message}`);
    process.exitCode = 1;
  });
  return server;
}

if (require.main === module) start();

module.exports = { start, createApp, loadOrCreateToken, safeEqual, corsHeaders, ALLOWED_ORIGINS };
