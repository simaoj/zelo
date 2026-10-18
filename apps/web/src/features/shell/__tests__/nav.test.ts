import { describe, expect, it, vi } from 'vitest';
import { hiddenSectionFor, mobileNav, sectionTitle, visibleNav, visibleSaudeTabs } from '../nav';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));

describe('navigation', () => {
  const all = ['body', 'bloodPressure', 'hydration', 'activity', 'routine'] as const;

  it('has Hoje, Corpo, Saúde, Atividade, Rotina', () => {
    expect(visibleNav(all).map((i) => i.label)).toEqual(['Hoje', 'Corpo', 'Saúde', 'Atividade', 'Rotina']);
    expect(mobileNav(all).map((i) => i.label)).toEqual(['Corpo', 'Saúde', 'Atividade', 'Rotina']);
  });

  it('Saúde shows when either pressure or water is visible; tabs follow modules', () => {
    expect(visibleNav(['hydration']).map((i) => i.label)).toContain('Saúde');
    expect(visibleNav(['body']).map((i) => i.label)).not.toContain('Saúde');
    expect(visibleSaudeTabs(['hydration']).map((t) => t.label)).toEqual(['Água']);
    expect(visibleSaudeTabs(all).map((t) => t.label)).toEqual(['Pressão', 'Água']);
  });

  it('reports hidden sections/tabs for direct links', () => {
    expect(hiddenSectionFor('/saude/agua', ['bloodPressure'])?.title).toBe('Água');
    expect(hiddenSectionFor('/saude/pressao', ['bloodPressure'])).toBeUndefined();
    expect(hiddenSectionFor('/atividade/passos', ['body'])?.title).toBe('Atividade');
    expect(hiddenSectionFor('/pressao', ['body'])?.title).toBe('Pressão');
    expect(sectionTitle('/saude/agua')).toBe('Saúde');
    expect(sectionTitle('/atividade/exercicios/abc')).toBe('Atividade');
  });

  it('/pressao redirects to /saude/pressao', async () => {
    const { default: Page } = await import('@/app/(app)/pressao/page');
    Page();
    expect(redirect).toHaveBeenCalledWith('/saude/pressao');
  });
});
