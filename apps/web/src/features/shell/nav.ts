import { Activity, Droplets, Dumbbell, Footprints, HeartPulse, Pill, Ruler, Settings, Stethoscope, Sun, Zap, type LucideIcon } from 'lucide-react';
import type { Module } from '@zelo/contracts';

export interface NavItem {
  href: string;
  label: string;
  title: string;
  icon: LucideIcon;
  /** the section is shown when ANY of these modules is visible (none = always) */
  modules?: Module[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/hoje', label: 'Hoje', title: 'Hoje', icon: Sun },
  { href: '/corpo', label: 'Corpo', title: 'Corpo', icon: Ruler, modules: ['body'] },
  { href: '/saude', label: 'Saúde', title: 'Saúde', icon: Stethoscope, modules: ['bloodPressure', 'hydration'] },
  { href: '/atividade', label: 'Atividade', title: 'Atividade', icon: Zap, modules: ['activity'] },
  { href: '/rotina', label: 'Rotina', title: 'Rotina', icon: Pill, modules: ['routine'] },
];

export const SETTINGS_ITEM: NavItem = { href: '/configuracoes', label: 'Configurações', title: 'Configurações', icon: Settings };

/** Sub-sections (tabs) with their own module, checked before the parent section. */
export interface SubSection {
  href: string;
  label: string;
  title: string;
  icon: LucideIcon;
  module: Module;
}

export const SAUDE_TABS: SubSection[] = [
  { href: '/saude/pressao', label: 'Pressão', title: 'Pressão', icon: HeartPulse, module: 'bloodPressure' },
  { href: '/saude/agua', label: 'Água', title: 'Água', icon: Droplets, module: 'hydration' },
];

export const ATIVIDADE_TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/atividade/resumo', label: 'Resumo', icon: Activity },
  { href: '/atividade/passos', label: 'Passos', icon: Footprints },
  { href: '/atividade/exercicios', label: 'Exercícios', icon: Dumbbell },
];

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function isVisible(item: { modules?: Module[] }, modules: readonly Module[]): boolean {
  return !item.modules || item.modules.some((m) => modules.includes(m));
}

export function visibleNav(modules: readonly Module[]): NavItem[] {
  return NAV_ITEMS.filter((i) => isVisible(i, modules));
}

/** Bottom bar on mobile: everything except Hoje (reachable from the header "Hoje" button). */
export function mobileNav(modules: readonly Module[]): NavItem[] {
  return visibleNav(modules).filter((i) => i.href !== '/hoje');
}

export function visibleSaudeTabs(modules: readonly Module[]): SubSection[] {
  return SAUDE_TABS.filter((t) => modules.includes(t.module));
}

export function sectionTitle(pathname: string): string {
  if (matches(pathname, '/pressao')) return 'Saúde';
  const all = [...NAV_ITEMS, SETTINGS_ITEM];
  return all.find((i) => matches(pathname, i.href))?.title ?? 'Zelo';
}

/** The section/tab whose module is hidden in the profile, if the user opened its route directly. */
export function hiddenSectionFor(pathname: string, modules: readonly Module[]): { title: string } | undefined {
  const tab = SAUDE_TABS.find((t) => matches(pathname, t.href));
  if (tab) return modules.includes(tab.module) ? undefined : tab;
  if (matches(pathname, '/pressao')) return modules.includes('bloodPressure') ? undefined : { title: 'Pressão' };
  return NAV_ITEMS.find((i) => matches(pathname, i.href) && !isVisible(i, modules));
}
