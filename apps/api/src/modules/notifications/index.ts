import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import type { ProfileReader, PushSubscriptionRevoker } from '../../shared/application/cross-module-ports.js';
import type { NotificationGateway } from './application/ports/out/index.js';
import { DeletePushSubscription, RegisterPushSubscription, RevokeDeviceSubscriptions } from './application/use-cases/push-subscriptions.js';
import { DispatchDueReminders, PlanReminders } from './application/use-cases/reminders.js';
import { MongoNotificationJobRepository } from './adapters/out/mongodb/mongo-notification-job-repository.js';
import { MongoPushSubscriptionRepository } from './adapters/out/mongodb/mongo-push-subscription-repository.js';
import { MongoReminderSource } from './adapters/out/mongodb/mongo-reminder-source.js';
import { vapidFromEnv, WebPushGateway, type VapidConfig } from './adapters/out/notifications/web-push-gateway.js';
import { pushRoutes } from './adapters/in/http/push-routes.js';
import { reminderWorker } from './adapters/in/jobs/reminder-worker.js';

export type { NotificationGateway } from './application/ports/out/index.js';

export function createNotificationsModule(
  deps: CoreDeps & {
    profileReader: ProfileReader;
    /** defaults to VAPID_* env vars */
    vapid?: VapidConfig;
    /** override (tests) */
    gateway?: NotificationGateway;
  },
): ModuleDefinition & { pushRevoker: PushSubscriptionRevoker } {
  const subs = new MongoPushSubscriptionRepository(deps.db);
  const jobs = new MongoNotificationJobRepository(deps.db);
  const source = new MongoReminderSource(deps.db);
  const gateway = deps.gateway ?? new WebPushGateway(deps.vapid ?? vapidFromEnv());

  const register = new RegisterPushSubscription({ subs, ids: deps.ids, clock: deps.clock });
  const remove = new DeletePushSubscription({ subs });
  const revoke = new RevokeDeviceSubscriptions({ subs });

  const remindersDeps = {
    jobs,
    subs,
    source,
    gateway,
    remindersEnabled: (userId: string) => deps.profileReader.remindersEnabled(userId),
    clock: deps.clock,
    ids: deps.ids,
  };
  const worker = reminderWorker({
    plan: new PlanReminders(remindersDeps),
    dispatch: new DispatchDueReminders(remindersDeps, `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`),
    enabled: () => gateway.isEnabled(),
  });

  return {
    name: 'notifications',
    httpRoutes: pushRoutes({ register, remove, gateway }),
    ensureIndexes: async () => {
      await subs.ensureIndexes();
      await jobs.ensureIndexes();
    },
    jobs: [{ name: worker.name, start: worker.start }],
    pushRevoker: { revokeForDevice: (userId, deviceId) => revoke.execute(userId, deviceId) },
  };
}
