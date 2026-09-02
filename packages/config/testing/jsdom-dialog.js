/**
 * jsdom no implementa `showModal()`, `show()` ni `close()` del `<dialog>`
 * nativo. Sin esto, un modal renderiza pero nunca queda `open`, asi que no
 * expone el rol `dialog` y ningun test puede encontrarlo.
 *
 * Se completa aca, en un solo lugar, en vez de cambiar la implementacion para
 * que sea testeable: en el navegador `showModal()` es justo lo que da el foco
 * atrapado y el fondo inerte, y no queremos renunciar a eso.
 */
export function patchJsdomDialog() {
  if (typeof HTMLDialogElement === 'undefined') return;

  const proto = HTMLDialogElement.prototype;

  if (!proto.showModal) {
    proto.showModal = function showModal() {
      this.open = true;
    };
  }

  if (!proto.show) {
    proto.show = function show() {
      this.open = true;
    };
  }

  if (!proto.close) {
    proto.close = function close() {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}
