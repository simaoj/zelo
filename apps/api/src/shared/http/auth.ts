import './cookies.js';
import type { FastifyInstance } from 'fastify';
import type { Actor } from '../application/ports.js';
import { UnauthenticatedError } from '../domain/errors.js';
import { SESSION_COOKIE } from './cookies.js';

export interface SessionResolver {
  /** Returns the actor for a raw session token, or null if invalid/expired/revoked. */
  resolve(rawToken: string): Promise<Actor | null>;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route does not require an authenticated session. */
    public?: boolean;
    /**
     * Route authenticates machine clients itself with `Authorization: Bearer <integration token>`
     * (e.g. POST /imports/health). The session cookie is ignored (no `request.actor` from it) and
     * CSRF is not required, since no ambient browser credential is used.
     */
    integrationAuth?: boolean;
  }
}

/**
 * Resolves `request.actor` from the session cookie on every request of the scope.
 * Routes are authenticated by default; `config: { public: true }` opts out.
 */
export function registerAuth(app: FastifyInstance, resolver: SessionResolver): void {
  app.addHook('preHandler', async (request) => {
    if (request.routeOptions.config.integrationAuth) return; // route-level bearer auth
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) {
      const actor = await resolver.resolve(raw);
      if (actor) request.actor = actor;
    }
    if (!request.actor && !request.routeOptions.config.public) throw new UnauthenticatedError();
  });
}

/** Returns the authenticated actor or throws 401. */
export function requireActor(request: { actor?: Actor }): Actor {
  if (!request.actor) throw new UnauthenticatedError();
  return request.actor;
}
