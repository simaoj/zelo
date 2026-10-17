import { z } from 'zod';

/** UUID string used for every domain id. */
export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** ISO-8601 instant in UTC, e.g. 2026-10-17T10:30:00.000Z */
export const Instant = z.iso.datetime({ offset: true });
export type Instant = z.infer<typeof Instant>;

/** Local calendar date, YYYY-MM-DD */
export const LocalDate = z.iso.date();
export type LocalDate = z.infer<typeof LocalDate>;

/** Local wall-clock time, HH:mm (24h) */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (HH:mm)');
export type LocalTime = z.infer<typeof LocalTime>;

/** IANA timezone, e.g. America/Sao_Paulo */
export const TimeZone = z.string().min(1).max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Fuso horário inválido');
export type TimeZone = z.infer<typeof TimeZone>;

/**
 * Canonical decimal string ("82.35"). The UI accepts comma ("82,35") and must
 * normalize before sending. No leading "+", no exponent, no trailing zeros required.
 */
export const decimalString = (maxScale: number) =>
  z
    .string()
    .regex(new RegExp(`^\\d{1,6}(\\.\\d{1,${maxScale}})?$`), `Use até ${maxScale} casas decimais`)
    .refine((v) => Number(v) > 0, 'O valor deve ser positivo');

export const WeightKg = decimalString(2);
export const LengthCm = decimalString(2);
export const DoseAmount = decimalString(3);

export const Notes = z.string().max(1000).nullable();
export const Name = z.string().trim().min(1, 'Nome obrigatório').max(120);

/** Client-generated UUID that makes a mutation idempotent. */
export const OperationId = z.uuid();

/** Every mutation body carries an operationId. */
export const MutationMeta = z.object({ operationId: OperationId });

/** Edit/delete additionally carries the version the client last saw. */
export const VersionedMutationMeta = MutationMeta.extend({ expectedVersion: z.number().int().nonnegative() });

/** Delete body. */
export const DeleteRequest = VersionedMutationMeta;
export type DeleteRequest = z.infer<typeof DeleteRequest>;

/** Common fields on editable resources returned by the API. */
export const ResourceMeta = z.object({
  id: Id,
  version: z.number().int().nonnegative(),
  createdAt: Instant,
  updatedAt: Instant,
});

/** Cursor pagination for history lists (ordered by measuredAt desc, id desc). */
export const HistoryQuery = z.object({
  /** inclusive lower bound (instant) */
  from: Instant.optional(),
  /** exclusive upper bound (instant) */
  to: Instant.optional(),
  cursor: z.string().optional(),
  /** default 50, max 200 */
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type HistoryQuery = z.infer<typeof HistoryQuery>;

export const page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/** Error body for every non-2xx response. */
export const ApiError = z.object({
  code: z.enum([
    'VALIDATION_ERROR',
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'NOT_FOUND',
    'VERSION_CONFLICT',
    'IDEMPOTENCY_CONFLICT',
    'CONFIRMATION_REQUIRED',
    'RATE_LIMITED',
    'CSRF_FAILED',
    'INTERNAL_ERROR',
  ]),
  message: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  correlationId: z.string(),
  /** On VERSION_CONFLICT, the current server representation (for conflict resolution UI). */
  current: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiError>;
export type ApiErrorCode = ApiError['code'];

export const PERIODS = ['7d', '30d', '90d', 'all'] as const;
export const Period = z.enum(PERIODS);
export type Period = z.infer<typeof Period>;
