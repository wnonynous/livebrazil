'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'standalone', 'LiveBrazil.ps1'), 'utf8');
const buildSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-portable.js'), 'utf8');
const launchSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'launch-portable.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const iconPath = path.join(__dirname, '..', 'standalone', 'assets', '6dae0b010e42f9fa0a59cb489c97ff32.png');

test('standalone contém somente o perfil VPN fixo solicitado', () => {
  assert.match(source, /\$VpnName = 'LiveBrazil'/);
  assert.doesNotMatch(source, /VPN Japão/);
  assert.match(source, /\$VpnServer = 'public-vpn-109\.opengw\.net'/);
  assert.match(source, /\$VpnPsk = 'vpn'/);
  assert.match(source, /-TunnelType L2tp/);
  assert.match(source, /-AuthenticationMethod MSChapv2/);
  assert.match(source, /-AllUserConnection/);
});

test('standalone confirma VPN, sessão Discord e restauração', () => {
  assert.match(source, /Wait-VpnState -Connected \$true/);
  assert.match(source, /Wait-VpnDefaultRoute/);
  assert.match(source, /Wait-DiscordSession/);
  assert.match(source, /Get-NetTCPConnection -State Established/);
  assert.match(source, /-StartedAfter \$launchAt/);
  assert.match(source, /Disconnect-ManagedVpn/);
  assert.match(source, /Rota Brasil restaurada após a falha/);
});

test('standalone encerra a instalação do Discord mesmo quando o caminho está oculto', () => {
  assert.match(source, /Get-CimInstance Win32_Process/);
  assert.match(source, /'Discord\.exe', 'DiscordSystemHelper\.exe'/);
  assert.match(source, /\$knownNames -contains \$_\.Name/);
  assert.match(source, /ExecutablePath\.StartsWith\(\$rootPrefix/);
  assert.match(source, /Stop-Process -Id \$item\.ProcessId -Force -ErrorAction SilentlyContinue/);
  assert.doesNotMatch(source, /taskkill\.exe/);
  assert.match(source, /Discord encerrado por completo/);
});

test('standalone reinicia o Discord pelo shell normal do usuário', () => {
  assert.match(source, /New-Object -ComObject Shell\.Application/);
  assert.match(source, /ShellExecute\(\$DiscordUpdate, '--processStart Discord\.exe'/);
  assert.match(source, /FinalReleaseComObject\(\$shell\)/);
  assert.doesNotMatch(source, /Start-Process -FilePath \$DiscordUpdate/);
});

test('standalone exige rota VPN e uma sessão nova visível do Discord', () => {
  assert.match(source, /Get-NetIPInterface -InterfaceAlias \$VpnName/);
  assert.match(source, /Find-NetRoute -RemoteIPAddress '1\.1\.1\.1'/);
  assert.match(source, /\$vpnIsSelected/);
  assert.match(source, /0\.0\.0\.0\/0/);
  assert.match(source, /128\.0\.0\.0\/1/);
  assert.match(source, /CreationDate -ge \$StartedAfter/);
  assert.match(source, /\$hasWindow -and \$established\.Count -gt 0/);
  assert.match(source, /\$samples -ge 3/);
});

test('standalone não registra credenciais no status', () => {
  const statusCalls = [...source.matchAll(/Write-Status\s+([^\r\n]+)/g)].map((match) => match[1]).join('\n');
  assert.doesNotMatch(statusCalls, /VpnPassword|VpnPsk|VpnUser/);
});

test('standalone abre splash sem moldura e inicia automaticamente', () => {
  assert.match(source, /WindowStyle="None"/);
  assert.match(source, /AllowsTransparency="True"/);
  assert.match(source, /ShowInTaskbar="False"/);
  assert.match(source, /Add_ContentRendered\(\{ \$launchTimer\.Start\(\) \}\)/);
  assert.match(source, /\$state\.Child = Start-Process powershell\.exe -Verb RunAs/);
  assert.match(source, /\$window\.Close\(\)/);
  assert.doesNotMatch(source, /Preparar VPN e iniciar Discord/);
});

test('standalone incorpora o ícone e força UTF-8 com BOM no pacote', () => {
  assert.equal(fs.existsSync(iconPath), true);
  assert.match(source, /Name="AppIcon"/);
  assert.match(source, /6dae0b010e42f9fa0a59cb489c97ff32\.png/);
  assert.match(buildSource, /`\\uFEFF\$\{source\}`/);
  assert.match(buildSource, /FILE1=.*iconName/);
});

test('npm run launch usa o mesmo fluxo standalone do executável', () => {
  assert.equal(packageJson.scripts.launch, 'node scripts/launch-portable.js');
  assert.equal(packageJson.scripts['launch:node'], 'node src/launcher.js');
  assert.match(launchSource, /spawnSync\('powershell\.exe'/);
  assert.match(launchSource, /`\\uFEFF\$\{source\}`/);
  assert.match(launchSource, /fs\.copyFileSync\(iconFile/);
  assert.match(launchSource, /-File', stagedScript/);
});
