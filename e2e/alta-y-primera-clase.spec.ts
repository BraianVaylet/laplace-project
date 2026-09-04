import { expect, test } from '@playwright/test';
import { autenticar, centroConSede } from './support/centro.js';

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
 * la cuenta, la de la sede, la de la clase y la del producto. Son deuda
 * declarada de F1-06 y F1-30. Lo que sí tiene pantalla —el asistente— se
 * recorre por pantalla.
 */
test.describe('camino 1: del alta a la primera clase', () => {
  test('el asistente marca hecho lo que existe, y nada más', async ({ page, context }) => {
    test.setTimeout(120_000);

    const centro = await centroConSede('camino1');
    await autenticar(context, centro.smu);

    await page.goto('http://localhost:5174/');

    // La sede ya está: es el único paso hecho, y destraba los demás.
    await expect(page.getByText('Primeros pasos')).toBeVisible();
    await expect(page.getByText('1 de 5 pasos')).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');

    // 🔴 Saltear no completa: el paso queda pendiente, no hecho.
    await page.getByRole('button', { name: 'Dejar para después Cargá los horarios' }).click();
    await expect(page.getByText('Lo dejaste para después')).toBeVisible();
    await expect(page.getByText('1 de 5 pasos')).toBeVisible();

    // Y se puede volver, que es la otra mitad del criterio.
    await page.getByRole('button', { name: 'Retomar Cargá los horarios' }).click();
    await expect(page.getByText('Lo dejaste para después')).toBeHidden();

    await centro.smu.api.post('class-templates', {
      data: {
        venueId: centro.venueId,
        roomId: centro.roomId,
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

    await centro.smu.api.post('products', {
      data: {
        name: 'Pack 8 clases',
        type: 'class_pack',
        priceCents: 6_000_000,
        credits: 8,
        durationDays: 60,
        venueIds: [centro.venueId],
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
