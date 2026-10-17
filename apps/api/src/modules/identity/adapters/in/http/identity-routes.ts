import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PasswordResetConfirm, PasswordResetRequest, SessionResponse, SignInRequest, SignUpRequest } from '@zelo/contracts';
import { DEVICE_HEADER, SESSION_COOKIE, errorResponses } from '../../../../../shared/http/index.js';
import type { IdentityService, IssuedSession } from '../../../application/use-cases/auth-use-cases.js';

export interface IdentityHttpOptions {
  cookieSecure: boolean;
  /** per-route limit for auth endpoints (requests/minute/IP); undefined = no per-route limit */
  authRateLimit?: number;
}

export function identityRoutes(service: IdentityService, opts: IdentityHttpOptions): FastifyPluginAsync {
  const rateLimit = opts.authRateLimit ? { rateLimit: { max: opts.authRateLimit, timeWindow: '1 minute' } } : {};
  const setSessionCookie = (reply: FastifyReply, issued: IssuedSession) =>
    reply.setCookie(SESSION_COOKIE, issued.rawToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.cookieSecure,
      expires: new Date(issued.response.expiresAt),
    });

  return async (root) => {
    const app = root.withTypeProvider<ZodTypeProvider>();
    const tags = ['auth'];

    app.post(
      '/auth/sign-up',
      { config: { public: true, ...rateLimit }, schema: { tags, summary: 'Create account (+ profile) and start a session', body: SignUpRequest, response: { 201: SessionResponse, ...errorResponses } } },
      async (request, reply) => {
        const issued = await service.signUp(request.body);
        setSessionCookie(reply, issued);
        return reply.status(201).send(issued.response);
      },
    );

    app.post(
      '/auth/sign-in',
      { config: { public: true, ...rateLimit }, schema: { tags, summary: 'Sign in (sets HttpOnly cookie zelo_session)', body: SignInRequest, response: { 200: SessionResponse, ...errorResponses } } },
      async (request, reply) => {
        const issued = await service.signIn(request.body);
        setSessionCookie(reply, issued);
        return issued.response;
      },
    );

    app.post(
      '/auth/sign-out',
      {
        config: { public: true },
        schema: {
          tags,
          summary: 'Revoke the session; with header x-device-id also revokes that device push subscriptions',
          headers: z.object({ [DEVICE_HEADER]: z.uuid().optional() }).loose(),
          response: { 204: z.null(), ...errorResponses },
        },
      },
      async (request, reply) => {
        const deviceId = request.headers[DEVICE_HEADER];
        await service.signOut(request.cookies[SESSION_COOKIE], typeof deviceId === 'string' ? deviceId : undefined);
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return reply.status(204).send(null);
      },
    );

    app.get(
      '/auth/session',
      { config: { public: true }, schema: { tags, summary: 'Current session (401 if none)', response: { 200: SessionResponse, ...errorResponses } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return service.getSession(request.cookies[SESSION_COOKIE]);
      },
    );

    app.post(
      '/auth/password-reset/request',
      { config: { public: true, ...rateLimit }, schema: { tags, summary: 'Request a password reset e-mail (always 202)', body: PasswordResetRequest, response: { 202: z.null(), ...errorResponses } } },
      async (request, reply) => {
        await service.requestPasswordReset(request.body.email);
        return reply.status(202).send(null);
      },
    );

    app.post(
      '/auth/password-reset/confirm',
      { config: { public: true, ...rateLimit }, schema: { tags, summary: 'Set a new password with a single-use reset token', body: PasswordResetConfirm, response: { 204: z.null(), ...errorResponses } } },
      async (request, reply) => {
        await service.confirmPasswordReset(request.body);
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return reply.status(204).send(null);
      },
    );
  };
}
