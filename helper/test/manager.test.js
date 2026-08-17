'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVpnManager, rasdialFailure } = require('../src/vpn/manager');

const config = { requestTimeout: 1100, vpnConnectionName: 'VoiceRoute Canada' };
const logger = { info() {}, debug() {} };

test('connect confirma estado e é idempotente', async () => {
  let connected = false;
  let calls = 0;
  const implementation = {
    getVPNStatus: async () => ({ exists: true, connected, connection: config.vpnConnectionName }),
    connectVPN: async () => { calls += 1; connected = true; },
    disconnectVPN: async () => { connected = false; }
  };
  const manager = createVpnManager(config, logger, implementation);
  assert.equal((await manager.connect()).connected, true);
  assert.equal((await manager.connect()).connected, true);
  assert.equal(calls, 1);
});

test('operações concorrentes são serializadas', async () => {
  let connected = false;
  const order = [];
  const implementation = {
    getVPNStatus: async () => ({ exists: true, connected, connection: config.vpnConnectionName }),
    connectVPN: async () => { order.push('on'); connected = true; },
    disconnectVPN: async () => { order.push('off'); connected = false; }
  };
  const manager = createVpnManager(config, logger, implementation);
  const on = manager.connect();
  const off = manager.disconnect();
  await Promise.all([on, off]);
  assert.deepEqual(order, ['on', 'off']);
  assert.equal((await manager.status()).connected, false);
});

test('VPN inexistente retorna contrato esperado', async () => {
  const implementation = {
    getVPNStatus: async () => ({ exists: false, connected: false, connection: config.vpnConnectionName })
  };
  const result = await createVpnManager(config, logger, implementation).status();
  assert.deepEqual(result, {
    success: false,
    exists: false,
    connected: false,
    error: 'VPN_NOT_FOUND',
    message: "A conexão VPN 'VoiceRoute Canada' não foi encontrada."
  });
});

test('rasdial 691 vira erro imediato de autenticação', async () => {
  const error = rasdialFailure({ code: 691 }, 'connect');
  assert.equal(error.code, 'VPN_AUTH_FAILED');
  assert.equal(error.statusCode, 502);
  assert.match(error.message, /credenciais/i);
});

test('rasdial 691 tenta o conector nativo interativo sem receber credenciais', async () => {
  let connected = false;
  let interactiveCalls = 0;
  const implementation = {
    getVPNStatus: async () => ({ exists: true, connected, connection: config.vpnConnectionName }),
    connectVPN: async () => { const error = new Error('691'); error.code = 691; throw error; },
    connectInteractiveVPN: async () => { interactiveCalls += 1; connected = true; }
  };
  const result = await createVpnManager(config, logger, implementation).connect();
  assert.equal(result.connected, true);
  assert.equal(interactiveCalls, 1);
});
