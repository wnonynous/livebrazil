'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'config.json');
const defaults = Object.freeze({
  host: '127.0.0.1',
  port: 28471,
  vpnConnectionName: 'VoiceRoute Canada',
  disconnectDelay: 0,
  requestTimeout: 15000,
  discordChannel: 'stable',
  discordSessionTimeout: 60000,
  sessionStabilizationDelay: 5000,
  debug: true
});

function boundedInteger(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function loadConfig() {
  let supplied = {};
  try {
    supplied = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Configuração inválida: ${error.message}`);
  }

  const vpnConnectionName = typeof supplied.vpnConnectionName === 'string'
    ? supplied.vpnConnectionName.trim()
    : defaults.vpnConnectionName;
  if (!vpnConnectionName || vpnConnectionName.length > 200 || /[\r\n\0]/.test(vpnConnectionName)) {
    throw new Error('vpnConnectionName inválido em config/config.json');
  }
  const discordChannel = ['stable', 'ptb', 'canary'].includes(supplied.discordChannel)
    ? supplied.discordChannel
    : defaults.discordChannel;

  return Object.freeze({
    // Deliberadamente fixo: config.json nunca pode expor o helper à rede.
    host: '127.0.0.1',
    port: boundedInteger(supplied.port, defaults.port, 1024, 65535),
    vpnConnectionName,
    disconnectDelay: boundedInteger(supplied.disconnectDelay, defaults.disconnectDelay, 0, 60000),
    requestTimeout: boundedInteger(supplied.requestTimeout, defaults.requestTimeout, 1000, 120000),
    discordChannel,
    discordSessionTimeout: boundedInteger(
      supplied.discordSessionTimeout,
      defaults.discordSessionTimeout,
      10000,
      180000
    ),
    sessionStabilizationDelay: boundedInteger(
      supplied.sessionStabilizationDelay,
      defaults.sessionStabilizationDelay,
      0,
      30000
    ),
    debug: typeof supplied.debug === 'boolean' ? supplied.debug : defaults.debug,
    root: ROOT
  });
}

module.exports = { loadConfig, defaults, CONFIG_PATH };
