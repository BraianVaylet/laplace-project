import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { patchJsdomDialog } from '@laplace/config/testing/jsdom-dialog';

// Sin esto el DOM se acumula entre tests y las queries encuentran duplicados.
afterEach(cleanup);

patchJsdomDialog();
