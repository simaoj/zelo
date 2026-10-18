/**
 * HTTP route table (prefix /api/v1). Single source of truth for frontend and backend.
 *
 * Auth & CSRF:
 *  - Session cookie `zelo_session` (HttpOnly, SameSite=Lax, Secure in production).
 *  - CSRF double-submit: cookie `zelo_csrf` (readable) must be echoed in header `x-csrf-token`
 *    on every non-GET request (including /auth/sign-in and /auth/sign-up; GET /auth/csrf issues it).
 *
 * Responses: 200/201 with resource body; 204 for deletes; errors use ApiError.
 * Idempotency: mutation bodies carry operationId; same id + same payload → same response,
 *   different payload → 409 IDEMPOTENCY_CONFLICT.
 * Optimistic concurrency: expectedVersion mismatch → 409 VERSION_CONFLICT with `current`.
 */
export const API_PREFIX = '/api/v1';

export const routes = {
  auth: {
    csrf: '/auth/csrf', // GET → { csrfToken }
    signUp: '/auth/sign-up', // POST SignUpRequest → SessionResponse (sets cookie)
    signIn: '/auth/sign-in', // POST SignInRequest → SessionResponse
    signOut: '/auth/sign-out', // POST → 204 (revokes session + this device's push subscriptions if deviceId header `x-device-id`)
    session: '/auth/session', // GET → SessionResponse | 401
    passwordResetRequest: '/auth/password-reset/request', // POST → 202 (always)
    passwordResetConfirm: '/auth/password-reset/confirm', // POST → 204
  },
  profile: '/profile', // GET, PATCH
  dashboard: '/dashboard', // GET ?date=YYYY-MM-DD
  weights: '/weights', // GET HistoryQuery, POST
  weight: (id: string) => `/weights/${id}`, // PATCH, DELETE
  weightGoal: '/weight-goal', // GET (404 none), PUT, DELETE
  measurements: '/measurements',
  measurement: (id: string) => `/measurements/${id}`,
  bloodPressure: '/blood-pressure',
  bloodPressureEntry: (id: string) => `/blood-pressure/${id}`,
  routineItems: '/routine-items', // GET ?includeArchived=true, POST
  routineItem: (id: string) => `/routine-items/${id}`, // PATCH
  routineItemArchive: (id: string) => `/routine-items/${id}/archive`, // POST
  routineItemSchedules: (id: string) => `/routine-items/${id}/schedules`, // POST ReviseScheduleRequest
  occurrences: '/occurrences', // GET ?date=YYYY-MM-DD
  occurrenceIntake: (id: string) => `/occurrences/${id}/intake`, // PUT, DELETE (undo)
  intakes: '/intakes', // GET HistoryQuery(+itemId), POST ad-hoc
  intake: (id: string) => `/intakes/${id}`, // PATCH, DELETE
  waterEntries: '/water-entries', // GET HistoryQuery, POST CreateWaterEntryRequest
  waterEntry: (id: string) => `/water-entries/${id}`, // PATCH, DELETE
  hydrationSummary: '/hydration/summary', // GET ?from&to (local dates)
  hydrationGoal: '/hydration/goal', // GET (404 none), PUT, DELETE
  activityToday: '/activity/today', // GET ?date= → ActivityToday
  activitySteps: '/activity/steps', // GET ?from&to → StepsSummary
  activityGoal: '/activity/goal', // GET (404 none), PUT, DELETE
  workouts: '/activity/workouts', // GET WorkoutsQuery → WorkoutPage
  workout: (id: string) => `/activity/workouts/${id}`, // GET → Workout
  /**
   * POST — Health Auto Export receiver. Auth: `Authorization: Bearer <integration token>`
   * (NOT the session cookie; no CSRF). Body ≤ HEALTH_IMPORT_MAX_BYTES. → HealthImportResponse
   */
  healthImport: '/imports/health',
  syncBootstrap: '/sync/bootstrap',
  syncChanges: '/sync/changes', // GET ?cursor=
  syncOperations: '/sync/operations', // POST
  pushConfig: '/push-subscriptions/config', // GET → PushConfigResponse
  pushSubscriptions: '/push-subscriptions', // POST
  pushSubscription: (id: string) => `/push-subscriptions/${id}`, // DELETE
  health: '/health',
} as const;
