/**
 * Frontend composition root (browser only). Builds the HTTP adapters and wraps them
 * with the offline-first layer; the UI uses ONLY the returned { data, sync, auth }.
 */
import { createOfflineDataLayer, type OfflineDataLayer } from '@/infrastructure/offline';
import { HttpAuth, HttpClient, HttpDataSource } from '@/infrastructure/http';

let instance: OfflineDataLayer | null = null;

export function getComposition(): OfflineDataLayer {
  if (!instance) {
    const client = new HttpClient();
    const http = new HttpDataSource(client);
    const auth = new HttpAuth(client);
    instance = createOfflineDataLayer(http, auth);
  }
  return instance;
}
