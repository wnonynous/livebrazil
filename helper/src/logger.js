'use strict';

const fs = require('node:fs');
const path = require('node:path');

function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function createLogger(root, debugEnabled) {
  const logDir = path.join(root, 'logs');
  const logFile = path.join(logDir, 'voiceroute.log');
  fs.mkdirSync(logDir, { recursive: true });

  function write(level, message) {
    const safeMessage = String(message).replace(/[\r\n]+/g, ' ').slice(0, 1000);
    const line = `${timestamp()}${level === 'INFO' ? '' : ` ${level}`} ${safeMessage}`;
    fs.appendFileSync(logFile, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
    if (level !== 'DEBUG' || debugEnabled) console.log(line);
  }

  return {
    info: (message) => write('INFO', message),
    warn: (message) => write('WARN', message),
    error: (message) => write('ERROR', message),
    debug: (message) => write('DEBUG', message),
    logFile
  };
}

module.exports = { createLogger, timestamp };
