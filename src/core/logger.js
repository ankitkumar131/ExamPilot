// Winston logger with graceful fallback to console when deps are missing
// (e.g. running smoke tests before `npm install`).
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./config');

function consoleShim(service) {
  const p = (lvl, msg, meta) => {
    const extra = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const fn = lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log;
    fn(`[${service}] ${msg}${extra}`);
  };
  return {
    debug: (m, x) => p('debug', m, x),
    info: (m, x) => p('info', m, x),
    warn: (m, x) => p('warn', m, x),
    error: (m, x) => p('error', m, x),
    logPerformance: (label, start, meta) =>
      p('info', `${label} in ${Date.now() - start}ms`, meta),
  };
}

let winston = null;
let DailyRotateFile = null;
try {
  winston = require('winston');
  DailyRotateFile = require('winston-daily-rotate-file');
} catch (_) { /* deps not installed yet */ }

const cache = new Map();

function createServiceLogger(service) {
  if (cache.has(service)) return cache.get(service);
  let logger;
  if (!winston) {
    logger = consoleShim(service);
  } else {
    try {
      const logDir = path.join(getDataDir(), 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      const fmt = winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf((info) => {
          const meta = { ...info };
          delete meta.level; delete meta.message; delete meta.timestamp; delete meta.service;
          const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${info.timestamp} [${info.level.toUpperCase()}] [${service}] ${info.message}${extra}`;
        })
      );
      const base = winston.createLogger({
        level: process.env.EXAMPILOT_LOG_LEVEL || 'info',
        format: fmt,
        transports: [
          new winston.transports.Console({ format: fmt }),
          new DailyRotateFile({
            filename: path.join(logDir, 'exampilot-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxFiles: '7d',
            maxSize: '10m',
          }),
        ],
      });
      logger = {
        debug: (m, x) => base.debug(m, x || {}),
        info: (m, x) => base.info(m, x || {}),
        warn: (m, x) => base.warn(m, x || {}),
        error: (m, x) => base.error(m, x || {}),
        logPerformance: (label, start, meta) =>
          base.info(`${label} in ${Date.now() - start}ms`, meta || {}),
      };
    } catch (_) {
      logger = consoleShim(service);
    }
  }
  cache.set(service, logger);
  return logger;
}

module.exports = { createServiceLogger };
