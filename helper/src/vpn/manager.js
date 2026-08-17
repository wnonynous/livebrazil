'use strict';

const { createWindowsVpn } = require('./windowsVpn');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicStatus(status) {
  if (!status.exists) {
    return {
      success: false,
      exists: false,
      connected: false,
      error: 'VPN_NOT_FOUND',
      message: `A conexão VPN '${status.connection}' não foi encontrada.`
    };
  }
  return {
    success: true,
    exists: true,
    connected: status.connected,
    connection: status.connection
  };
}

function rasdialFailure(error, action) {
  const rasCode = Number(error?.rasCode ?? error?.code);
  const failures = {
    691: ['VPN_AUTH_FAILED', 'O Windows recusou as credenciais da VPN. Conecte-a manualmente nas Configurações do Windows e salve credenciais válidas.'],
    789: ['VPN_SECURITY_NEGOTIATION_FAILED', 'O Windows não conseguiu negociar a camada de segurança da VPN.'],
    809: ['VPN_SERVER_UNREACHABLE', 'O servidor VPN não respondeu ou está bloqueado pela rede/firewall.'],
    868: ['VPN_SERVER_NAME_NOT_RESOLVED', 'O endereço do servidor VPN não pôde ser resolvido.']
  };
  const [code, message] = failures[rasCode] || [
    action === 'connect' ? 'VPN_CONNECTION_FAILED' : 'VPN_DISCONNECTION_FAILED',
    action === 'connect'
      ? 'O Windows não conseguiu conectar a VPN.'
      : 'O Windows não conseguiu desconectar a VPN.'
  ];
  const failure = new Error(message);
  failure.code = code;
  failure.statusCode = 502;
  failure.rasCode = Number.isFinite(rasCode) ? rasCode : undefined;
  return failure;
}

function createVpnManager(config, logger, implementation = createWindowsVpn(config)) {
  let operation = Promise.resolve();

  function serialized(task) {
    const result = operation.then(task, task);
    operation = result.catch(() => undefined);
    return result;
  }

  async function status() {
    return publicStatus(await implementation.getVPNStatus());
  }

  async function waitFor(expected, deadline = Date.now() + config.requestTimeout) {
    let last;
    while (Date.now() <= deadline) {
      last = await implementation.getVPNStatus();
      if (last.exists && last.connected === expected) return publicStatus(last);
      await delay(500);
    }
    const error = new Error(expected
      ? 'A VPN demorou demais para conectar.'
      : 'A VPN demorou demais para desconectar.');
    error.code = expected ? 'VPN_CONNECTION_TIMEOUT' : 'VPN_DISCONNECTION_TIMEOUT';
    error.statusCode = 504;
    error.lastStatus = last;
    throw error;
  }

  function connect() {
    return serialized(async () => {
      const operationDeadline = Date.now() + config.requestTimeout;
      const current = await implementation.getVPNStatus();
      if (!current.exists) return publicStatus(current);
      if (current.connected) return publicStatus(current);
      logger.info('VPN connect requested');
      let commandError = null;
      try {
        await implementation.connectVPN();
      } catch (error) {
        commandError = error;
        logger.debug(`rasdial connect returned ${error.code || 'error'}; confirming Windows state`);
      }
      const confirmed = await implementation.getVPNStatus();
      if (confirmed.exists && confirmed.connected) {
        logger.info('VPN connected');
        return publicStatus(confirmed);
      }
      if (Number(commandError?.code) === 691 && implementation.connectInteractiveVPN) {
        logger.info('Windows VPN connector requested after rasdial authentication rejection');
        await implementation.connectInteractiveVPN();
        try {
          const result = await waitFor(true, operationDeadline);
          logger.info('VPN connected');
          return result;
        } catch {
          throw rasdialFailure(commandError, 'connect');
        }
      }
      if (commandError) throw rasdialFailure(commandError, 'connect');
      const result = await waitFor(true, operationDeadline);
      logger.info('VPN connected');
      return result;
    });
  }

  function disconnect() {
    return serialized(async () => {
      const current = await implementation.getVPNStatus();
      if (!current.exists) return publicStatus(current);
      if (!current.connected) return publicStatus(current);
      logger.info('VPN disconnect requested');
      let commandError = null;
      try {
        await implementation.disconnectVPN();
      } catch (error) {
        commandError = error;
        logger.debug(`rasdial disconnect returned ${error.code || 'error'}; confirming Windows state`);
      }
      const confirmed = await implementation.getVPNStatus();
      if (confirmed.exists && !confirmed.connected) {
        logger.info('VPN disconnected');
        return publicStatus(confirmed);
      }
      if (commandError) throw rasdialFailure(commandError, 'disconnect');
      const result = await waitFor(false);
      logger.info('VPN disconnected');
      return result;
    });
  }

  return { status, connect, disconnect, _serialized: serialized };
}

module.exports = { createVpnManager, publicStatus, rasdialFailure };
