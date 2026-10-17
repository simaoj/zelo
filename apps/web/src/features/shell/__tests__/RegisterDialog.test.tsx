import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Harness, fakeData } from '@/test/harness';
import { RegisterProvider, useRegister } from '../RegisterDialog';

function Trigger() {
  const { open } = useRegister();
  return (
    <button type="button" onClick={() => open()}>
      Registrar
    </button>
  );
}

describe('Registrar dialog', () => {
  it('is modal, traps focus, closes on Esc and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(
      <Harness data={fakeData()}>
        <RegisterProvider>
          <Trigger />
        </RegisterProvider>
      </Harness>,
    );
    const trigger = screen.getByRole('button', { name: 'Registrar' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Registrar');
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (const label of ['Peso', 'Medidas', 'Pressão', 'Tomada']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    // Tab cycles inside the dialog
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens the chosen form', async () => {
    const user = userEvent.setup();
    render(
      <Harness data={fakeData()}>
        <RegisterProvider>
          <Trigger />
        </RegisterProvider>
      </Harness>,
    );
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    await user.click(screen.getByRole('button', { name: /^Peso/ }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Registrar peso');
    expect(screen.getByLabelText(/Peso \(kg\)/)).toBeInTheDocument();
  });
});
