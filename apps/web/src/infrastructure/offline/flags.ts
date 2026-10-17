/**
 * Small device-level flags kept in localStorage. NONE of these is a credential:
 *  - offline enabled (per device opt-in)
 *  - the identity (userId/email) of the account whose data is on this device, so the
 *    offline shell can open the right IndexedDB without network
 *  - "pending revocation": the user signed out while offline; the server sign-out must run
 *    on reconnect before a new online session is allowed
 *  - this device's push subscription id (to DELETE it on sign-out)
 */
import type { SessionResponse } from '@zelo/contracts';

const K = {
  offline: 'zelo-offline-enabled',
  identity: 'zelo-offline-identity',
  revocation: 'zelo-pending-revocation',
  pushSubscriptionId: 'zelo-push-subscription-id',
} as const;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memory = new Map<string, string>();
const memoryStorage: KeyValueStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

export function defaultStorage(): KeyValueStorage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    /* blocked storage */
  }
  return memoryStorage;
}

export class DeviceFlags {
  constructor(private readonly s: KeyValueStorage = defaultStorage()) {}

  private get(k: string) {
    try {
      return this.s.getItem(k);
    } catch {
      return null;
    }
  }
  private set(k: string, v: string | null) {
    try {
      if (v === null) this.s.removeItem(k);
      else this.s.setItem(k, v);
    } catch {
      /* ignore */
    }
  }

  get offlineEnabled() {
    return this.get(K.offline) === '1';
  }
  set offlineEnabled(v: boolean) {
    this.set(K.offline, v ? '1' : null);
  }

  /** Identity of the account whose data lives on this device (no token, no expiry claims). */
  get identity(): SessionResponse | null {
    const raw = this.get(K.identity);
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as SessionResponse;
      return v?.user?.userId ? v : null;
    } catch {
      return null;
    }
  }
  set identity(v: SessionResponse | null) {
    this.set(K.identity, v ? JSON.stringify({ user: v.user, expiresAt: v.expiresAt }) : null);
  }

  get pendingRevocation() {
    return this.get(K.revocation) === '1';
  }
  set pendingRevocation(v: boolean) {
    this.set(K.revocation, v ? '1' : null);
  }

  get pushSubscriptionId() {
    return this.get(K.pushSubscriptionId);
  }
  set pushSubscriptionId(v: string | null) {
    this.set(K.pushSubscriptionId, v);
  }
  setPushSubscriptionId(v: string | null) {
    this.set(K.pushSubscriptionId, v);
  }
}
