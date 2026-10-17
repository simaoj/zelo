'use client';
/** Captures `beforeinstallprompt` as early as possible (module load) for the InstallPrompt. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export const getInstallEvent = () => deferred;
export const wasInstalled = () => installed;
export function subscribeInstall(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null;
  emit();
  await e.prompt();
  const choice = await e.userChoice;
  return choice.outcome;
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}

export type InstallPlatform = 'ios-safari' | 'ios-other' | 'android' | 'desktop' | 'unknown';
export function detectPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  const iOS = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (iOS) return /crios|fxios|edgios/i.test(ua) ? 'ios-other' : 'ios-safari';
  if (/android/i.test(ua)) return 'android';
  if (/windows|macintosh|linux|cros/i.test(ua)) return 'desktop';
  return 'unknown';
}
