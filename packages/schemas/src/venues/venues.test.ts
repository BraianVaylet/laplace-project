import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOOKING_POLICY,
  bookingPolicySchema,
  businessHoursSchema,
  createVenueSchema,
  timeOfDaySchema,
  timeZoneSchema,
  updateVenueSchema,
} from './index.js';

describe('zona horaria', () => {
  it('acepta identificadores IANA reales', () => {
    expect(() => timeZoneSchema.parse('America/Argentina/Buenos_Aires')).not.toThrow();
    expect(() => timeZoneSchema.parse('Europe/Madrid')).not.toThrow();
    expect(() => timeZoneSchema.parse('UTC')).not.toThrow();
  });

  it('rechaza los inventados: una TZ mal escrita rompe todos los vencimientos', () => {
    for (const invalid of ['', 'Buenos Aires', 'America/Inventada']) {
      expect(() => timeZoneSchema.parse(invalid), invalid).toThrow();
    }
  });

  it('se valida contra el runtime, no contra una lista que se desactualiza', () => {
    // Si mañana se agrega una zona nueva a la IANA, esto la acepta sin cambios.
    expect(() => timeZoneSchema.parse('America/Argentina/Cordoba')).not.toThrow();
  });
});

describe('hora del dia', () => {
  it('acepta HH:mm en 24 horas', () => {
    for (const valid of ['00:00', '07:00', '19:30', '23:59']) {
      expect(() => timeOfDaySchema.parse(valid), valid).not.toThrow();
    }
  });

  it('rechaza lo que no lo es', () => {
    for (const invalid of ['7:00', '24:00', '19:60', '19', '7 PM', '']) {
      expect(() => timeOfDaySchema.parse(invalid), invalid).toThrow();
    }
  });
});

describe('horarios de atencion', () => {
  it('acepta un dia con apertura y cierre', () => {
    const parsed = businessHoursSchema.parse({ weekday: 1, opensAt: '07:00', closesAt: '22:00' });

    expect(parsed.weekday).toBe(1);
  });

  it('el cierre tiene que ser posterior a la apertura', () => {
    expect(() =>
      businessHoursSchema.parse({ weekday: 1, opensAt: '22:00', closesAt: '07:00' }),
    ).toThrow();
  });

  it('el dia va de 1 (lunes) a 7 (domingo), como Temporal', () => {
    expect(() =>
      businessHoursSchema.parse({ weekday: 0, opensAt: '07:00', closesAt: '22:00' }),
    ).toThrow();
    expect(() =>
      businessHoursSchema.parse({ weekday: 8, opensAt: '07:00', closesAt: '22:00' }),
    ).toThrow();
    expect(() =>
      businessHoursSchema.parse({ weekday: 7, opensAt: '09:00', closesAt: '13:00' }),
    ).not.toThrow();
  });
});

describe('politica de reserva', () => {
  it('los defaults son los de §2.1.5.c', () => {
    expect(DEFAULT_BOOKING_POLICY.bookingOpensMinutesBefore).toBe(7 * 24 * 60);
    expect(DEFAULT_BOOKING_POLICY.bookingClosesMinutesBefore).toBe(15);
    expect(DEFAULT_BOOKING_POLICY.cancelCutoffMinutes).toBe(120);
    expect(DEFAULT_BOOKING_POLICY.waitlistPromotionCutoffMinutes).toBe(30);
    expect(DEFAULT_BOOKING_POLICY.checkInOpensMinutesBefore).toBe(30);
    expect(DEFAULT_BOOKING_POLICY.checkInClosesMinutesAfter).toBe(30);
  });

  it('reservar con deuda esta apagado por default (ADR-004, decision 2)', () => {
    expect(DEFAULT_BOOKING_POLICY.allowDebt).toBe(false);
  });

  it('la politica de no-show trae los 3 intentos y las 48 horas de §2.1.5.d', () => {
    expect(DEFAULT_BOOKING_POLICY.noShowThreshold).toBe(3);
    expect(DEFAULT_BOOKING_POLICY.noShowBlockMinutes).toBe(48 * 60);
  });

  it('el cierre de reservas no puede ser antes que la apertura', () => {
    // Si lo fuera, la clase nunca seria reservable y nadie entenderia por que.
    expect(() =>
      bookingPolicySchema.parse({ bookingOpensMinutesBefore: 60, bookingClosesMinutesBefore: 120 }),
    ).toThrow();
  });

  it('el centro puede endurecer o aflojar cada ventana', () => {
    const estricta = bookingPolicySchema.parse({
      cancelCutoffMinutes: 12 * 60,
      allowDebt: false,
      waitlistMaxSize: 5,
    });

    expect(estricta.cancelCutoffMinutes).toBe(720);
    expect(estricta.waitlistMaxSize).toBe(5);
  });

  it('un umbral de no-show en 0 desactiva la penalizacion sin dejar de medirla', () => {
    expect(bookingPolicySchema.parse({ noShowThreshold: 0 }).noShowThreshold).toBe(0);
  });

  it('rechaza valores absurdos: una ventana de reserva de dos años es un error de tipeo', () => {
    expect(() => bookingPolicySchema.parse({ bookingOpensMinutesBefore: 999_999 })).toThrow();
    expect(() => bookingPolicySchema.parse({ cancelCutoffMinutes: -60 })).toThrow();
  });
});

describe('alta de sede', () => {
  const valido = {
    name: 'Box Toro Centro',
    address: 'Alsina 123, Bahía Blanca',
    timeZone: 'America/Argentina/Buenos_Aires',
  };

  it('con lo minimo, completa los defaults', () => {
    const parsed = createVenueSchema.parse(valido);

    expect(parsed.currency).toBe('ARS');
    expect(parsed.businessHours).toEqual([]);
    expect(parsed.bookingPolicy).toBeUndefined();
  });

  it('exige nombre y direccion: una sede sin direccion no sirve para nada', () => {
    expect(() => createVenueSchema.parse({ ...valido, name: 'A' })).toThrow();
    expect(() => createVenueSchema.parse({ ...valido, address: 'x' })).toThrow();
  });

  it('exige zona horaria: sin ella no se puede calcular un vencimiento', () => {
    const { timeZone: _tz, ...sinTz } = valido;

    expect(() => createVenueSchema.parse(sinTz)).toThrow();
  });

  it('recorta los espacios de mas', () => {
    expect(createVenueSchema.parse({ ...valido, name: '  Box Toro  ' }).name).toBe('Box Toro');
  });

  it('la moneda solo admite ARS en V1, pero el campo existe (§3.1)', () => {
    expect(createVenueSchema.parse({ ...valido, currency: 'ARS' }).currency).toBe('ARS');
    expect(() => createVenueSchema.parse({ ...valido, currency: 'USD' })).toThrow();
  });

  it('valida el color de marca', () => {
    expect(() =>
      createVenueSchema.parse({ ...valido, branding: { primaryColor: 'azul' } }),
    ).toThrow();
    expect(() =>
      createVenueSchema.parse({ ...valido, branding: { primaryColor: '#1a73e8' } }),
    ).not.toThrow();
  });

  it('valida la geolocalizacion', () => {
    expect(() => createVenueSchema.parse({ ...valido, geo: { lat: 91, lng: 0 } })).toThrow();
    expect(() =>
      createVenueSchema.parse({ ...valido, geo: { lat: -38.71, lng: -62.27 } }),
    ).not.toThrow();
  });

  it('no acepta mas de 7 dias de horario: son los dias que tiene la semana', () => {
    const ocho = Array.from({ length: 8 }, () => ({
      weekday: 1,
      opensAt: '07:00',
      closesAt: '22:00',
    }));

    expect(() => createVenueSchema.parse({ ...valido, businessHours: ocho })).toThrow();
  });
});

describe('edicion de sede', () => {
  it('todo es opcional: un PATCH cambia lo que le mandan y nada mas', () => {
    expect(() => updateVenueSchema.parse({})).not.toThrow();
    expect(updateVenueSchema.parse({ name: 'Box Toro Norte' }).name).toBe('Box Toro Norte');
  });

  it('lo que se manda igual se valida', () => {
    expect(() => updateVenueSchema.parse({ timeZone: 'America/Inventada' })).toThrow();
  });
});
