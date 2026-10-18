import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { API_PREFIX } from '@zelo/contracts';
import { registerAuth } from '../shared/http/auth.js';
import { registerCsrf } from '../shared/http/csrf.js';
import { registerErrorHandling } from '../shared/http/errors.js';
import type { Container } from './container.js';

/** Never log credentials, tokens, cookies or request bodies (which may carry health data). */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'token',
  '*.token',
  'body',
  '*.body',
];

export function loggerOptions(level: string): FastifyServerOptions['logger'] {
  if (level === 'silent') return false;
  return {
    level,
    redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      // only method + path (no query string: reset tokens or cursors never reach the logs)
      req: (req: { method: string; url: string; id: string }) => ({ method: req.method, path: req.url.split('?')[0], id: req.id }),
    },
  };
}

const CORRELATION_RE = /^[A-Za-z0-9._-]{8,64}$/;

export async function buildApp(container: Container): Promise<FastifyInstance> {
  const { config } = container;
  const app = Fastify({
    logger: loggerOptions(config.logLevel),
    trustProxy: true,
    bodyLimit: 512 * 1024,
    genReqId: (req) => {
      const h = req.headers['x-correlation-id'];
      return typeof h === 'string' && CORRELATION_RE.test(h) ? h : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('correlationId', '');
  app.addHook('onRequest', async (request, reply) => {
    request.correlationId = String(request.id);
    reply.header('x-correlation-id', request.correlationId);
  });
  registerErrorHandling(app);

  await app.register(cookie);
  if (config.corsOrigins.length) {
    await app.register(cors, {
      origin: config.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['content-type', 'x-csrf-token', 'x-device-id', 'x-correlation-id'],
      exposedHeaders: ['x-correlation-id'],
    });
  }
  if (config.rateLimit.enabled) {
    await app.register(rateLimit, {
      global: true,
      keyGenerator: (request) => `${request.method === 'GET' ? 'read' : 'write'}:${request.ip}`,
      max: (request) => (request.method === 'GET' ? config.rateLimit.globalMax : config.rateLimit.writeMax),
      timeWindow: '1 minute',
      errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, code: 'RATE_LIMITED', message: `Rate limit exceeded, retry in ${ctx.after}` }),
    });
  }

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Zelo API',
        version: '1.0.0',
        description:
          'API do Zelo. Sessão por cookie HttpOnly `zelo_session`; mutações exigem o header `x-csrf-token` igual ao cookie `zelo_csrf` (GET /auth/csrf). ' +
          'Mutações carregam `operationId` (idempotência) e edições/exclusões `expectedVersion` (409 VERSION_CONFLICT com `current`). ' +
          'Erros seguem ApiError {code, message, fieldErrors?, correlationId, current?}.',
      },
      servers: [{ url: '/' }],
      components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'zelo_session' } } },
      security: [{ session: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: `${API_PREFIX}/docs` });

  await app.register(
    async (api) => {
      registerCsrf(api, { secure: config.cookieSecure });
      registerAuth(api, container.sessionResolver);

      api.withTypeProvider<ZodTypeProvider>().get(
        '/health',
        { config: { public: true }, schema: { tags: ['health'], summary: 'Liveness + MongoDB ping', response: { 200: z.object({ status: z.literal('ok'), mongo: z.enum(['up', 'down']) }), 503: z.object({ status: z.literal('ok'), mongo: z.enum(['up', 'down']) }) } } },
        async (_request, reply) => {
          let mongo: 'up' | 'down' = 'up';
          try {
            await container.db.command({ ping: 1 });
          } catch {
            mongo = 'down';
          }
          reply.header('cache-control', 'no-store');
          return reply.status(mongo === 'down' ? 503 : 200).send({ status: 'ok' as const, mongo });
        },
      );
      api.get('/openapi.json', { config: { public: true }, schema: { hide: true } }, async () => app.swagger());

      for (const m of container.modules) {
        if (m.httpRoutes) await api.register(m.httpRoutes);
      }
    },
    { prefix: API_PREFIX },
  );

  return app;
}
