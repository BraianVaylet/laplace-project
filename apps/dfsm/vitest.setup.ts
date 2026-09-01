import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Sin esto el DOM se acumula entre tests y las queries encuentran duplicados.
afterEach(cleanup);
