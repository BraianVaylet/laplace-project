import { expect, test } from '@playwright/test';
import { autenticar, suscriptorSinSede } from './support/centro.js';

/**
 * Camino crítico 1 (§Testing.7): **alta del suscriptor → onboarding → primera
 * clase publicada**.
 *
 * La métrica de §2.0 es time-to-first-class menor a 30 minutos, y lo que este
 * test protege es que el asistente diga la verdad: que marque un paso hecho
 * **solo cuando la cosa existe**. Un checklist que se auto-declara completo
 * deja al centro creyendo que abrió.
 *
 * 🔴 Lo que va por API acá es lo que **todavía no tiene pantalla**: el alta de
 * la cuenta, la de la clase y la del producto. La sede ya se crea por pantalla
 * desde F1-33, que es como se paga esta deuda: la llamada se reemplaza por sus
 * clics y el resto del test no se toca.
 */
test.describe('camino 1: del alta a la primera clase', () => {
  test('el asistente marca hecho lo que existe, y nada más', async ({ page, context }) => {
    test.setTimeout(120_000);

    const smu = await suscriptorSinSede('camino1');
    await autenticar(context, smu);

    await page.goto('http://localhost:5174/');

    // Recién registrado: sin sede, el asistente arranca en cero.
    await expect(page.getByText('Primeros pasos')).toBeVisible();
    await expect(page.getByText('0 de 5 pasos')).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    // La sede se crea por pantalla, que es lo que el asistente promete.
    await page.goto('http://localhost:5174/sedes');
    await page.getByRole('button', { name: 'Crear la primera' }).click();
    await page.getByLabel(/Nombre/).fill('Box Toro Centro');
    await page.getByLabel(/Dirección/).fill('Alsina 123, Bahía Blanca');
    // `exact`: sin esto también engancharía "Crear la primera".
    await page.getByRole('button', { name: 'Crear', exact: true }).click();
    await expect(page.getByText('Box Toro Centro')).toBeVisible();

    await page.goto('http://localhost:5174/');
    await expect(page.getByText('1 de 5 pasos')).toBeVisible();

    const venueId = (await (await smu.api.get('venues')).json()).items[0].publicId as string;
    const roomId = (await (await smu.api.get(`rooms?venueId=${venueId}`)).json()).items[0]
      .publicId as string;

    // 🔴 Saltear no completa: el paso queda pendiente, no hecho.
    await page.getByRole('button', { name: 'Dejar para después Cargá los horarios' }).click();
    await expect(page.getByText('Lo dejaste para después')).toBeVisible();
    await expect(page.getByText('1 de 5 pasos')).toBeVisible();

    // Y se puede volver, que es la otra mitad del criterio.
    await page.getByRole('button', { name: 'Retomar Cargá los horarios' }).click();
    await expect(page.getByText('Lo dejaste para después')).toBeHidden();

    await smu.api.post('class-templates', {
      data: {
        venueId,
        roomId,
        name: 'Funcional',
        categoryId: 'funcional',
        durationMin: 60,
        capacity: 12,
        recurrence: {
          freq: 'weekly',
          byWeekday: [1, 3, 5],
          timeOfDay: '19:00',
          interval: 1,
          from: new Date().toISOString().slice(0, 10),
        },
      },
    });

    await page.reload();
    await expect(page.getByText('2 de 5 pasos')).toBeVisible();

    await smu.api.post('products', {
      data: {
        name: 'Pack 8 clases',
        type: 'class_pack',
        priceCents: 6_000_000,
        credits: 8,
        durationDays: 60,
        venueIds: [venueId],
      },
    });

    /*
     * Con la clase publicada y algo para vender, el centro opera: el asistente
     * se va solo. Dejarlo arriba para siempre le robaría el lugar al tablero.
     */
    await page.reload();
    await expect(page.getByText('Primeros pasos')).toBeHidden();
  });
});
