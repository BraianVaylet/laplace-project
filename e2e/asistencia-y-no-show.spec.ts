import { expect, test } from '@playwright/test';
import { autenticar, centroConSede, claseEn, correrJob, socioConPack } from './support/centro.js';

/**
 * Camino crítico 3 (§Testing.7): **el coach abre la lista → toma asistencia →
 * el no-show queda marcado por el job**.
 *
 * La lista de clase es lo que el coach usa de pie, con el celular en la mano y
 * la clase empezando. Lo que este test protege es que marcar presente a uno no
 * marque a otro, y que el que no vino quede como ausente **sin que nadie lo
 * haga a mano** — es lo que sostiene la política de no-shows de §2.1.5.d.
 *
 * 🔴 El job corre con el reloj adelantado, el mismo seam que usan los tests de
 * integración: la ventana de check-in cierra media hora después del inicio, y
 * un E2E no puede quedarse media hora esperando. La lógica que corre es la
 * entera, no una versión de prueba.
 */
test.describe('camino 3: asistencia y no-show', () => {
  test('el que vino queda presente y el que no, ausente', async ({ page, context }) => {
    test.setTimeout(120_000);

    const centro = await centroConSede('camino3');
    const { memberId: idVino } = await socioConPack(centro, 'Micaela');
    const { memberId: idFalto } = await socioConPack(centro, 'Julian');

    /*
     * A 25 minutos: el check-in abre 30 antes —así que ya está abierto— y la
     * reserva cierra 15 antes, así que todavía se puede reservar. Es la única
     * ventana donde las dos cosas son ciertas a la vez.
     */
    const clase = await claseEn(centro, 25, { nombre: 'Funcional de la noche' });

    for (const memberId of [idVino, idFalto]) {
      const res = await centro.smu.api.post('bookings', {
        data: { sessionId: clase.sessionId, memberId },
        headers: { 'Idempotency-Key': `e2e-${clase.sessionId}-${memberId}` },
      });
      expect(res.ok(), await res.text()).toBe(true);
    }

    await autenticar(context, centro.smu);
    await page.goto(`http://localhost:5174/clases/${clase.sessionId}`);

    await expect(page.getByText('Micaela Socio')).toBeVisible();
    await expect(page.getByText('Julian Socio')).toBeVisible();

    const fila = page.locator('li', { hasText: 'Micaela Socio' });
    await fila.getByRole('button', { name: 'Marcar' }).click();
    await expect(fila.getByText('Presente')).toBeVisible();

    // Marcar a uno no marca al otro: el que falta sigue con su botón.
    const filaAusente = page.locator('li', { hasText: 'Julian Socio' });
    await expect(filaAusente.getByRole('button', { name: 'Marcar' })).toBeVisible();

    // Media hora después del inicio la ventana cerró: recién ahí es un ausente.
    const despues = new Date(Date.parse(clase.startAt) + 31 * 60_000).toISOString();
    await correrJob('markNoShows', despues);

    /*
     * La lista del coach solo muestra a los que están en juego —anotados,
     * presentes y en espera—, así que el ausente se verifica donde queda: en su
     * reserva. El mostrador puede consultarla porque es quien reserva por otro.
     */
    const estadoDe = async (memberId: string) => {
      const res = await centro.smu.api.get(`bookings?memberId=${memberId}`);
      expect(res.ok(), await res.text()).toBe(true);
      const pagina = (await res.json()) as { items: Array<{ status: string }> };

      return pagina.items[0]?.status;
    };

    expect(await estadoDe(idVino)).toBe('checked_in');
    expect(await estadoDe(idFalto)).toBe('no_show');
  });
});
