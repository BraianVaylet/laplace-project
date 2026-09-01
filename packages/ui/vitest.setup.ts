import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Sin esto el DOM se acumula entre tests y las queries encuentran duplicados.
afterEach(cleanup);

// vitest-axe agrega los matchers de accesibilidad; jsdom no implementa
// showModal/close del <dialog>, asi que se completan aca para poder testear el
// Dialog sin cambiar la implementacion (que en el navegador si los usa).
if (typeof HTMLDialogElement !== 'undefined') {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
    show: () => void;
  };

  if (!proto.showModal) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (!proto.show) {
    proto.show = function show(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (!proto.close) {
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}
