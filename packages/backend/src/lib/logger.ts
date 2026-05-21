/**
 * Structured logger (pino). In development it pretty-prints; in production it
 * emits newline-delimited JSON suitable for log aggregation. Child loggers are
 * created per session so every log line carries the sessionId and mode.
 */

import { pino } from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
      : undefined,
  base: undefined, // omit pid/hostname noise
});

export type Logger = typeof logger;
