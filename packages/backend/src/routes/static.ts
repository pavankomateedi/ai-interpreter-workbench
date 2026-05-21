/**
 * Serves the built frontend in production so a single service hosts the SPA, the
 * REST API, and the WebSocket endpoints on one origin — no CORS, and WebSockets
 * are same-origin. In development this is a no-op (Vite serves the SPA and
 * proxies /api and /ws to the backend), so it only activates when a built
 * frontend is present.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export async function registerStaticFrontend(app: FastifyInstance): Promise<boolean> {
  const here = dirname(fileURLToPath(import.meta.url));
  // From the bundled server (packages/backend/dist/server.js) the frontend build
  // sits at packages/frontend/dist; override with FRONTEND_DIST if relocated.
  const dist = process.env.FRONTEND_DIST ?? resolve(here, '../../frontend/dist');
  if (!existsSync(resolve(dist, 'index.html'))) return false;

  await app.register(fastifyStatic, { root: dist, wildcard: false });

  // SPA fallback: any unmatched GET that is not an API or WS route returns the
  // app shell so client-side rendering can take over.
  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? '';
    if (request.method !== 'GET' || url.startsWith('/api') || url.startsWith('/ws')) {
      void reply.code(404).send({ error: 'not found' });
      return;
    }
    void reply.type('text/html').sendFile('index.html');
  });

  return true;
}
