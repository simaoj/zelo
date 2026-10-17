import type { IntakeRecord as IntakeDto, Occurrence as OccurrenceDto } from '@zelo/contracts';
import type { TxContext } from '../../../../shared/application/ports.js';
import { ValidationError } from '../../../../shared/domain/errors.js';
import type { Occurrence } from '../../domain/entities/occurrence.js';
import { addDays, localDateOf, localDayRange, startOfLocalDay } from '../../domain/value-objects/local-time.js';
import { BOOTSTRAP_FUTURE_DAYS, BOOTSTRAP_PAST_DAYS, type RoutineAppDeps } from '../deps.js';
import { toIntakeDto, toOccurrenceDto } from '../presenters.js';
import { GenerateOccurrences } from './generate-occurrences.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertLocalDate(date: string, field = 'date'): void {
  const ok = DATE_RE.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!ok) throw new ValidationError('Data inválida', { [field]: ['Use o formato AAAA-MM-DD'] });
}

/**
 * Occurrence listing. `date` is interpreted in the PROFILE timezone ("Hoje" uses the profile tz,
 * spec §6): the result contains every occurrence whose instant falls inside that profile-local day,
 * even if the occurrence's own localDate (SCHEDULE tz) differs. Generation is lazy for that range.
 */
export class ListOccurrences {
  private readonly generator: GenerateOccurrences;
  constructor(private readonly d: RoutineAppDeps) {
    this.generator = new GenerateOccurrences(d);
  }

  async today(userId: string): Promise<string> {
    const tz = await this.d.profiles.getTimezone(userId);
    return localDateOf(this.d.clock.now(), tz);
  }

  async forDate(userId: string, date: string | undefined): Promise<{ date: string; items: OccurrenceDto[] }> {
    const tz = await this.d.profiles.getTimezone(userId);
    const day = date ?? localDateOf(this.d.clock.now(), tz);
    assertLocalDate(day);
    const { from, to } = localDayRange(day, tz);
    return { date: day, items: await this.forRange(userId, from, to) };
  }

  /** Bootstrap window: today−7 … today+7 in the profile tz. Generation is committed in its own tx. */
  async forBootstrap(userId: string, tx?: TxContext): Promise<OccurrenceDto[]> {
    const tz = await this.d.profiles.getTimezone(userId);
    const today = localDateOf(this.d.clock.now(), tz);
    const from = startOfLocalDay(addDays(today, -BOOTSTRAP_PAST_DAYS), tz);
    const to = startOfLocalDay(addDays(today, BOOTSTRAP_FUTURE_DAYS + 1), tz);
    // Generated in a separate committed transaction: rows created here are also in the change log,
    // so a bootstrap snapshot that misses them still receives them through /sync/changes.
    await this.d.uow.run((gtx) => this.generator.forRange(userId, from, to, gtx));
    return this.read(userId, from, to, tx);
  }

  async forRange(userId: string, from: Date, to: Date): Promise<OccurrenceDto[]> {
    await this.d.uow.run((tx) => this.generator.forRange(userId, from, to, tx));
    return this.read(userId, from, to);
  }

  async byId(userId: string, id: string, tx?: TxContext): Promise<OccurrenceDto | null> {
    const occ = await this.d.occurrences.getById(userId, id, tx);
    if (!occ || occ.cancelledAt) return null;
    const live = await this.d.intakes.getLiveByOccurrence(userId, id, tx);
    return toOccurrenceDto(occ, live, this.d.clock.now());
  }

  private async read(userId: string, from: Date, to: Date, tx?: TxContext): Promise<OccurrenceDto[]> {
    const occs: Occurrence[] = await this.d.occurrences.listLiveInRange(userId, from, to, tx);
    const intakes = await this.d.intakes.listLiveByOccurrenceIds(userId, occs.map((o) => o.id), tx);
    const byOcc = new Map(intakes.map((i) => [i.occurrenceId!, i]));
    const now = this.d.clock.now();
    return occs.map((o) => toOccurrenceDto(o, byOcc.get(o.id) ?? null, now));
  }
}

export interface IntakeListQuery {
  itemId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

/** GET /intakes — history ordered by sortAt desc, id desc; opaque cursor (base64url JSON). */
export class ListIntakes {
  constructor(private readonly d: RoutineAppDeps) {}

  async execute(userId: string, q: IntakeListQuery): Promise<{ items: IntakeDto[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    let cursor: { sortAt: Date; id: string } | undefined;
    if (q.cursor) {
      try {
        const raw = JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8')) as { t: string; id: string };
        cursor = { sortAt: new Date(raw.t), id: String(raw.id) };
        if (Number.isNaN(cursor.sortAt.getTime())) throw new Error('bad');
      } catch {
        throw new ValidationError('Cursor inválido', { cursor: ['Cursor inválido'] });
      }
    }
    const rows = await this.d.intakes.page(userId, {
      itemId: q.itemId,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      cursor,
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ t: last.sortAt.toISOString(), id: last.id }), 'utf8').toString('base64url')
        : null;
    return { items: page.map(toIntakeDto), nextCursor };
  }

  async byId(userId: string, id: string, tx?: TxContext): Promise<IntakeDto | null> {
    const r = await this.d.intakes.getById(userId, id, tx);
    return r && !r.deletedAt ? toIntakeDto(r) : null;
  }

  async allLive(userId: string, tx?: TxContext): Promise<IntakeDto[]> {
    return (await this.d.intakes.listLive(userId, tx)).map(toIntakeDto);
  }
}
