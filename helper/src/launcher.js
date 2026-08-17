'use strict';

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createVpnManager } = require('./vpn/manager');
const { createWindowsDiscord } = require('./discord/windowsDiscord');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLauncher({ config, logger, manager, discord, wait = delay, report = console.log }) {
  logger.info('LiveBrazil launcher started');
  report('LiveBrazil Launcher 1.0.0');
  report(`Discord: ${config.discordChannel}`);
  report(`VPN: ${config.vpnConnectionName}`);
  report('Rota: Brasil');

  const discordWasRunning = await discord.isRunning();
  let discordStarted = false;
  if (discordWasRunning) {
    report('Encerrando a sessão atual do Discord...');
    await discord.stop();
  }

  let vpnConnected = false;
  try {
    report('Conectando a rota temporária da VPN...');
    const vpn = await manager.connect();
    if (!vpn.success || !vpn.connected) {
      const error = new Error(vpn.message || 'A VPN configurada não foi conectada.');
      error.code = vpn.error || 'VPN_CONNECTION_FAILED';
      throw error;
    }
    vpnConnected = true;
    report('VPN conectada. Iniciando o Discord...');
    await discord.start();
    discordStarted = true;
    report('Aguardando a sessão de rede do Discord...');
    await discord.waitForSession();
    if (config.sessionStabilizationDelay > 0) {
      report(`Estabilizando a sessão por ${config.sessionStabilizationDelay}ms...`);
      await wait(config.sessionStabilizationDelay);
    }
    report('Sessão do Discord estabelecida. Restaurando a rota Brasil...');
    await manager.disconnect();
    vpnConnected = false;
    logger.info('Brazil route restored after Discord session startup');
    report('Rota: Brasil');
    report('Discord pronto.');
    return { success: true, route: 'brazil', discordSession: 'established' };
  } catch (error) {
    logger.error(`${error.code || 'LAUNCH_FAILED'}: ${error.message}`);
    if (vpnConnected) {
      try {
        report('A inicialização falhou. Restaurando a rota Brasil...');
        await manager.disconnect();
        logger.info('Brazil route restored after launcher failure');
      } catch (cleanupError) {
        logger.error(`${cleanupError.code || 'VPN_CLEANUP_FAILED'}: ${cleanupError.message}`);
      }
    }
    if (discordWasRunning && !discordStarted) {
      try {
        report('Reabrindo o Discord pela rota Brasil...');
        await discord.start();
        logger.info('Discord reopened after launcher failure');
      } catch (restartError) {
        logger.error(`${restartError.code || 'DISCORD_RECOVERY_FAILED'}: ${restartError.message}`);
      }
    }
    throw error;
  }
}

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.root, config.debug);
  const manager = createVpnManager(config, logger);
  const discord = createWindowsDiscord(config, logger);
  try {
    await runLauncher({ config, logger, manager, discord });
  } catch (error) {
    console.error(`Falha no LiveBrazil: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { runLauncher, main };
