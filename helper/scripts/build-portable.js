'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(projectRoot, 'standalone');
const sourceFile = path.join(sourceDir, 'LiveBrazil.ps1');
const iconName = '6dae0b010e42f9fa0a59cb489c97ff32.png';
const iconFile = path.join(sourceDir, 'assets', iconName);
const stageDir = path.join(projectRoot, '.build', 'portable');
const distDir = path.join(projectRoot, 'dist');
const outputFile = path.join(distDir, 'LiveBrazil.exe');
const sedFile = path.join(distDir, 'LiveBrazil.sed');

function escapeSed(value) {
  return String(value).replace(/%/g, '%%');
}

function build() {
  if (process.platform !== 'win32') throw new Error('O executável portátil deve ser construído no Windows.');
  if (!fs.existsSync(sourceFile)) throw new Error('O script do LiveBrazil não foi encontrado.');
  if (!fs.existsSync(iconFile)) throw new Error('O ícone do LiveBrazil não foi encontrado.');
  fs.mkdirSync(distDir, { recursive: true });
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  const source = fs.readFileSync(sourceFile, 'utf8').replace(/^\uFEFF/, '');
  fs.writeFileSync(path.join(stageDir, 'LiveBrazil.ps1'), `\uFEFF${source}`, 'utf8');
  fs.copyFileSync(iconFile, path.join(stageDir, iconName));
  if (fs.existsSync(outputFile)) fs.rmSync(outputFile, { force: true });
  const sed = `[Version]\r\n` +
    `Class=IEXPRESS\r\nSEDVersion=3\r\n[Options]\r\n` +
    `PackagePurpose=InstallApp\r\nShowInstallProgramWindow=0\r\nHideExtractAnimation=1\r\n` +
    `UseLongFileName=1\r\nInsideCompressed=0\r\nCAB_FixedSize=0\r\nCAB_ResvCodeSigning=0\r\n` +
    `RebootMode=N\r\nInstallPrompt=\r\nDisplayLicense=\r\nFinishMessage=\r\n` +
    `TargetName=${escapeSed(outputFile)}\r\n` +
    `FriendlyName=LiveBrazil\r\n` +
    `AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File LiveBrazil.ps1\r\n` +
    `PostInstallCmd=<None>\r\nAdminQuietInstCmd=\r\nUserQuietInstCmd=\r\nSourceFiles=SourceFiles\r\n` +
    `[Strings]\r\nFILE0="LiveBrazil.ps1"\r\nFILE1="${iconName}"\r\n` +
    `[SourceFiles]\r\nSourceFiles0=${escapeSed(stageDir)}\\\r\n` +
    `[SourceFiles0]\r\n%FILE0%=\r\n%FILE1%=\r\n`;
  fs.writeFileSync(sedFile, sed, 'utf8');
  execFileSync(path.join(process.env.SystemRoot, 'System32', 'iexpress.exe'), ['/N', '/Q', sedFile], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: 'inherit'
  });
  if (!fs.existsSync(outputFile)) throw new Error('O IExpress não gerou o executável esperado.');
  fs.rmSync(sedFile, { force: true });
  fs.rmSync(stageDir, { recursive: true, force: true });
  console.log(`Executável criado: ${outputFile}`);
}

try { build(); } catch (error) { console.error(error); process.exitCode = 1; }

module.exports = { build };
