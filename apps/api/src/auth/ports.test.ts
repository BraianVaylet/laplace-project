import { describe, expect, it } from 'vitest';
import { createLoggingEmailSender } from './ports.js';

/**
 * El sender de desarrollo: deja el enlace en el log en vez de mandarlo, para
 * poder verificar una cuenta en local sin proveedor de mail configurado.
 */
describe('EmailSender de desarrollo', () => {
  function spy() {
    const calls: Array<{ msg: string; meta: Record<string, unknown> }> = [];
    const sender = createLoggingEmailSender((msg, meta) => {
      calls.push({ msg, meta: meta as Record<string, unknown> });
    });
    return { calls, sender };
  }

  it('loguea el enlace de verificacion con su destinatario', async () => {
    const { calls, sender } = spy();

    await sender.sendVerification({
      to: 'micaela@boxtoro.com',
      url: 'http://localhost:3000/verify?token=abc',
      token: 'abc',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.meta['module']).toBe('auth');
    expect(calls[0]?.meta['action']).toBe('sendVerificationEmail');
    expect(calls[0]?.meta['meta']).toMatchObject({
      to: 'micaela@boxtoro.com',
      url: 'http://localhost:3000/verify?token=abc',
    });
  });

  it('loguea el magic link', async () => {
    const { calls, sender } = spy();

    await sender.sendMagicLink({
      to: 'micaela@boxtoro.com',
      url: 'http://localhost:3000/magic?token=xyz',
      token: 'xyz',
    });

    expect(calls[0]?.meta['action']).toBe('sendMagicLink');
  });

  it('deja claro en el mensaje que NO se envio nada', async () => {
    const { calls, sender } = spy();

    await sender.sendVerification({ to: 'a@b.com', url: 'http://x', token: 't' });

    // Si el mensaje no lo aclarara, en staging alguien podria dar por enviado
    // un mail que nunca salio.
    expect(calls[0]?.msg).toMatch(/no se envio/i);
  });

  it('no loguea el token suelto: el enlace ya lo lleva y duplicarlo lo esparce', async () => {
    const { calls, sender } = spy();

    await sender.sendVerification({
      to: 'a@b.com',
      url: 'http://x?token=secreto',
      token: 'secreto',
    });

    expect(Object.keys(calls[0]?.meta['meta'] as object)).toEqual(['to', 'url']);
  });
});
