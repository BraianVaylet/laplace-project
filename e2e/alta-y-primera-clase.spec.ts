import { expect, test } from '@playwright/test';

/**
 * Camino crítico 1 (§Testing.7): **alta del suscriptor → onboarding → primera
 * clase publicada**.
 *
 * La métrica de §2.0 es time-to-first-class menor a 30 minutos, y lo que este
 * test protege es que el asistente diga la verdad: que marque un paso hecho
 * **solo cuando la cosa existe**. Un checklist que se auto-declara completo
 * deja al centro creyendo que abrió.
 *
 * 🔴 **El camino entero va por pantalla**, desde la landing. Es el recorrido
 * real de un cliente: entra al sitio, se registra, y de ahí sale con su centro
 * armado. Ninguna llamada de negocio se hace por API.
 */
test.describe('camino 1: del alta a la primera clase', () => {
  test('el asistente marca hecho lo que existe, y nada más', async ({ page }) => {
    test.setTimeout(120_000);

    /*
     * Se registra desde la landing, como cualquiera que llegue por Google. El
     * plan viaja en la URL desde la tabla de precios.
     */
    const email = `camino1-${Date.now().toString(36)}@laplace.test`;
    await page.goto('http://localhost:5176/empezar?plan=pro');
    await page.getByLabel(/Tu nombre/).fill('Braian');
    await page.getByLabel(/Tu email/).fill(email);
    await page.getByLabel(/Elegí una clave/).fill('unaClaveLargaYSegura123');
    await page.getByLabel(/Nombre de tu centro/).fill('Box Toro');
    await page.getByRole('button', { name: 'Crear mi centro' }).click();
    await expect(page.getByText(/Box Toro ya existe/)).toBeVisible();

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
    // Por rol y no por texto: el nombre también aparece en el aviso de éxito,
    // que además se va solo a los pocos segundos.
    await expect(page.getByRole('heading', { name: 'Box Toro Centro' })).toBeVisible();

    await page.goto('http://localhost:5174/');
    await expect(page.getByText('1 de 5 pasos')).toBeVisible();

    // 🔴 Saltear no completa: el paso queda pendiente, no hecho.
    await page.getByRole('button', { name: 'Dejar para después Cargá los horarios' }).click();
    await expect(page.getByText('Lo dejaste para después')).toBeVisible();
    await expect(page.getByText('1 de 5 pasos')).toBeVisible();

    // Y se puede volver, que es la otra mitad del criterio.
    await page.getByRole('button', { name: 'Retomar Cargá los horarios' }).click();
    await expect(page.getByText('Lo dejaste para después')).toBeHidden();

    // La clase también se publica por pantalla desde F1-35.
    await page.goto('http://localhost:5174/horario');
    await page.getByRole('button', { name: 'Publicar una clase' }).click();
    // La sala llega en su propio pedido: sin ella el formulario no se puede
    // enviar, y el botón está deshabilitado hasta que aparezca.
    await expect(page.getByLabel('Sala')).toBeEnabled();
    await page.getByLabel(/Nombre de la clase/).fill('Funcional');
    await page.getByLabel(/Categoría/).fill('funcional');
    await page.getByLabel('Lunes').check();
    await page.getByLabel('Miércoles').check();
    // `exact`: sin esto engancharía también "Publicar una clase".
    await page.getByRole('button', { name: 'Publicar', exact: true }).click();
    /*
     * Se espera la confirmación antes de navegar: irse en el medio aborta el
     * pedido y la clase no queda publicada. Es la misma carrera que sufriría
     * alguien que toca "Publicar" y cambia de pantalla enseguida.
     */
    await expect(page.getByText('Publicamos la clase.')).toBeVisible();

    await page.goto('http://localhost:5174/');
    await expect(page.getByText('2 de 5 pasos')).toBeVisible();

    // El producto también se crea por pantalla desde F1-34.
    await page.goto('http://localhost:5174/productos');
    await page.getByRole('button', { name: 'Crear el primero' }).click();
    await page.getByLabel(/Nombre/).fill('Pack 8 clases');
    await page.getByLabel(/Precio/).fill('60000');
    await page.getByLabel(/Cuántas clases trae/).fill('8');
    await page.getByLabel(/En cuántos días vence/).fill('60');
    await page.getByRole('button', { name: 'Crear', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pack 8 clases' })).toBeVisible();

    /*
     * Con la clase publicada y algo para vender, el centro opera: el asistente
     * se va solo. Dejarlo arriba para siempre le robaría el lugar al tablero.
     */
    await page.reload();
    await expect(page.getByText('Primeros pasos')).toBeHidden();
  });
});
