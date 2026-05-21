/**
 * REST routes: health, client configuration, session-log export, and the admin
 * circuit-breaker controls from the incident playbook (ADR-007). The `/api/config`
 * endpoint is what the frontend reads on load to populate the language selector,
 * decide whether Realtime mode is available (needs an OpenAI key), and learn the
 * latency thresholds used for dashboard colour coding.
 */

import type { FastifyInstance } from 'fastify';
import { LANGUAGE_PAIRS, AUDIO_SAMPLE_RATE, AUDIO_CHUNK_MS } from '@workbench/types';
import { env, latencyThresholds } from '../config/env.js';
import { breakerRegistry, breakerSnapshot, providerAvailability } from '../config/providers.js';
import { activeSessionCount, getSessionLog } from '../runtime/sessionStore.js';

export function registerHttpRoutes(app: FastifyInstance): void {
  app.get('/api/health', () => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    activeSessions: activeSessionCount(),
    providerAvailability,
    breakers: breakerSnapshot(),
  }));

  app.get('/api/config', () => ({
    modes: ['realtime', 'cascade'],
    realtimeAvailable: providerAvailability.openai,
    defaultLanguagePair: 'en-es',
    languagePairs: Object.values(LANGUAGE_PAIRS),
    providerAvailability,
    latencyThresholds,
    audio: { sampleRate: AUDIO_SAMPLE_RATE, chunkMs: AUDIO_CHUNK_MS },
    models: {
      realtime: env.OPENAI_REALTIME_MODEL,
      transcribe: env.OPENAI_TRANSCRIBE_MODEL,
      tts: env.OPENAI_TTS_MODEL,
      translation: env.CLAUDE_MODEL,
    },
  }));

  app.get<{ Params: { id: string } }>('/api/sessions/:id', (request, reply) => {
    const log = getSessionLog(request.params.id);
    if (!log) {
      void reply.code(404);
      return { error: 'session not found' };
    }
    return log;
  });

  app.post<{ Params: { provider: string; action: string } }>(
    '/api/admin/circuit-breaker/:provider/:action',
    (request, reply) => {
      if (!env.ADMIN_ENDPOINTS_ENABLED) {
        void reply.code(403);
        return { error: 'admin endpoints disabled' };
      }
      const { provider, action } = request.params;
      if (action === 'open') {
        breakerRegistry.forceOpen(provider);
        return { provider, state: 'open' };
      }
      if (action === 'close') {
        const closed = breakerRegistry.forceClose(provider);
        if (!closed) {
          void reply.code(404);
          return { error: `no breaker for ${provider}` };
        }
        return { provider, state: 'closed' };
      }
      void reply.code(400);
      return { error: 'action must be open or close' };
    },
  );
}
