'use strict';

const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { normalizePowerShellResult, isConnected } = require('./status');

const execFileAsync = promisify(execFile);
const POWERSHELL_QUERY = [
  "$ErrorActionPreference='Stop'",
  "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()",
  "$name=$env:VOICEROUTE_VPN_NAME",
  "$vpn=Get-VpnConnection -Name $name -ErrorAction SilentlyContinue",
  "if(-not $vpn){$vpn=Get-VpnConnection -Name $name -AllUserConnection -ErrorAction SilentlyContinue}",
  "if($vpn){$vpn | Select-Object Name,ConnectionStatus,AllUserConnection | ConvertTo-Json -Compress}",
  // Get-VpnConnection define um exit code não-zero quando o nome não existe,
  // mesmo com SilentlyContinue. Ausência é um estado válido, não falha do processo.
  "exit 0"
].join(';');

function createWindowsVpn(config) {
  const commandTimeout = Math.max(config.requestTimeout, 5000);

  async function queryPowerShell() {
    if (process.platform !== 'win32') {
      const error = new Error('VoiceRoute requer Windows 10 ou 11.');
      error.code = 'UNSUPPORTED_PLATFORM';
      throw error;
    }
    let stdout;
    try {
      ({ stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_QUERY],
        {
          windowsHide: true,
          timeout: commandTimeout,
          maxBuffer: 1024 * 1024,
          encoding: 'utf8',
          env: { ...process.env, VOICEROUTE_VPN_NAME: config.vpnConnectionName }
        }
      ));
    } catch (cause) {
      const error = new Error('Não foi possível consultar as conexões VPN do Windows.');
      error.code = 'VPN_STATUS_FAILED';
      error.cause = cause;
      throw error;
    }
    const output = stdout.trim().replace(/^\uFEFF/, '');
    if (!output) return null;
    try {
      return normalizePowerShellResult(JSON.parse(output));
    } catch {
      const error = new Error('O Windows retornou um estado de VPN inválido.');
      error.code = 'VPN_STATUS_INVALID';
      throw error;
    }
  }

  async function getVPNStatus() {
    const details = await queryPowerShell();
    return {
      exists: Boolean(details),
      connected: isConnected(details),
      connection: config.vpnConnectionName,
      details
    };
  }

  async function vpnExists() {
    return (await getVPNStatus()).exists;
  }

  async function runRasdial(args) {
    try {
      return await execFileAsync('rasdial.exe', args, {
        windowsHide: true,
        timeout: commandTimeout,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8'
      });
    } catch (error) {
      // rasdial usa exit codes não-zero; o chamador sempre confirma o estado real.
      error.code = error.code || 'RASDIAL_FAILED';
      throw error;
    }
  }

  async function connectVPN() {
    const args = [config.vpnConnectionName];
    if (config.vpnUsername && config.vpnPassword) {
      args.push(config.vpnUsername, config.vpnPassword);
    }
    await runRasdial(args);
    return getVPNStatus();
  }

  async function disconnectVPN() {
    await runRasdial([config.vpnConnectionName, '/disconnect']);
    return getVPNStatus();
  }

  async function connectInteractiveVPN() {
    if (process.platform !== 'win32') {
      const error = new Error('LiveBrazil requer Windows 10 ou 11.');
      error.code = 'UNSUPPORTED_PLATFORM';
      throw error;
    }
    return new Promise((resolve, reject) => {
      const child = spawn('rasphone.exe', ['-d', config.vpnConnectionName], {
        windowsHide: false,
        detached: true,
        stdio: 'ignore'
      });
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
      child.once('error', () => {
        const error = new Error('Não foi possível abrir o conector de VPN do Windows.');
        error.code = 'RASPHONE_FAILED';
        reject(error);
      });
    });
  }

  return { vpnExists, connectVPN, connectInteractiveVPN, disconnectVPN, getVPNStatus };
}

module.exports = { createWindowsVpn, POWERSHELL_QUERY };
