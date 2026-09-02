import { describe, expect, it } from 'vitest';
import {
  PRODUCT_TYPES,
  createProductSchema,
  productTypeSchema,
  timeRangeSchema,
  updateProductSchema,
} from './index.js';

const BASE = { name: 'Pack 8 clases', venueIds: ['ven_centro'], priceCents: 6_000_000 };

const pack = (extra: Record<string, unknown> = {}) => ({
  ...BASE,
  type: 'class_pack',
  credits: 8,
  durationDays: 30,
  ...extra,
});

describe('los siete tipos de §2.1.17', () => {
  it('estan todos', () => {
    expect([...PRODUCT_TYPES]).toEqual([
      'class_pack',
      'membership_unlimited',
      'membership_limited',
      'drop_in',
      'trial',
      'personal_training',
      'event',
    ]);
  });

  it('un tipo inventado no se vende', () => {
    expect(() => productTypeSchema.parse('suscripcion_magica')).toThrow();
  });
});

describe('dinero', () => {
  it('el precio es un entero en centavos, nunca un float (§3.1)', () => {
    // 60.000,50 pesos son 6000050 centavos. Guardarlo como 60000.5 arrastra el
    // error de punto flotante a la caja del centro.
    expect(createProductSchema.parse(pack({ priceCents: 6_000_050 })).priceCents).toBe(6_000_050);
    expect(() => createProductSchema.parse(pack({ priceCents: 60_000.5 }))).toThrow();
  });

  it('no acepta un precio negativo', () => {
    expect(() => createProductSchema.parse(pack({ priceCents: -1 }))).toThrow();
  });

  it('la moneda es ARS y el campo existe desde el dia 1 (§3.1)', () => {
    expect(createProductSchema.parse(pack()).currency).toBe('ARS');
    expect(() => createProductSchema.parse(pack({ currency: 'USD' }))).toThrow();
  });
});

describe('reglas por tipo', () => {
  it('un pack de clases necesita creditos y vigencia', () => {
    expect(() => createProductSchema.parse(pack())).not.toThrow();
    expect(() => createProductSchema.parse(pack({ credits: undefined }))).toThrow();
    expect(() => createProductSchema.parse(pack({ durationDays: undefined }))).toThrow();
  });

  it('un pack sin creditos no es un pack: seria un regalo con vencimiento', () => {
    expect(() => createProductSchema.parse(pack({ credits: 0 }))).toThrow();
  });

  it('la membresia ilimitada no lleva creditos, pero si periodo', () => {
    const libre = { ...BASE, type: 'membership_unlimited', durationDays: 30 };

    expect(() => createProductSchema.parse(libre)).not.toThrow();
    // Ponerle creditos a un "ilimitado" es una contradiccion que despues alguien
    // tiene que desambiguar en el motor de reservas.
    expect(() => createProductSchema.parse({ ...libre, credits: 8 })).toThrow();
    expect(() => createProductSchema.parse({ ...BASE, type: 'membership_unlimited' })).toThrow();
  });

  it('la membresia con tope necesita el tope', () => {
    const base = { ...BASE, type: 'membership_limited', durationDays: 30 };

    expect(() => createProductSchema.parse({ ...base, weeklyLimit: 3 })).not.toThrow();
    expect(() => createProductSchema.parse({ ...base, monthlyLimit: 12 })).not.toThrow();
    // Sin tope es una ilimitada con otro nombre.
    expect(() => createProductSchema.parse(base)).toThrow();
  });

  it('la clase suelta vale exactamente 1 credito', () => {
    const suelta = { ...BASE, type: 'drop_in', credits: 1 };

    expect(createProductSchema.parse(suelta).credits).toBe(1);
    expect(() => createProductSchema.parse({ ...suelta, credits: 5 })).toThrow();
  });

  it('la clase de prueba es gratuita y de un solo credito', () => {
    const prueba = { ...BASE, type: 'trial', credits: 1, priceCents: 0 };

    expect(() => createProductSchema.parse(prueba)).not.toThrow();
    // §2.1.17 la define como gratuita. Cobrarla la convierte en un drop_in.
    expect(() => createProductSchema.parse({ ...prueba, priceCents: 100 })).toThrow();
  });

  it('el bono de personal training necesita sus sesiones', () => {
    const pt = { ...BASE, type: 'personal_training', credits: 4, durationDays: 60 };

    expect(() => createProductSchema.parse(pt)).not.toThrow();
    expect(() => createProductSchema.parse({ ...pt, credits: undefined })).toThrow();
  });

  it('un evento no tiene creditos ni vigencia: se compra la inscripcion', () => {
    const evento = { ...BASE, type: 'event', priceCents: 1_500_000 };

    expect(() => createProductSchema.parse(evento)).not.toThrow();
    expect(() => createProductSchema.parse({ ...evento, credits: 3 })).toThrow();
  });
});

describe('franja horaria habilitada', () => {
  it('acepta un rango del dia', () => {
    expect(() => timeRangeSchema.parse({ from: '06:00', to: '12:00' })).not.toThrow();
  });

  it('el fin tiene que ser posterior al inicio', () => {
    expect(() => timeRangeSchema.parse({ from: '12:00', to: '06:00' })).toThrow();
  });

  it('el pack matutino solo vale de 6 a 12', () => {
    const matutino = createProductSchema.parse(
      pack({ allowedTimeRanges: [{ from: '06:00', to: '12:00' }] }),
    );

    expect(matutino.allowedTimeRanges).toHaveLength(1);
  });
});

describe('defaults', () => {
  it('un producto nace visible en la WAFM, sin auto-renovacion y sin cupo', () => {
    const parsed = createProductSchema.parse(pack());

    expect(parsed.visibleInApp).toBe(true);
    // La auto-renovacion cobra sola: prenderla por default seria cobrarle a
    // alguien que no lo pidio.
    expect(parsed.autoRenew).toBe(false);
    expect(parsed.maxSales).toBeUndefined();
    expect(parsed.allowedCategories).toEqual([]);
  });

  it('sin categorias habilitadas vale para todas', () => {
    // Es lo que espera el 90%: el pack sirve para cualquier clase del centro.
    expect(createProductSchema.parse(pack()).allowedCategories).toEqual([]);
  });

  it('exige al menos una sede', () => {
    expect(() => createProductSchema.parse(pack({ venueIds: [] }))).toThrow();
  });
});

describe('edicion', () => {
  it('todo opcional', () => {
    expect(() => updateProductSchema.parse({})).not.toThrow();
  });

  it('el tipo NO se edita: cambia el significado de los contratos ya vendidos', () => {
    expect('type' in updateProductSchema.shape).toBe(false);
  });

  it('lo que se manda igual se valida', () => {
    expect(() => updateProductSchema.parse({ priceCents: -5 })).toThrow();
  });
});
