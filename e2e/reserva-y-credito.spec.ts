import { expect, test } from '@playwright/test';
import { autenticar, centroConSede, claseEn, socioConPack } from './support/centro.js';

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
 * 🔴 La venta va por API porque el DFSM todavía no tiene pantalla de venta
 * (deuda de F1-06). Reservar, cancelar y ver el saldo —lo que hace el socio—
 * va todo por la WAFM.
 */
test.describe('camino 2: reservar, cancelar y recuperar el crédito', () => {
  test('cancelar dentro de plazo devuelve el crédito', async ({ page, context }) => {
    test.setTimeout(120_000);

    const centro = await centroConSede('camino2');
    const { socio } = await socioConPack(centro, 'Micaela', 8);
    // A cuatro horas: el corte para recuperar el crédito son dos (§2.1.5.d).
    await claseEn(centro, 240, { nombre: 'Funcional de la tarde' });
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
