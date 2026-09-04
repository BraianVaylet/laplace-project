import { expect, test } from '@playwright/test';

test.describe('smoke de la WAFM', () => {
  test('la app carga y muestra su titulo', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('no hay errores de JavaScript en el arranque', async ({ page }) => {
    /*
     * Se miran los errores de JS, no los de red.
     *
     * Quien abre la WAFM sin sesión recibe 401 en lo suyo, y el navegador lo
     * anota como "Failed to load resource": eso es el producto funcionando —
     * un visitante anónimo no tiene packs ni reservas—, no una falla. Contarlo
     * como error haría que este test pidiera que la API deje pasar a cualquiera.
     */
    const errores: string[] = [];
    page.on('pageerror', (error) => errores.push(error.message));
    page.on('console', (msg) => {
      const texto = msg.text();
      if (msg.type() === 'error' && !texto.includes('Failed to load resource')) {
        errores.push(texto);
      }
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(errores).toEqual([]);
  });
});
