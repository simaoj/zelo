/**
 * Operation type names used as the idempotency envelope `type`. The intake ones are the
 * SyncOperationType values, so an operation sent via /sync/operations and retried via REST
 * (or vice versa) replays instead of duplicating.
 */
export const OP = {
  itemCreate: 'routineItem.create',
  itemUpdate: 'routineItem.update',
  itemArchive: 'routineItem.archive',
  scheduleRevise: 'routineItem.schedule.revise',
  intakePut: 'occurrence.intake.put',
  intakeUndo: 'occurrence.intake.delete',
  intakeCreate: 'intake.create',
  intakeUpdate: 'intake.update',
  intakeDelete: 'intake.delete',
} as const;
