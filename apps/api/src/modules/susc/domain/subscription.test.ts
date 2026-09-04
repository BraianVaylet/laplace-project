import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import {
  assertFitsInPlan,
  assertTransition,
  assertValidCuit,
  canTransition,
  isTrialOver,
  isValidCuit,
  periodEndsAt,
  planChangeKindOf,
  prorate,
  trialEndsAt,
} from './subscription.js';
import type { AppError } from '../../../http/errors.js';

/**
 * El ciclo de vida del suscriptor (§2.1.3, §2.1.4). Es el módulo del que
 * depende que el producto cobre, y la regla que más importa no es una
 * validación: **nunca se borra por falta de pago**. Suspender conserva todo.
 */
const AR = 'America/Argentina/Buenos_Aires';

describe('la máquina de estados (§14)', () => {
  it('del trial se sale pagando, cancelando o venciendo', () => {
    expect(canTransition('trial', 'active')).toBe(true);
    expect(canTransition('trial', 'suspended')).toBe(true);
    expect(canTransition('trial', 'cancelled')).toBe(true);
  });

  it('el que se atrasa vuelve pagando', () => {
    expect(canTransition('active', 'past_due')).toBe(true);
    expect(canTransition('past_due', 'active')).toBe(true);
  });

  it('🔴 el suspendido vuelve: pagar destraba la cuenta, no la recrea', () => {
    // Los datos siguen ahí (§2.1.3): volver es cambiar un estado, no migrar.
    expect(canTransition('suspended', 'active')).toBe(true);
  });

  it('🔴 no se vuelve al trial: se prueba una vez', () => {
    expect(canTransition('active', 'trial')).toBe(false);
    expect(canTransition('suspended', 'trial')).toBe(false);
  });

  it('la transición inválida falla con su código', () => {
    try {
      assertTransition('active', 'trial');
      throw new Error('tenía que fallar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-SUSC-422-001');
      expect((error as AppError).message).toContain('active');
    }
  });
});

describe('el trial (ADR-004)', () => {
  it('🔴 dura catorce días del calendario del centro, no 14×24 horas', () => {
    // 23:50 del 1 de marzo en Buenos Aires es 02:50 UTC del 2.
    const tarde = Temporal.Instant.from('2026-03-02T02:50:00Z');

    /*
     * Vence a la medianoche del 15, no a las 23:50 del 14: quien se registra
     * diez minutos antes de medianoche tiene catorce días completos.
     */
    expect(trialEndsAt(tarde, AR).toString()).toBe('2026-03-15T03:00:00Z');
  });

  it('se cuenta en la zona del centro, no en la del servidor', () => {
    const instante = Temporal.Instant.from('2026-03-02T02:50:00Z');

    expect(trialEndsAt(instante, AR).toString()).not.toBe(
      trialEndsAt(instante, 'Asia/Tokyo').toString(),
    );
  });

  it('el borde exacto ya está vencido', () => {
    const fin = Temporal.Instant.from('2026-03-15T03:00:00Z');

    expect(isTrialOver(fin, fin)).toBe(true);
    expect(isTrialOver(fin, fin.subtract({ seconds: 1 }))).toBe(false);
  });
});

describe('el cambio de plan (§2.1.4)', () => {
  it('sabe qué es subir y qué es bajar', () => {
    expect(planChangeKindOf('basic', 'pro')).toBe('upgrade');
    expect(planChangeKindOf('max', 'pro')).toBe('downgrade');
    expect(planChangeKindOf('pro', 'pro')).toBe('same');
  });

  it('🔴 subir a mitad de ciclo cobra la diferencia por lo que queda', () => {
    // Pro $30.000 → Max $60.000, faltando 10 de los 30 días del ciclo.
    const cobro = prorate({
      fromPriceCents: 3_000_000,
      toPriceCents: 6_000_000,
      now: Temporal.Instant.from('2026-03-04T12:00:00Z'),
      periodEndsAt: Temporal.Instant.from('2026-03-14T12:00:00Z'),
      timeZone: AR,
    });

    // $30.000 de diferencia por 10/30 del ciclo: $10.000.
    expect(cobro).toBe(1_000_000);
  });

  it('bajar no devuelve plata a mitad de ciclo: baja al terminar', () => {
    const cobro = prorate({
      fromPriceCents: 6_000_000,
      toPriceCents: 3_000_000,
      now: Temporal.Instant.from('2026-03-04T12:00:00Z'),
      periodEndsAt: Temporal.Instant.from('2026-03-14T12:00:00Z'),
      timeZone: AR,
    });

    expect(cobro).toBe(0);
  });

  it('con el ciclo terminado no se cobra nada extra', () => {
    const cobro = prorate({
      fromPriceCents: 3_000_000,
      toPriceCents: 6_000_000,
      now: Temporal.Instant.from('2026-03-20T12:00:00Z'),
      periodEndsAt: Temporal.Instant.from('2026-03-14T12:00:00Z'),
      timeZone: AR,
    });

    expect(cobro).toBe(0);
  });

  it('el ciclo dura treinta días desde la medianoche del centro', () => {
    const inicio = Temporal.Instant.from('2026-03-04T12:00:00Z');

    expect(periodEndsAt(inicio, AR).toString()).toBe('2026-04-03T03:00:00Z');
  });
});

describe('los límites al bajar de plan (§2.1.4)', () => {
  const BASIC = { venues: 1, activeMembers: 60, staffUsers: 3 };

  it('si entra, pasa', () => {
    expect(() =>
      assertFitsInPlan('basic', { venues: 1, activeMembers: 40, staffUsers: 2 }, BASIC),
    ).not.toThrow();
  });

  it('🔴 si no entra, dice exactamente qué excede', () => {
    // "No podés bajar" a secas deja al SMU adivinando qué borrar.
    try {
      assertFitsInPlan('basic', { venues: 2, activeMembers: 120, staffUsers: 2 }, BASIC);
      throw new Error('tenía que fallar');
    } catch (error) {
      const mensaje = (error as AppError).message;

      expect((error as AppError).code).toBe('LP-SUBS-422-001');
      expect(mensaje).toContain('socios activos: tenés 120');
      expect(mensaje).toContain('sedes: tenés 2');
      expect(mensaje).not.toContain('staff');
    }
  });

  it('el plan sin techo acepta cualquier cosa', () => {
    expect(() =>
      assertFitsInPlan(
        'max',
        { venues: 40, activeMembers: 9_000, staffUsers: 300 },
        { venues: null, activeMembers: null, staffUsers: null },
      ),
    ).not.toThrow();
  });

  it('estar justo en el tope entra: el límite es inclusivo', () => {
    expect(() =>
      assertFitsInPlan('basic', { venues: 1, activeMembers: 60, staffUsers: 3 }, BASIC),
    ).not.toThrow();
  });
});

describe('el CUIT', () => {
  it('acepta uno válido', () => {
    // 20-12345678-6: verificador calculado a mano.
    expect(isValidCuit('20123456786')).toBe(true);
  });

  it('🔴 rechaza uno con un dígito cambiado', () => {
    // Un CUIT mal tipeado no se nota hasta que hay que emitir el comprobante.
    expect(isValidCuit('20123456787')).toBe(false);
  });

  it('rechaza lo que no tiene once dígitos', () => {
    expect(isValidCuit('2012345678')).toBe(false);
    expect(isValidCuit('20-12345678-6')).toBe(false);
  });

  it('el error dice qué revisar', () => {
    try {
      assertValidCuit('20123456787');
      throw new Error('tenía que fallar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-SUSC-422-001');
      expect((error as AppError).message).toContain('CUIT');
    }
  });
});
