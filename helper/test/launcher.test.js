'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runLauncher } = require('../src/launcher');

const logger = { info() {}, warn() {}, error() {} };
const config = {
  discordChannel: 'stable',
  vpnConnectionName: 'VoiceRoute Canada',
  sessionStabilizationDelay: 5
};

test('launcher reinicia Discord entre VPN on e VPN off', async () => {
  const order = [];
  const manager = {
    connect: async () => { order.push('vpn:on'); return { success: true, connected: true }; },
    disconnect: async () => { order.push('vpn:off'); return { success: true, connected: false }; }
  };
  const discord = {
    isRunning: async () => true,
    stop: async () => { order.push('discord:stop'); },
    start: async () => { order.push('discord:start'); },
    waitForSession: async () => { order.push('discord:session'); }
  };
  const wait = async () => { order.push('stabilize'); };
  const result = await runLauncher({ config, logger, manager, discord, wait });
  assert.deepEqual(order, [
    'discord:stop', 'vpn:on', 'discord:start', 'discord:session', 'stabilize', 'vpn:off'
  ]);
  assert.equal(result.route, 'brazil');
});

test('launcher restaura rota quando a sessão do Discord falha', async () => {
  const order = [];
  const manager = {
    connect: async () => { order.push('vpn:on'); return { success: true, connected: true }; },
    disconnect: async () => { order.push('vpn:off'); return { success: true, connected: false }; }
  };
  const discord = {
    isRunning: async () => false,
    start: async () => { order.push('discord:start'); },
    waitForSession: async () => { throw Object.assign(new Error('timeout'), { code: 'DISCORD_SESSION_TIMEOUT' }); }
  };
  await assert.rejects(runLauncher({ config, logger, manager, discord, wait: async () => {} }), {
    code: 'DISCORD_SESSION_TIMEOUT'
  });
  assert.deepEqual(order, ['vpn:on', 'discord:start', 'vpn:off']);
});

test('launcher reabre Discord normal se a VPN falhar após o fechamento', async () => {
  const order = [];
  const manager = {
    connect: async () => { order.push('vpn:on'); throw Object.assign(new Error('auth'), { code: 'VPN_AUTH_FAILED' }); },
    disconnect: async () => { order.push('vpn:off'); }
  };
  const discord = {
    isRunning: async () => true,
    stop: async () => { order.push('discord:stop'); },
    start: async () => { order.push('discord:start'); }
  };
  await assert.rejects(runLauncher({ config, logger, manager, discord, wait: async () => {} }), {
    code: 'VPN_AUTH_FAILED'
  });
  assert.deepEqual(order, ['discord:stop', 'vpn:on', 'discord:start']);
});
