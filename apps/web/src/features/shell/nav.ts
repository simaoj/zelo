import { HeartPulse, Pill, Ruler, Settings, Sun, type LucideIcon } from 'lucide-react';
import type { Module } from '@zelo/contracts';

export interface NavItem {
  href: string;
  label: string;
  title: string;
  icon: LucideIcon;
  module?: Module;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/hoje', label: 'Hoje', title: 'Hoje', icon: Sun },
  { href: '/corpo', label: 'Corpo', title: 'Corpo', icon: Ruler, module: 'body' },
  { href: '/pressao', label: 'Pressão', title: 'Pressão', icon: HeartPulse, module: 'bloodPressure' },
  { href: '/rotina', label: 'Rotina', title: 'Rotina', icon: Pill, module: 'routine' },
];

export const SETTINGS_ITEM: NavItem = { href: '/configuracoes', label: 'Configurações', title: 'Configurações', icon: Settings };

export function visibleNav(modules: readonly Module[]): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.module || modules.includes(i.module));
}

export function sectionTitle(pathname: string): string {
  const all = [...NAV_ITEMS, SETTINGS_ITEM];
  return all.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))?.title ?? 'Zelo';
}


/** The nav item whose module is hidden in the profile, if the user opened its route directly. */
export function hiddenSectionFor(pathname: string, modules: readonly Module[]): NavItem | undefined {
  return NAV_ITEMS.find(
    (i) => i.module && !modules.includes(i.module) && (pathname === i.href || pathname.startsWith(`${i.href}/`)),
  );
}
