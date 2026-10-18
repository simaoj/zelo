import './cookies.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CSRF_COOKIE, CSRF_HEADER, type CookieSettings } from './cookies.js';
import { HttpError } from './errors.js';
import './auth.js'; // FastifyContextConfig augmentation (integrationAuth)

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function equal(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Double-submit CSRF protection: every non-GET request must carry header `x-csrf-token`
 * equal to the readable cookie `zelo_csrf`. GET /auth/csrf issues (or returns) the token.
 * Must be registered inside the /api/v1 scope.
 */
export function registerCsrf(app: FastifyInstance, settings: CookieSettings): void {
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    // bearer-token integration routes never read the session cookie → CSRF does not apply
    if (request.routeOptions.config?.integrationAuth) return;
    const cookie = request.cookies[CSRF_COOKIE];
    const header = request.headers[CSRF_HEADER];
    if (!cookie || typeof header !== 'string' || !equal(cookie, header)) {
      throw new HttpError('CSRF_FAILED', 'Não foi possível validar a requisição. Recarregue a página e tente novamente.');
    }
  });

  app.get(
    '/auth/csrf',
    {
      config: { public: true },
      schema: {
        tags: ['auth'],
        summary: 'Issue the CSRF double-submit token (cookie zelo_csrf + body)',
        response: { 200: z.object({ csrfToken: z.string() }) },
      },
    },
    async (request, reply) => {
      let token = request.cookies[CSRF_COOKIE];
      if (!token || token.length < 32) {
        token = randomBytes(32).toString('base64url');
        reply.setCookie(CSRF_COOKIE, token, {
          path: '/',
          httpOnly: false,
          sameSite: 'lax',
          secure: settings.secure,
          maxAge: 60 * 60 * 24 * 30,
        });
      }
      reply.header('cache-control', 'no-store');
      return { csrfToken: token };
    },
  );
}
