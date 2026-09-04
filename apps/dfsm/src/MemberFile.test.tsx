import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { MemberFile } from './MemberFile.js';

/**
 * La ficha 360 (§2.1.7): la pantalla más usada del DFSM.
 *
 * 🔴 Dos cosas no se negocian acá. Que **cada sección falle sola** —una caída
 * de cobranza no puede dejar al mostrador sin ver los packs del socio— y que
 * lo que el coach no puede ver **no aparezca**, porque la API no se lo manda.
 */
const SOCIO = {
  publicId: 'mem_1',
  venueIds: ['ven_1'],
  firstName: 'Micaela',
  lastName: 'Sosa',
  phone: '+542914567890',
  status: 'active',
  flags: { debtor: false, suspended: false },
  tags: ['mañana'],
  balanceCents: -1_200_000,
  joinedAt: '2025-11-02T12:00:00Z',
  lastAttendanceAt: '2026-02-21T22:00:00Z',
  noShowCount: 0,
  bookingBlockedUntil: null,
  createdAt: '2025-11-02T12:00:00Z',
  updatedAt: '2026-02-21T22:00:00Z',
};

const FICHA = {
  memberId: 'mem_1',
  contracts: [
    {
      contractId: 'ctr_1',
      productName: 'Pack 8 clases',
      productType: 'class_pack',
      status: 'active',
      creditsLeft: 3,
      creditsTotal: 8,
      endsAt: '2026-03-15T03:00:00Z',
      daysLeft: 13,
    },
  ],
  upcomingBookings: [
    {
      bookingId: 'bkg_1',
      sessionId: 'ses_1',
      className: 'Funcional',
      startAt: '2026-03-03T22:00:00Z',
      status: 'booked',
    },
  ],
  attendance: {
    windowDays: 90,
    attended: 14,
    noShows: 1,
    lastAttendanceAt: '2026-02-21T22:00:00Z',
    daysSinceLastVisit: 9,
  },
  waivers: [
    {
      documentId: 'doc_1',
      title: 'Reglamento interno',
      version: 2,
      acceptedAt: '2025-11-02T12:30:00Z',
      outdated: false,
    },
  ],
};

const CUENTA = {
  memberId: 'mem_1',
  balanceCents: -1_200_000,
  overdueCents: 1_200_000,
  status: 'overdue',
  charges: [],
};

const NOTAS = [
  {
    publicId: 'not_1',
    text: 'Se recupera de una lesión de rodilla.',
    authorId: 'usr_1',
    createdAt: '2026-01-10T12:00:00Z',
  },
];

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

const error = (code: string, message: string, status: number) =>
  respuesta(
    { success: false, error: { code, message, requestId: 'req-test', timestamp: '2026-03-02' } },
    status,
  );

const SEDES = {
  items: [{ publicId: 'ven_1', name: 'Box Toro', timeZone: 'America/Argentina/Buenos_Aires' }],
};

/** Cada sección tiene su pedido: así es como puede fallar sola. */
const porDefecto = (url: string) => {
  if (url.includes('/overview')) return respuesta(FICHA);
  if (url.includes('/statement')) return respuesta(CUENTA);
  if (url.includes('/notes')) return respuesta(NOTAS);
  // Las fechas van en la zona del centro, no en la del navegador (§2.1.2).
  if (url.includes('/venues')) return respuesta(SEDES);

  return respuesta(SOCIO);
};

let fetchMock: ReturnType<typeof vi.fn>;

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemberFile memberId="mem_1" client={client} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn((url: string) => Promise.resolve(porDefecto(String(url))));
});

describe('lo que se ve al abrirla', () => {
  it('los datos del socio, sus packs, lo que viene y su asistencia', async () => {
    montar();

    expect(await screen.findByText('Micaela Sosa')).toBeDefined();
    expect(screen.getByText('Pack 8 clases')).toBeDefined();
    expect(await screen.findByText('Funcional')).toBeDefined();
    expect(screen.getByText('14 clases en los últimos 90 días')).toBeDefined();
  });

  it('🔴 dice hace cuánto no viene: es el dato que dispara la llamada', async () => {
    // "No viene hace 9 días" es accionable; "última visita: 21/02" hay que
    // calcularlo mentalmente con alguien esperando del otro lado.
    montar();

    expect(await screen.findByText('Hace 9 días que no viene.')).toBeDefined();
  });

  it('el waiver desactualizado se distingue del firmado al día', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/overview')
          ? respuesta({ ...FICHA, waivers: [{ ...FICHA.waivers[0], outdated: true }] })
          : porDefecto(String(url)),
      ),
    );
    montar();

    expect(await screen.findByText('Hay una versión más nueva')).toBeDefined();
  });
});

describe('🔴 la plata la ve quien puede (§2.1.12)', () => {
  it('con permiso, el estado de cuenta está a la vista', async () => {
    montar();

    // El saldo y lo vencido son el mismo número acá: los dos tienen que estar.
    expect(await screen.findAllByText(/12\.000/)).toHaveLength(2);
    expect(screen.getByText('Debe')).toBeDefined();
  });

  it('🔴 al coach la API le dice 403 y la sección no aparece', async () => {
    // No es que el front la esconda: no la recibió. Y no se le muestra un
    // error, porque no le falta nada — esa sección no es suya.
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/statement')
          ? error('LP-AUTH-403-002', 'No tenés permisos para esta acción.', 403)
          : porDefecto(String(url)),
      ),
    );
    montar();

    await screen.findByText('Micaela Sosa');
    expect(screen.queryByText('Estado de cuenta')).toBeNull();
    expect(screen.queryByText('No pudimos traer el estado de cuenta')).toBeNull();
  });

  it('las notas también son de quien tiene su permiso', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/notes')
          ? error('LP-AUTH-403-002', 'No tenés permisos para esta acción.', 403)
          : porDefecto(String(url)),
      ),
    );
    montar();

    await screen.findByText('Micaela Sosa');
    expect(screen.queryByText('Notas internas')).toBeNull();
  });
});

describe('🔴 cada sección falla sola', () => {
  it('si se cae cobranza, los packs se siguen viendo', async () => {
    // Una pantalla que se cae entera por una sección es una pantalla que el
    // mostrador no puede usar cuando más la necesita.
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/statement')
          ? error('LP-SYS-500-001', 'Ocurrió un error.', 500)
          : porDefecto(String(url)),
      ),
    );
    montar();

    expect(await screen.findByText('Pack 8 clases')).toBeDefined();
    expect(screen.getByText('No pudimos traer el estado de cuenta')).toBeDefined();
  });

  it('si se cae la ficha, los datos del socio siguen ahí', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/overview')
          ? error('LP-SYS-500-001', 'Ocurrió un error.', 500)
          : porDefecto(String(url)),
      ),
    );
    montar();

    expect(await screen.findByText('Micaela Sosa')).toBeDefined();
    expect(screen.getByText('No pudimos traer sus packs')).toBeDefined();
  });

  it('mientras carga, cada sección muestra su propio esqueleto', () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    montar();

    expect(screen.getByLabelText('Cargando los datos del socio')).toBeDefined();
    expect(screen.getByLabelText('Cargando sus packs')).toBeDefined();
  });
});

describe('los estados vacíos ofrecen qué hacer', () => {
  it('sin packs, propone venderle uno', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/overview')
          ? respuesta({ ...FICHA, contracts: [], upcomingBookings: [], waivers: [] })
          : porDefecto(String(url)),
      ),
    );
    montar();

    expect(await screen.findByText('Todavía no compró nada')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Venderle un pack' })).toBeDefined();
  });

  it('sin reservas próximas, lo dice sin dejar el hueco', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/overview')
          ? respuesta({ ...FICHA, upcomingBookings: [] })
          : porDefecto(String(url)),
      ),
    );
    montar();

    expect(await screen.findByText(/No tiene nada reservado/)).toBeDefined();
  });
});

describe('las notas internas', () => {
  it('se ven, y se aclara que son del staff', async () => {
    montar();

    expect(await screen.findByText('Se recupera de una lesión de rodilla.')).toBeDefined();
    await waitFor(() => expect(screen.getByText(/nunca las ve el socio/i)).toBeDefined());
  });
});
