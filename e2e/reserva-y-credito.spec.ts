import { expect, test } from '@playwright/test';
import { autenticar, centroConSede, claseEn, packDe, socioSinPack } from './support/centro.js';

/**
 * Camino crítico 2 (§Testing.7): **el mostrador vende un pack → el socio
 * reserva → cancela dentro de plazo → recupera el crédito**.
 *
 * Es el que protege el ejemplo de la tarjeta: si un PR rompe la devolución al
 * cancelar, este test falla con la captura de la pantalla donde el saldo quedó
 * mal. La cuenta de créditos es lo que el socio mira todos los días, y ADR-001
 * dice que se descuenta **al reservar**, así que cancelar a tiempo tiene que
 * devolverlo.
 *
 * 🔴 **Todo el camino va por pantalla.** El mostrador vende desde la ficha del
 * socio en el DFSM (F1-37), y el socio reserva, cancela y mira su saldo en la
 * WAFM. Es el único de los tres caminos que cruza las dos aplicaciones, que es
 * exactamente lo que la tarjeta pedía probar.
 */
test.describe('camino 2: reservar, cancelar y recuperar el crédito', () => {
  test('cancelar dentro de plazo devuelve el crédito', async ({ page, context }) => {
    test.setTimeout(120_000);

    const centro = await centroConSede('camino2');
    const { socio, memberId } = await socioSinPack(centro, 'Micaela');
    await packDe(centro, 8);
    // A cuatro horas: el corte para recuperar el crédito son dos (§2.1.5.d).
    await claseEn(centro, 240, { nombre: 'Funcional de la tarde' });

    /*
     * El mostrador vende desde la ficha, en su propia sesión: es otra persona
     * con otro navegador, y mezclar las dos cookies en un solo contexto no
     * probaría lo que pasa de verdad.
     */
    const mostrador = await context.browser()!.newContext();
    await autenticar(mostrador, centro.smu);
    const pantallaMostrador = await mostrador.newPage();
    await pantallaMostrador.goto(`http://localhost:5174/miembros/${memberId}`);
    await pantallaMostrador.getByRole('button', { name: 'Venderle un pack' }).click();
    // `exact`: "Venderle un pack" también contiene "Vender".
    await pantallaMostrador.getByRole('button', { name: 'Vender', exact: true }).click();
    await expect(pantallaMostrador.getByText(/Vendimos Pack 8 clases/)).toBeVisible();
    await mostrador.close();

    await autenticar(context, socio);

    await page.goto('http://localhost:5175/packs');
    await expect(page.getByText('Te quedan 8 de 8 clases.')).toBeVisible();

    await page.goto('http://localhost:5175/horario');
    await page.getByRole('button', { name: 'Reservar' }).first().click();

    // 🔴 La política de cancelación se ve ANTES de confirmar (§2.1.5.d).
    await expect(page.getByText(/cancelar/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByRole('button', { name: 'Cancelar' }).first()).toBeVisible();

    await page.goto('http://localhost:5175/packs');
    await expect(page.getByText('Te quedan 7 de 8 clases.')).toBeVisible();

    await page.goto('http://localhost:5175/horario');
    await page.getByRole('button', { name: 'Cancelar' }).first().click();
    await page.getByRole('button', { name: 'Cancelar mi lugar' }).click();

    // Lo que el test protege: el crédito vuelve.
    await page.goto('http://localhost:5175/packs');
    await expect(page.getByText('Te quedan 8 de 8 clases.')).toBeVisible();
  });
});
