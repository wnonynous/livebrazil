'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp, safeEqual, ALLOWED_ORIGINS } = require('../src/server');

const config = { host: '127.0.0.1', port: 28471 };
const logger = { error() {} };
const manager = {
  status: async () => ({ success: true, exists: true, connected: false, connection: 'VoiceRoute Canada' }),
  connect: async () => ({ success: true, connected: true, connection: 'VoiceRoute Canada' }),
  disconnect: async () => ({ success: true, connected: false, connection: 'VoiceRoute Canada' })
};

async function withServer(run) {
  const server = http.createServer(createApp({ config, logger, manager, token: 'secret-token-that-is-long-enough' }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(server.address().port); } finally { await new Promise((resolve) => server.close(resolve)); }
}

function call(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const { body: requestBody = '', ...requestOptions } = options;
    const request = http.request({ host: '127.0.0.1', port, path, ...requestOptions }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(body || '{}') }));
    });
    request.on('error', reject);
    request.end(requestBody);
  });
}

test('health é público e VPN exige Bearer', async () => withServer(async (port) => {
  assert.equal((await call(port, '/health')).status, 200);
  assert.equal((await call(port, '/vpn/status')).status, 401);
  const authorized = await call(port, '/vpn/status', { headers: { Authorization: 'Bearer secret-token-that-is-long-enough' } });
  assert.equal(authorized.status, 200);
}));

test('CORS aceita Discord conhecido e rejeita origem externa', async () => withServer(async (port) => {
  const discord = await call(port, '/health', { headers: { Origin: 'https://discord.com' } });
  assert.equal(discord.headers['access-control-allow-origin'], 'https://discord.com');
  assert.equal((await call(port, '/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
}));

test('preflight privado é liberado somente para origem permitida', async () => withServer(async (port) => {
  const response = await call(port, '/vpn/status', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://discord.com',
      'Access-Control-Request-Private-Network': 'true'
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers['access-control-allow-private-network'], 'true');
}));

test('não há endpoints de execução', async () => withServer(async (port) => {
  for (const path of ['/shell', '/exec', '/command', '/powershell', '/run']) {
    assert.equal((await call(port, path)).status, 404);
  }
}));

test('rotas VPN rejeitam query e body arbitrários', async () => withServer(async (port) => {
  const headers = { Authorization: 'Bearer secret-token-that-is-long-enough' };
  assert.equal((await call(port, '/vpn/status?name=OutraVPN', { headers })).status, 400);
  const bodyResponse = await call(port, '/vpn/on', {
    method: 'POST',
    headers: { ...headers, 'Content-Length': '2' },
    body: '{}'
  });
  assert.equal(bodyResponse.status, 400);
}));

test('comparação de token e allowlist', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(ALLOWED_ORIGINS.has('*'), false);
});
