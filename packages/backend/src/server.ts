/**
 * Fastify server bootstrap. Registers CORS, HTTP rate limiting (the WS routes
 * are exempt — long-lived sockets must not be throttled per message), the
 * WebSocket plugin, and the HTTP + WS routes. API keys live only here on the
 * server; the browser never receives them.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { registerHttpRoutes } from './routes/http.js';
import { registerWsRoutes } from './routes/ws.js';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
          : undefined,
    },
  });

  await app.register(cors, { origin: env.CORS_ORIGINS });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    // WebSocket upgrade requests should not be rate limited.
    allowList: (req) => req.url.startsWith('/ws/'),
  });

  await app.register(websocket, {
    options: { maxPayload: 1_048_576 }, // 1 MB — generous for 100ms PCM chunks
  });

  await app.register(async (instance) => {
    registerWsRoutes(instance);
  });
  registerHttpRoutes(app);

  return app;
}

async function main(): Promise<void> {
  const app = await buildServer();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info(
      { port: env.PORT, host: env.HOST, env: env.NODE_ENV },
      'AI Interpreter Workbench backend listening',
    );
  } catch (err) {
    logger.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

// Only auto-start when run directly (not when imported by tests).
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain || process.env.START_SERVER === 'true') {
  void main();
}
