'use strict';

const CONNECTED = 'Connected';

function normalizePowerShellResult(value) {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  return {
    name: String(row.Name || ''),
    connectionStatus: String(row.ConnectionStatus || 'Disconnected'),
    allUserConnection: Boolean(row.AllUserConnection)
  };
}

function isConnected(status) {
  return Boolean(status && status.connectionStatus.toLowerCase() === CONNECTED.toLowerCase());
}

module.exports = { normalizePowerShellResult, isConnected };
