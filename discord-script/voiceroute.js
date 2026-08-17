(() => {
  'use strict';

  const previousInstance = window.LiveBrazil || window.VoiceRoute;
  if (previousInstance?.destroy) previousInstance.destroy();

  const VERSION = '1.0.0';
  const config = {
    api: 'http://127.0.0.1:28471',
    auto: false,
    disconnectDelay: 0,
    requestTimeout: 15000,
    debug: true
  };

  // Todos os contratos mutáveis do DOM ficam aqui. Valide-os após atualizações do Discord.
  const DiscordSelectors = {
    channelItem: '[data-list-item-id^="channels___"][role="treeitem"], [data-list-item-id^="channels___"]',
    voiceIcon: 'svg[data-icon="volume-high"], svg[data-icon="headphones"], [aria-label*="Voice Channel" i], [aria-label*="Canal de voz" i]',
    voiceCallButton: [
      'button[aria-label*="Start Voice Call" i]',
      '[role="button"][aria-label*="Join Call" i]',
      'button[aria-label*="Iniciar chamada de voz" i]',
      '[role="button"][aria-label*="Entrar na chamada" i]'
    ].join(', '),
    disconnectButton: [
      'button[aria-label*="Disconnect" i]',
      '[role="button"][aria-label*="Disconnect" i]',
      'button[aria-label*="Desconectar" i]',
      '[role="button"][aria-label*="Desconectar" i]'
    ].join(', '),
    connectingIndicator: [
      '[role="status"][aria-label*="Connecting" i]',
      '[aria-live="polite"][aria-label*="Connecting" i]',
      '[role="status"][aria-label*="Conectando" i]',
      '[aria-live="polite"][aria-label*="Conectando" i]'
    ].join(', '),
    userSettingsButton: [
      'button[aria-label*="User Settings" i]',
      '[role="button"][aria-label*="User Settings" i]',
      'button[aria-label*="Configurações de usuário" i]',
      '[role="button"][aria-label*="Configurações de usuário" i]',
      'button[aria-label*="Configurações do usuário" i]',
      '[role="button"][aria-label*="Configurações do usuário" i]'
    ].join(', '),
    appRoot: '#app-mount, [data-reactroot], body'
  };

  const state = {
    auto: false,
    helperOnline: false,
    vpnConnected: false,
    voiceState: 'idle',
    processingJoin: false,
    internalBypass: false,
    originalAction: null,
    lastError: null
  };

  let authToken = '';
  let observer = null;
  let fallbackTimer = null;
  let toastTimer = null;
  let postDisconnectResult = null;
  let panelUpdateTimer = 0;
  let destroyed = false;
  let authRequestPromise = null;
  let cancelAuthRequest = null;

  const log = (...args) => config.debug && console.log('[LiveBrazil]', ...args);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setVoiceState(next) {
    if (state.voiceState === next) return;
    state.voiceState = next;
    log(`Voice state: ${next}`);
    updatePanel();
  }

  function ensureStyles() {
    if (document.getElementById('voiceroute-style')) return;
    const style = document.createElement('style');
    style.id = 'voiceroute-style';
    style.textContent = `
      #voiceroute-toast{position:fixed;top:24px;left:50%;transform:translate(-50%,-14px);opacity:0;pointer-events:none;z-index:2147483647;width:min(390px,calc(100vw - 32px));box-sizing:border-box;padding:16px 18px;background:#1e1f22;color:#f2f3f5;border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 14px 38px rgba(0,0,0,.45);font:14px/1.4 Whitney,"gg sans",Arial,sans-serif;transition:opacity .2s ease,transform .2s ease}
      #voiceroute-toast.vr-show{opacity:1;transform:translate(-50%,0);pointer-events:auto}
      #voiceroute-toast .vr-title{font-weight:700;font-size:15px;margin-bottom:8px}.vr-body{white-space:pre-line;color:#dbdee1}.vr-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.vr-actions button{border:0;border-radius:5px;padding:8px 12px;color:white;background:#5865f2;font-weight:600;cursor:pointer}.vr-actions button.vr-secondary{background:#4e5058}.vr-actions button:hover{filter:brightness(1.1)}
      #voiceroute-panel{display:block;box-sizing:border-box;width:calc(100% - 16px);margin:0 8px 7px;border:1px solid rgba(255,255,255,.06);border-radius:8px;background:#232428;color:#f2f3f5;box-shadow:0 2px 10px rgba(0,0,0,.22);font:12px/1.25 Whitney,"gg sans",Arial,sans-serif;overflow:hidden;text-align:left}
      .vrp-head{display:flex;align-items:center;gap:9px;padding:10px 10px 8px}.vrp-titlebox{min-width:0;flex:1}.vrp-brand{display:block;font-weight:800;font-size:14px;letter-spacing:.1px;color:#f2f3f5}.vrp-subtitle{display:block;margin-top:2px;color:#949ba4;font-size:10px;text-transform:uppercase;letter-spacing:.45px}.vrp-state{max-width:94px;padding:3px 7px;border-radius:999px;background:#35373c;color:#b5bac1;font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .vrp-route{display:flex;align-items:center;justify-content:space-between;margin:0 10px 8px;padding:7px 8px;border-radius:5px;background:#1e1f22;color:#dbdee1}.vrp-route strong{font-size:11px}.vrp-route span{color:#949ba4;font-size:10px}.vrp-status{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:0 10px 8px}.vrp-item{display:flex;align-items:center;justify-content:center;gap:5px;padding:5px 3px;border-radius:4px;background:#2b2d31;color:#949ba4;font-size:10px}.vrp-dot{width:6px;height:6px;border-radius:50%;background:#80848e}.vrp-item[data-on="true"]{color:#dbdee1}.vrp-item[data-on="true"] .vrp-dot{background:#23a55a;box-shadow:0 0 7px rgba(35,165,90,.6)}.vrp-item[data-kind="vpn"][data-on="true"] .vrp-dot{background:#5865f2;box-shadow:0 0 7px rgba(88,101,242,.7)}
      .vrp-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 10px;background:#2b2d31}.vrp-actions button{min-height:30px;border:0;border-radius:4px;padding:6px 8px;color:#f2f3f5;background:#4e5058;font:600 11px/1 Whitney,"gg sans",Arial,sans-serif;cursor:pointer;transition:background .15s ease}.vrp-actions button:hover{background:#5d6069}.vrp-actions button[data-primary="true"]{background:#5865f2}.vrp-actions button[data-primary="true"]:hover{background:#4752c4}.vrp-actions button[data-danger="true"]{background:#da373c}.vrp-actions button:disabled{opacity:.55;cursor:wait}
      #voiceroute-auth{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.68);font:14px/1.4 Whitney,"gg sans",Arial,sans-serif}#voiceroute-auth .vra-dialog{box-sizing:border-box;width:min(440px,100%);padding:22px;border-radius:12px;background:#313338;color:#f2f3f5;box-shadow:0 18px 55px rgba(0,0,0,.55)}#voiceroute-auth .vra-head{margin-bottom:8px;font-size:18px;font-weight:800}#voiceroute-auth .vra-help{margin:0 0 16px;color:#b5bac1;font-size:13px}#voiceroute-auth label{display:block;margin-bottom:6px;color:#b5bac1;font-size:11px;font-weight:800;text-transform:uppercase}#voiceroute-auth input{box-sizing:border-box;width:100%;height:42px;padding:9px 11px;border:1px solid transparent;border-radius:4px;outline:0;background:#1e1f22;color:#f2f3f5;font:13px Consolas,monospace}#voiceroute-auth input:focus{border-color:#00a8fc}#voiceroute-auth .vra-error{min-height:18px;margin-top:6px;color:#fa777c;font-size:12px}#voiceroute-auth .vra-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:12px}#voiceroute-auth button{min-height:36px;padding:8px 14px;border:0;border-radius:4px;color:#fff;background:#4e5058;font-weight:700;cursor:pointer}#voiceroute-auth button[type="submit"]{background:#5865f2}#voiceroute-auth button:hover{filter:brightness(1.1)}
    `;
    document.documentElement.appendChild(style);
  }

  function getToast() {
    ensureStyles();
    let element = document.getElementById('voiceroute-toast');
    if (!element) {
      element = document.createElement('section');
      element.id = 'voiceroute-toast';
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      element.innerHTML = '<div class="vr-title"></div><div class="vr-body"></div><div class="vr-actions"></div>';
      document.documentElement.appendChild(element);
    }
    return element;
  }

  function findUserPanel() {
    const settings = document.querySelector(DiscordSelectors.userSettingsButton);
    if (!settings) return null;
    let candidate = settings.parentElement;
    for (let depth = 0; candidate && depth < 7; depth += 1, candidate = candidate.parentElement) {
      const rect = candidate.getBoundingClientRect();
      const controls = candidate.querySelectorAll('button, [role="button"]').length;
      if (controls >= 2 && rect.width >= 180 && rect.height >= 40 && rect.height <= 100) return candidate;
    }
    return null;
  }

  function createPanel() {
    ensureStyles();
    const panel = document.createElement('section');
    panel.id = 'voiceroute-panel';
    panel.setAttribute('aria-label', 'Painel do LiveBrazil');
    panel.innerHTML = `
      <div class="vrp-head">
        <span class="vrp-titlebox"><span class="vrp-brand">LiveBrazil</span><span class="vrp-subtitle">Roteamento de voz</span></span>
        <span class="vrp-state" data-key="state">Aguardando</span>
      </div>
      <div class="vrp-route"><strong data-key="route-country">Brasil</strong><span data-key="route-description">Rota normal</span></div>
      <div class="vrp-status">
        <span class="vrp-item" data-key="helper"><i class="vrp-dot"></i><span>Helper</span></span>
        <span class="vrp-item" data-key="vpn" data-kind="vpn"><i class="vrp-dot"></i><span>VPN</span></span>
        <span class="vrp-item" data-key="voice"><i class="vrp-dot"></i><span>Voz</span></span>
      </div>
      <div class="vrp-actions">
        <button type="button" data-action="auto" data-primary="false">Auto: desligado</button>
        <button type="button" data-action="vpn">Conectar VPN</button>
      </div>`;
    panel.querySelector('[data-action="auto"]').addEventListener('click', () => auto(!state.auto));
    panel.querySelector('[data-action="vpn"]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        if (state.vpnConnected) await disconnect();
        else await connect();
        toast(state.vpnConnected ? 'VPN conectada.' : 'VPN desconectada.');
      } catch (error) {
        toast(`Erro: ${error.message}`, { duration: 0 });
      } finally {
        button.disabled = false;
        updatePanel();
      }
    });
    return panel;
  }

  function updatePanel() {
    const panel = document.getElementById('voiceroute-panel');
    if (!panel) return;
    const values = {
      helper: state.helperOnline,
      vpn: state.vpnConnected,
      voice: domVoiceConnected()
    };
    for (const [key, enabled] of Object.entries(values)) {
      const item = panel.querySelector(`[data-key="${key}"]`);
      if (item && item.dataset.on !== String(enabled)) item.dataset.on = String(enabled);
    }
    const labels = {
      idle: 'Aguardando', preparing: 'Preparando', vpn_connecting: 'Conectando VPN',
      joining: 'Entrando', voice_connecting: 'Reconectando', connected: 'Em call',
      vpn_disconnecting: 'Restaurando rota', complete: 'Concluído', error: 'Erro'
    };
    const stateLabel = panel.querySelector('[data-key="state"]');
    const nextStateLabel = state.processingJoin
      ? (labels[state.voiceState] || state.voiceState)
      : (domVoiceConnected() ? 'Em call' : (labels[state.voiceState] || 'Aguardando'));
    if (stateLabel && stateLabel.textContent !== nextStateLabel) stateLabel.textContent = nextStateLabel;
    const autoButton = panel.querySelector('[data-action="auto"]');
    if (autoButton) {
      const autoLabel = `Auto: ${state.auto ? 'ligado' : 'desligado'}`;
      if (autoButton.textContent !== autoLabel) autoButton.textContent = autoLabel;
      if (autoButton.dataset.primary !== String(state.auto)) autoButton.dataset.primary = String(state.auto);
    }
    const vpnButton = panel.querySelector('[data-action="vpn"]');
    if (vpnButton && !vpnButton.disabled) {
      const vpnLabel = state.vpnConnected ? 'Desligar VPN' : 'Conectar VPN';
      if (vpnButton.textContent !== vpnLabel) vpnButton.textContent = vpnLabel;
      if (vpnButton.dataset.danger !== String(state.vpnConnected)) {
        vpnButton.dataset.danger = String(state.vpnConnected);
      }
    }
    const routeCountry = panel.querySelector('[data-key="route-country"]');
    const routeDescription = panel.querySelector('[data-key="route-description"]');
    const countryLabel = state.vpnConnected ? 'Canadá' : 'Brasil';
    const routeLabel = state.vpnConnected ? 'Rota temporária da VPN' : 'Rota normal restaurada';
    if (routeCountry && routeCountry.textContent !== countryLabel) routeCountry.textContent = countryLabel;
    if (routeDescription && routeDescription.textContent !== routeLabel) {
      routeDescription.textContent = routeLabel;
    }
  }

  function mountPanel() {
    const existing = document.getElementById('voiceroute-panel');
    if (existing?.isConnected) {
      updatePanel();
      return true;
    }
    const userPanel = findUserPanel();
    if (!userPanel?.parentElement) return false;
    const panel = existing || createPanel();
    userPanel.parentElement.insertBefore(panel, userPanel);
    updatePanel();
    log('LiveBrazil indicator mounted');
    return true;
  }

  function schedulePanelMount() {
    if (destroyed || panelUpdateTimer) return;
    panelUpdateTimer = setTimeout(() => {
      panelUpdateTimer = 0;
      if (destroyed) return;
      inspectVoiceDom();
      if (!document.getElementById('voiceroute-panel')?.isConnected) mountPanel();
    }, 120);
  }

  function toast(message, options = {}) {
    const element = getToast();
    element.querySelector('.vr-title').textContent = options.title || 'LiveBrazil';
    element.querySelector('.vr-body').textContent = String(message);
    const actions = element.querySelector('.vr-actions');
    actions.replaceChildren();
    for (const action of options.actions || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      if (action.secondary) button.className = 'vr-secondary';
      button.addEventListener('click', action.onClick, { once: true });
      actions.appendChild(button);
    }
    element.classList.add('vr-show');
    clearTimeout(toastTimer);
    if (options.duration !== 0) {
      toastTimer = setTimeout(() => element.classList.remove('vr-show'), options.duration || 4200);
    }
    return element;
  }

  function requireToken() {
    if (authToken) return Promise.resolve(authToken);
    if (authRequestPromise) return authRequestPromise;
    ensureStyles();
    authRequestPromise = new Promise((resolve, reject) => {
      const overlay = document.createElement('div');
      overlay.id = 'voiceroute-auth';
      overlay.innerHTML = `
        <form class="vra-dialog" role="dialog" aria-modal="true" aria-labelledby="vra-title">
          <div class="vra-head" id="vra-title">Conectar ao LiveBrazil</div>
          <p class="vra-help">Cole o conteúdo de <b>helper/data/auth-token.txt</b>. O token ficará somente na memória desta página.</p>
          <label for="vra-token">Token local</label>
          <input id="vra-token" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="Cole o token aqui">
          <div class="vra-error" aria-live="polite"></div>
          <div class="vra-actions"><button type="button" data-cancel>Cancelar</button><button type="submit">Continuar</button></div>
        </form>`;
      const form = overlay.querySelector('form');
      const input = overlay.querySelector('input');
      const errorBox = overlay.querySelector('.vra-error');
      const finish = (error, token = '') => {
        overlay.remove();
        authRequestPromise = null;
        cancelAuthRequest = null;
        if (error) reject(error);
        else resolve(token);
      };
      const cancel = () => {
        const error = new Error('Token de autenticação não informado.');
        error.code = 'AUTH_TOKEN_REQUIRED';
        finish(error);
      };
      cancelAuthRequest = cancel;
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (value.length < 32) {
          errorBox.textContent = 'O token parece incompleto.';
          input.focus();
          return;
        }
        authToken = value;
        finish(null, authToken);
      });
      overlay.querySelector('[data-cancel]').addEventListener('click', cancel);
      overlay.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') cancel();
      });
      document.documentElement.appendChild(overlay);
      setTimeout(() => input.focus(), 0);
    });
    return authRequestPromise;
  }

  async function request(path, { method = 'GET', authenticated = true } = {}) {
    const token = authenticated ? await requireToken() : '';
    const controller = new AbortController();
    // Pequena margem para o helper devolver seu próprio erro detalhado antes
    // de o transporte HTTP ser abortado pelo cliente.
    const timer = setTimeout(() => controller.abort(), config.requestTimeout + 2500);
    try {
      const response = await fetch(`${config.api}${path}`, {
        method,
        mode: 'cors',
        cache: 'no-store',
        headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.message || data.error || `HTTP ${response.status}`);
        error.code = data.error || `HTTP_${response.status}`;
        error.status = response.status;
        error.data = data;
        if (response.status === 401) authToken = '';
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeout = new Error('A VPN demorou demais para responder.');
        timeout.code = 'VPN_CONNECTION_TIMEOUT';
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function domVoiceConnected() {
    return Boolean(document.querySelector(DiscordSelectors.disconnectButton));
  }

  function domVoiceConnecting() {
    return Boolean(document.querySelector(DiscordSelectors.connectingIndicator));
  }

  function inspectVoiceDom() {
    if (domVoiceConnected()) {
      if (['joining', 'voice_connecting', 'vpn_connecting', 'preparing'].includes(state.voiceState)) {
        setVoiceState('connected');
      }
      return 'connected';
    }
    if (domVoiceConnecting()) {
      if (['joining', 'connected', 'complete'].includes(state.voiceState)) setVoiceState('voice_connecting');
      return 'voice_connecting';
    }
    return 'idle';
  }

  const detector = {
    start() {
      if (observer) return true;
      const root = document.querySelector(DiscordSelectors.appRoot) || document.body;
      if (!root) return false;
      observer = new MutationObserver(schedulePanelMount);
      observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'aria-live'] });
      inspectVoiceDom();
      mountPanel();
      return true;
    },
    stop() {
      observer?.disconnect();
      observer = null;
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    },
    getState: () => state.voiceState,
    isConnected: domVoiceConnected,
    isConnecting: domVoiceConnecting
  };

  function startTemporaryFallback() {
    clearInterval(fallbackTimer);
    fallbackTimer = setInterval(inspectVoiceDom, 750);
  }

  function stopTemporaryFallback() {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }

  async function waitForVoiceConnected() {
    log('Waiting for voice state');
    const deadline = Date.now() + Math.max(config.requestTimeout * 2, 30000);
    while (Date.now() < deadline) {
      if (domVoiceConnected()) return true;
      if (domVoiceConnecting() && state.voiceState !== 'voice_connecting') setVoiceState('voice_connecting');
      await sleep(750);
    }
    const error = new Error('O Discord não confirmou a conexão de voz a tempo.');
    error.code = 'VOICE_CONNECTION_TIMEOUT';
    throw error;
  }

  function findProtectedTarget(event) {
    const path = event.composedPath?.() || [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(DiscordSelectors.voiceCallButton)) return { target: node, kind: 'voice_join' };
      const channel = node.matches?.(DiscordSelectors.channelItem) ? node : node.closest?.(DiscordSelectors.channelItem);
      if (channel && channel.querySelector(DiscordSelectors.voiceIcon)) return { target: channel, kind: 'voice_join' };
    }
    return null;
  }

  function captureAction(event, candidate) {
    return {
      target: candidate.target,
      kind: candidate.kind,
      clientX: event.clientX,
      clientY: event.clientY,
      button: event.button,
      capturedAt: Date.now()
    };
  }

  function replayOriginalAction(action) {
    if (!action?.target?.isConnected) {
      const error = new Error('O elemento da call não existe mais no DOM. Clique novamente.');
      error.code = 'DISCORD_TARGET_GONE';
      throw error;
    }
    log('Replaying Discord action');
    state.internalBypass = true;
    try {
      action.target.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: action.button || 0,
        clientX: action.clientX,
        clientY: action.clientY
      }));
    } finally {
      queueMicrotask(() => { state.internalBypass = false; });
    }
  }

  async function connect() {
    log('Requesting VPN connection');
    const result = await request('/vpn/on', { method: 'POST' });
    state.helperOnline = true;
    state.vpnConnected = Boolean(result.connected);
    updatePanel();
    if (!result.connected) {
      const error = new Error(result.message || 'Não foi possível conectar VPN.');
      error.code = result.error || 'VPN_CONNECTION_FAILED';
      throw error;
    }
    log('VPN connected');
    return result;
  }

  async function disconnect() {
    log('Disconnecting VPN');
    const result = await request('/vpn/off', { method: 'POST' });
    state.helperOnline = true;
    state.vpnConnected = Boolean(result.connected);
    updatePanel();
    if (result.connected) {
      const error = new Error('O Windows ainda informa que a VPN está conectada.');
      error.code = 'VPN_DISCONNECTION_FAILED';
      throw error;
    }
    log('VPN disconnected');
    return result;
  }

  async function checkAfterDisconnect() {
    log('Checking voice connection');
    const deadline = Date.now() + 5000;
    let renegotiated = false;
    let disconnected = false;
    while (Date.now() < deadline) {
      if (domVoiceConnecting()) renegotiated = true;
      if (!domVoiceConnected() && !domVoiceConnecting()) disconnected = true;
      await sleep(750);
    }
    if (renegotiated || disconnected) {
      postDisconnectResult = 'renegotiated';
      console.warn('[LiveBrazil] WARNING: Discord voice connection renegotiated after VPN disconnect');
      setVoiceState('voice_connecting');
      toast('VPN desligada.\nAguardando a voz voltar pela rota normal...', { title: 'LiveBrazil', duration: 0 });
      const reconnectDeadline = Date.now() + 15000;
      while (Date.now() < reconnectDeadline) {
        if (domVoiceConnected()) {
          postDisconnectResult = 'renegotiated-reconnected';
          log('Discord voice reconnected on the normal route');
          return 'reconnected';
        }
        await sleep(750);
      }
      const error = new Error('O Discord não reconectou à voz depois de desligar a VPN.');
      error.code = 'VOICE_RECONNECT_TIMEOUT';
      throw error;
    }
    postDisconnectResult = 'remained-active';
    log('Voice connection remained active');
    return 'remained-active';
  }

  async function runJoinFlow(action) {
    if (state.processingJoin) return;
    state.processingJoin = true;
    state.originalAction = action;
    state.lastError = null;
    startTemporaryFallback();
    try {
      setVoiceState('preparing');
      toast('Preparando rota Canadá...', { duration: 0 });
      setVoiceState('vpn_connecting');
      await connect();
      toast('VPN conectada\nEntrando na call...', { duration: 0 });
      setVoiceState('joining');
      replayOriginalAction(action);

      setVoiceState('voice_connecting');
      await waitForVoiceConnected();
      setVoiceState('connected');
      log('Voice connected');
      toast('Call conectada\nRestaurando rota Brasil...', { duration: 0 });
      if (config.disconnectDelay > 0) {
        log(`Waiting ${config.disconnectDelay}ms`);
        await sleep(config.disconnectDelay);
      }
      if (!domVoiceConnected()) {
        const error = new Error('A call foi encerrada antes da desconexão da VPN.');
        error.code = 'VOICE_LEFT_EARLY';
        throw error;
      }
      setVoiceState('vpn_disconnecting');
      await disconnect();
      const routeResult = await checkAfterDisconnect();
      setVoiceState('complete');
      toast(routeResult === 'reconnected'
        ? 'Rota Brasil restaurada.\nVoz reconectada.'
        : 'Rota Brasil restaurada sem queda.', { title: 'LiveBrazil' });
    } catch (error) {
      state.lastError = { code: error.code || 'UNKNOWN_ERROR', message: error.message };
      setVoiceState('error');
      const timeoutMessage = error.code === 'VPN_CONNECTION_TIMEOUT'
        ? 'A VPN demorou demais para conectar.'
        : error.message || 'Não foi possível conectar VPN.';
      toast(`Erro: ${timeoutMessage}`, {
        duration: 0,
        actions: [
          { label: 'Tentar novamente', onClick: () => retryJoin() },
          {
            label: 'Entrar sem VPN',
            secondary: true,
            onClick: () => enterWithoutVpn()
          }
        ]
      });
    } finally {
      state.processingJoin = false;
      stopTemporaryFallback();
      updatePanel();
    }
  }

  function retryJoin() {
    if (!state.originalAction || state.processingJoin) return;
    runJoinFlow(state.originalAction);
  }

  function enterWithoutVpn() {
    if (!state.originalAction || state.processingJoin) return;
    try {
      replayOriginalAction(state.originalAction);
      setVoiceState('joining');
      toast('Entrando sem VPN...');
    } catch (error) {
      toast(`Erro: ${error.message}`, { duration: 0 });
    }
  }

  function clickInterceptor(event) {
    if (!state.auto || state.internalBypass || event.button !== 0) return;
    const candidate = findProtectedTarget(event);
    if (!candidate) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    log('Voice channel interaction detected');
    log('Blocking original action');
    if (state.processingJoin) {
      toast('Uma entrada em call já está sendo processada.');
      return;
    }
    runJoinFlow(captureAction(event, candidate));
  }

  async function status() {
    let helper = 'offline';
    let vpn = state.vpnConnected ? 'connected' : 'disconnected';
    try {
      await request('/health', { authenticated: false });
      state.helperOnline = true;
      helper = 'online';
    } catch (error) {
      state.helperOnline = false;
      state.lastError = { code: error.code || 'HELPER_OFFLINE', message: error.message };
    }
    if (helper === 'online') {
      try {
        const vpnStatus = await request('/vpn/status');
        state.vpnConnected = Boolean(vpnStatus.connected);
        vpn = vpnStatus.connected ? 'connected' : 'disconnected';
        log(`VPN status: ${vpn}`);
      } catch (error) {
        vpn = error.code === 'VPN_NOT_FOUND' ? 'not_found' : 'unknown';
        state.lastError = { code: error.code || 'VPN_STATUS_FAILED', message: error.message };
      }
    }
    const connected = domVoiceConnected();
    const result = { auto: state.auto, helper, vpn, voice: connected ? 'connected' : state.voiceState, processing: state.processingJoin };
    updatePanel();
    console.log(`LiveBrazil\n─────────────────\nHelper    ${helper === 'online' ? '● Online' : '○ Offline'}\nVPN       ${vpn === 'connected' ? '● Online' : '○ Offline'}\nDiscord   ${connected ? '● Em call' : '○ Fora da call'}\nAuto      ${state.auto ? '● Ativado' : '○ Desativado'}`);
    return result;
  }

  async function test() {
    const checks = [];
    let ready = true;
    try {
      await request('/health', { authenticated: false });
      checks.push('✓ Helper online');
    } catch {
      checks.push('✗ Helper offline');
      ready = false;
    }
    if (ready) {
      try {
        const vpn = await request('/vpn/status');
        checks.push('✓ Authentication OK');
        checks.push(`✓ VPN found: ${vpn.connection}`);
        checks.push('✓ VPN status readable');
      } catch (error) {
        if (error.code === 'UNAUTHORIZED') {
          checks.push('✗ Authentication failed');
        } else {
          checks.push('✓ Authentication OK');
          checks.push(error.code === 'VPN_NOT_FOUND' ? `✗ ${error.message}` : `✗ VPN: ${error.message}`);
        }
        ready = false;
      }
    }
    const domAvailable = Boolean(document.querySelector(DiscordSelectors.appRoot));
    checks.push(`${domAvailable ? '✓' : '✗'} Discord DOM available`);
    const detectorStarted = detector.start();
    checks.push(`${detectorStarted ? '✓' : '✗'} Voice detector started`);
    ready = ready && domAvailable && detectorStarted;
    const report = `LiveBrazil Diagnostic\n\n${checks.join('\n')}\n\n${ready ? 'Ready.' : 'Not ready.'}`;
    console.log(report);
    toast(report, { duration: 7000 });
    return { ready, checks, voice: detector.getState(), selectors: DiscordSelectors };
  }

  function auto(enabled) {
    state.auto = Boolean(enabled);
    config.auto = state.auto;
    updatePanel();
    log(`Auto mode ${state.auto ? 'enabled' : 'disabled'}`);
    return state.auto;
  }

  function debug(enabled) {
    config.debug = Boolean(enabled);
    return config.debug;
  }

  function setToken(token) {
    authToken = String(token || '').trim();
    return Boolean(authToken);
  }

  function destroy() {
    destroyed = true;
    cancelAuthRequest?.();
    document.getElementById('voiceroute-auth')?.remove();
    if (panelUpdateTimer) clearTimeout(panelUpdateTimer);
    panelUpdateTimer = 0;
    document.removeEventListener('click', clickInterceptor, true);
    detector.stop();
    document.getElementById('voiceroute-toast')?.remove();
    document.getElementById('voiceroute-panel')?.remove();
    document.getElementById('voiceroute-style')?.remove();
    delete window.VoiceRoute;
    delete window.LiveBrazil;
  }

  document.addEventListener('click', clickInterceptor, true);
  detector.start();

  const publicApi = Object.freeze({
    version: VERSION,
    config,
    state,
    DiscordSelectors,
    detector,
    status,
    connect,
    disconnect,
    auto,
    test,
    toast,
    debug,
    setToken,
    auth: requireToken,
    retry: retryJoin,
    enterWithoutVpn,
    panel: Object.freeze({ mount: mountPanel, refresh: updatePanel }),
    get postDisconnectResult() { return postDisconnectResult; },
    destroy
  });
  window.LiveBrazil = publicApi;
  window.VoiceRoute = publicApi;

  console.log('LiveBrazil loaded');
  request('/health', { authenticated: false })
    .then(() => { state.helperOnline = true; updatePanel(); log('Helper online'); console.log('Helper connected'); })
    .catch(() => { state.helperOnline = false; updatePanel(); console.warn('[LiveBrazil] Helper offline'); });
  console.log('Auto mode disabled — use the LiveBrazil launcher');
})();
