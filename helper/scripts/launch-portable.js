'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(projectRoot, 'standalone');
const sourceFile = path.join(sourceDir, 'LiveBrazil.ps1');
const iconName = '6dae0b010e42f9fa0a59cb489c97ff32.png';
const iconFile = path.join(sourceDir, 'assets', iconName);
const stageDir = path.join(projectRoot, '.build', `launch-${process.pid}`);

function launch() {
  if (process.platform !== 'win32') {
    throw new Error('O LiveBrazil portátil deve ser executado no Windows.');
  }
  if (!fs.existsSync(sourceFile)) throw new Error('O script standalone não foi encontrado.');
  if (!fs.existsSync(iconFile)) throw new Error('O avatar do LiveBrazil não foi encontrado.');

  fs.mkdirSync(stageDir, { recursive: true });
  const source = fs.readFileSync(sourceFile, 'utf8').replace(/^\uFEFF/, '');
  const stagedScript = path.join(stageDir, 'LiveBrazil.ps1');
  fs.writeFileSync(stagedScript, `\uFEFF${source}`, 'utf8');
  fs.copyFileSync(iconFile, path.join(stageDir, iconName));

  try {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-STA',
      '-File', stagedScript
    ], {
      cwd: stageDir,
      stdio: 'inherit',
      windowsHide: false
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

try {
  launch();
} catch (error) {
  console.error(`[LiveBrazil] ${error.message}`);
  process.exitCode = 1;
}

module.exports = { launch };
