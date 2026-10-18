import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/zelo?replicaSet=rs0&directConnection=true'),
  MONGODB_DB: z.string().optional(),
  PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
  CORS_ALLOWED_ORIGINS: z.string().optional().default(''),
  COOKIE_SECURE: bool,
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('Zelo <nao-responda@zelo.local>'),
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  VAPID_SUBJECT: z.string().optional().default('mailto:admin@zelo.local'),
  LOG_LEVEL: z.string().default('info'),
  RATE_LIMIT_DISABLED: bool,
  /** auth requests (sign-in/up/reset) per IP per minute */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

export interface AppConfig {
  env: string;
  port: number;
  host: string;
  mongoUri: string;
  mongoDb: string | undefined;
  publicAppUrl: string;
  corsOrigins: string[];
  cookieSecure: boolean;
  smtpUrl: string;
  mailFrom: string;
  vapid: { publicKey: string; privateKey: string; subject: string };
  logLevel: string;
  rateLimit: { enabled: boolean; authMax: number; writeMax: number; globalMax: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = EnvSchema.parse(env);
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    mongoUri: e.MONGODB_URI,
    mongoDb: e.MONGODB_DB,
    publicAppUrl: e.PUBLIC_APP_URL.replace(/\/$/, ''),
    corsOrigins: e.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    cookieSecure: e.COOKIE_SECURE,
    smtpUrl: e.SMTP_URL,
    mailFrom: e.MAIL_FROM,
    vapid: { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT },
    logLevel: e.LOG_LEVEL,
    rateLimit: { enabled: !e.RATE_LIMIT_DISABLED, authMax: e.AUTH_RATE_LIMIT_MAX, writeMax: 120, globalMax: 600 },
  };
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_DISABLED: 'true' }),
    ...overrides,
  };
}
