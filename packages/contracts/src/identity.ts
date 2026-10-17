import { z } from 'zod';
import { Id, Instant, TimeZone } from './common.js';

/**
 * Auth endpoints live under /api/v1/auth. Session is an HttpOnly cookie
 * (`zelo_session`). Mutating requests must send header `x-csrf-token`
 * equal to the readable cookie `zelo_csrf` (double-submit).
 */
export const SignUpRequest = z.object({
  email: z.email().max(254),
  password: z.string().min(8, 'Mínimo de 8 caracteres').max(128),
  displayName: z.string().trim().min(1).max(80),
  timezone: TimeZone,
});
export type SignUpRequest = z.infer<typeof SignUpRequest>;

export const SignInRequest = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});
export type SignInRequest = z.infer<typeof SignInRequest>;

export const PasswordResetRequest = z.object({ email: z.email() });
export const PasswordResetConfirm = z.object({
  token: z.string().min(16),
  password: z.string().min(8).max(128),
});

export const SessionUser = z.object({ userId: Id, email: z.email() });
export type SessionUser = z.infer<typeof SessionUser>;

export const SessionResponse = z.object({ user: SessionUser, expiresAt: Instant });
export type SessionResponse = z.infer<typeof SessionResponse>;

export const MODULES = ['body', 'bloodPressure', 'routine'] as const;
export const Module = z.enum(MODULES);
export type Module = z.infer<typeof Module>;

export const Profile = z.object({
  userId: Id,
  displayName: z.string(),
  timezone: TimeZone,
  visibleModules: z.array(Module),
  remindersEnabled: z.boolean(),
  version: z.number().int(),
  updatedAt: Instant,
});
export type Profile = z.infer<typeof Profile>;

export const UpdateProfileRequest = z.object({
  operationId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  displayName: z.string().trim().min(1).max(80).optional(),
  timezone: TimeZone.optional(),
  visibleModules: z.array(Module).optional(),
  remindersEnabled: z.boolean().optional(),
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;
