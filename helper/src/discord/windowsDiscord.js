'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const CHANNELS = Object.freeze({
  stable: { folder: 'Discord', processName: 'Discord' },
  ptb: { folder: 'DiscordPTB', processName: 'DiscordPTB' },
  canary: { folder: 'DiscordCanary', processName: 'DiscordCanary' }
});

const PROCESS_QUERY = [
  "$items=Get-Process -Name $env:LIVEBRAZIL_DISCORD_PROCESS -ErrorAction SilentlyContinue",
  "@($items | Select-Object -ExpandProperty Id) | ConvertTo-Json -Compress"
].join(';');

const SESSION_QUERY = [
  "$ids=@(Get-Process -Name $env:LIVEBRAZIL_DISCORD_PROCESS -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)",
  "if($ids.Count -gt 0){",
  "$connections=@(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object {$ids -contains $_.OwningProcess})",
  "if($connections.Count -gt 0){'true'}else{'false'}",
  "}else{'false'}"
].join(';');

const CLOSE_QUERY = [
  "$items=@(Get-Process -Name $env:LIVEBRAZIL_DISCORD_PROCESS -ErrorAction SilentlyContinue)",
  "foreach($item in $items){if($item.MainWindowHandle -ne 0){[void]$item.CloseMainWindow()}}",
  "exit 0"
].join(';');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWindowsDiscord(config, logger, dependencies = {}) {
  const channel = CHANNELS[config.discordChannel] || CHANNELS.stable;
  const run = dependencies.execFileAsync || execFileAsync;
  const spawnProcess = dependencies.spawn || spawn;
  const localAppData = dependencies.localAppData || process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error('LOCALAPPDATA não está disponível.');

  const localRoot = path.resolve(localAppData);
  const installRoot = path.resolve(localRoot, channel.folder);
  if (!installRoot.startsWith(`${localRoot}${path.sep}`)) {
    throw new Error('Diretório do Discord fora de LOCALAPPDATA.');
  }
  const updateExecutable = path.join(installRoot, 'Update.exe');
  const processExecutable = `${channel.processName}.exe`;
  const commandOptions = {
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    encoding: 'utf8',
    env: { ...process.env, LIVEBRAZIL_DISCORD_PROCESS: channel.processName }
  };

  async function powershell(script) {
    if (process.platform !== 'win32' && !dependencies.allowNonWindows) {
      const error = new Error('O launcher do LiveBrazil requer Windows 10 ou 11.');
      error.code = 'UNSUPPORTED_PLATFORM';
      throw error;
    }
    return run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
    ], commandOptions);
  }

  async function getProcessIds() {
    const { stdout } = await powershell(PROCESS_QUERY);
    const output = stdout.trim().replace(/^\uFEFF/, '');
    if (!output) return [];
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed]).map(Number).filter(Number.isInteger);
  }

  async function isRunning() {
    return (await getProcessIds()).length > 0;
  }

  async function hasEstablishedSession() {
    const { stdout } = await powershell(SESSION_QUERY);
    return stdout.trim().toLowerCase() === 'true';
  }

  async function stop() {
    if (!(await isRunning())) return false;
    logger.info('Requesting Discord shutdown');
    await powershell(CLOSE_QUERY);
    const gracefulDeadline = Date.now() + 8000;
    while (Date.now() < gracefulDeadline) {
      if (!(await isRunning())) {
        logger.info('Discord stopped');
        return true;
      }
      await delay(500);
    }
    logger.warn('Discord did not close gracefully; terminating fixed Discord process name');
    try {
      await run('taskkill.exe', ['/IM', processExecutable, '/T', '/F'], {
        windowsHide: true,
        timeout: 10000,
        encoding: 'utf8'
      });
    } catch (error) {
      if (await isRunning()) {
        const failure = new Error('Não foi possível encerrar o Discord para reiniciar a sessão.');
        failure.code = 'DISCORD_STOP_FAILED';
        failure.cause = error;
        throw failure;
      }
    }
    logger.info('Discord stopped');
    return true;
  }

  async function start() {
    if (!fs.existsSync(updateExecutable)) {
      const error = new Error(`Discord ${config.discordChannel} não foi encontrado em LOCALAPPDATA.`);
      error.code = 'DISCORD_NOT_FOUND';
      throw error;
    }
    logger.info(`Starting Discord channel ${config.discordChannel}`);
    return new Promise((resolve, reject) => {
      const child = spawnProcess(updateExecutable, ['--processStart', processExecutable], {
        cwd: installRoot,
        windowsHide: false,
        detached: true,
        stdio: 'ignore'
      });
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
      child.once('error', () => {
        const error = new Error('O Windows não conseguiu iniciar o Discord.');
        error.code = 'DISCORD_START_FAILED';
        reject(error);
      });
    });
  }

  async function waitForSession() {
    const deadline = Date.now() + config.discordSessionTimeout;
    let consecutiveSamples = 0;
    while (Date.now() < deadline) {
      if (await hasEstablishedSession()) {
        consecutiveSamples += 1;
        if (consecutiveSamples >= 2) {
          logger.info('Discord network session established through VPN');
          return true;
        }
      } else {
        consecutiveSamples = 0;
      }
      await delay(1000);
    }
    const error = new Error('O Discord não estabeleceu uma sessão de rede dentro do tempo limite.');
    error.code = 'DISCORD_SESSION_TIMEOUT';
    throw error;
  }

  return {
    channel,
    installRoot,
    updateExecutable,
    getProcessIds,
    isRunning,
    hasEstablishedSession,
    stop,
    start,
    waitForSession
  };
}

module.exports = { createWindowsDiscord, CHANNELS, PROCESS_QUERY, SESSION_QUERY, CLOSE_QUERY };
