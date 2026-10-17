/** Stable per-device identifier (not a secret). Used for push subscriptions. SSR-safe. */
const KEY = 'zelo-device-id';
let memoryId: string | null = null;

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getDeviceId(): string {
  if (typeof window === 'undefined') return memoryId ?? (memoryId = uuid());
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id = uuid();
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return memoryId ?? (memoryId = uuid());
  }
}
