'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'standalone', 'LiveBrazil.ps1'), 'utf8');

test('standalone contém somente o perfil VPN fixo solicitado', () => {
  assert.match(source, /\$VpnName = 'VPN Japão'/);
  assert.match(source, /\$VpnServer = 'public-vpn-109\.opengw\.net'/);
  assert.match(source, /\$VpnPsk = 'vpn'/);
  assert.match(source, /-TunnelType L2tp/);
  assert.match(source, /-AuthenticationMethod MSChapv2/);
  assert.match(source, /-AllUserConnection/);
});

test('standalone confirma VPN, sessão Discord e restauração', () => {
  assert.match(source, /Wait-VpnState -Connected \$true/);
  assert.match(source, /Wait-DiscordSession/);
  assert.match(source, /Get-NetTCPConnection -State Established/);
  assert.match(source, /Disconnect-ManagedVpn/);
  assert.match(source, /Rota Brasil restaurada após a falha/);
});

test('standalone não registra credenciais no status', () => {
  const statusCalls = [...source.matchAll(/Write-Status\s+([^\r\n]+)/g)].map((match) => match[1]).join('\n');
  assert.doesNotMatch(statusCalls, /VpnPassword|VpnPsk|VpnUser/);
});
