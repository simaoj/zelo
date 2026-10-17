import webpush from 'web-push';
import type { NotificationGateway, SendOutcome } from '../../../application/ports/out/index.js';
import type { PushPayload } from '../../../domain/notification-job.js';

export interface VapidConfig {
  publicKey?: string | undefined;
  privateKey?: string | undefined;
  subject?: string | undefined;
}

/**
 * Web Push (VAPID) adapter. Missing/invalid keys → disabled: logged once, `send` never claims success.
 */
export class WebPushGateway implements NotificationGateway {
  private readonly enabled: boolean;
  private readonly pub: string | null;
  private readonly details: { subject: string; publicKey: string; privateKey: string } | null;

  constructor(cfg: VapidConfig, log: (msg: string) => void = (m) => console.warn(m)) {
    const { publicKey, privateKey } = cfg;
    const subject = cfg.subject || 'mailto:admin@zelo.local';
    if (!publicKey || !privateKey) {
      this.enabled = false;
      this.pub = null;
      this.details = null;
      log('[notifications] VAPID keys not configured — Web Push disabled (in-app reminders still work).');
      return;
    }
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey); // validates key format
      this.enabled = true;
      this.pub = publicKey;
      this.details = { subject, publicKey, privateKey };
    } catch (err) {
      this.enabled = false;
      this.pub = null;
      this.details = null;
      log(`[notifications] invalid VAPID configuration — Web Push disabled: ${(err as Error).message}`);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  publicKey(): string | null {
    return this.pub;
  }

  async send(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: PushPayload): Promise<SendOutcome> {
    if (!this.enabled || !this.details) return { outcome: 'error', message: 'push_disabled' };
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), {
        TTL: 60 * 60,
        urgency: 'high',
        vapidDetails: this.details,
      });
      return { outcome: 'sent' };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return { outcome: 'gone' };
      return { outcome: 'error', message: status ? `push_http_${status}` : 'push_network_error' };
    }
  }
}

export function vapidFromEnv(env: NodeJS.ProcessEnv = process.env): VapidConfig {
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}
