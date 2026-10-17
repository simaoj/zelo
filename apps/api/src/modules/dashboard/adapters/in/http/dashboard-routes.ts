import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DashboardResponse, LocalDate } from '@zelo/contracts';
import { errorResponses, requireActor } from '../../../../../shared/http/index.js';
import type { GetDailyDashboard } from '../../../application/use-cases/get-daily-dashboard.js';

export function dashboardRoutes(deps: { getDailyDashboard: GetDailyDashboard }): FastifyPluginAsync {
  return async (root) => {
    const app = root.withTypeProvider<ZodTypeProvider>();
    app.get(
      '/dashboard',
      {
        schema: {
          tags: ['dashboard'],
          summary: 'Daily summary ("Hoje")',
          description: '`date` is a local date in the profile timezone (default: today there).',
          querystring: z.object({ date: LocalDate.optional() }),
          response: { 200: DashboardResponse, ...errorResponses },
        },
      },
      async (request) => deps.getDailyDashboard.execute(requireActor(request).userId, request.query.date),
    );
  };
}
