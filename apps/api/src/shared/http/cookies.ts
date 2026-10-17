import '@fastify/cookie'; // type augmentation (request.cookies / reply.setCookie)
export const SESSION_COOKIE = 'zelo_session';
export const CSRF_COOKIE = 'zelo_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const DEVICE_HEADER = 'x-device-id';

export interface CookieSettings {
  secure: boolean;
}
