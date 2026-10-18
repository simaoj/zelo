import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import type { ActivitySnapshotReader, HealthSnapshotReader, HydrationSnapshotReader, ProfileReader } from '../../shared/application/cross-module-ports.js';
import type { OccurrenceQuery } from '../routine/index.js';
import { GetDailyDashboard } from './application/use-cases/get-daily-dashboard.js';
import { dashboardRoutes } from './adapters/in/http/dashboard-routes.js';

export function createDashboardModule(
  deps: CoreDeps & {
    profileReader: ProfileReader;
    snapshotReader: HealthSnapshotReader;
    occurrenceQuery: OccurrenceQuery;
    hydrationSnapshot: HydrationSnapshotReader;
    activitySnapshot: ActivitySnapshotReader;
  },
): ModuleDefinition {
  const getDailyDashboard = new GetDailyDashboard({
    profiles: deps.profileReader,
    snapshots: deps.snapshotReader,
    occurrences: deps.occurrenceQuery,
    hydration: deps.hydrationSnapshot,
    activity: deps.activitySnapshot,
    clock: deps.clock,
  });
  return { name: 'dashboard', httpRoutes: dashboardRoutes({ getDailyDashboard }) };
}
