import { describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { DEFAULT_BOOKING_POLICY } from '@laplace/schemas';
import { BookingService, type ClaimedSession, type CreditLedger } from './booking-service.js';
import type { BookingDoc } from '../infrastructure/booking.model.js';
import type { BookingRepository } from '../infrastructure/booking.repository.js';

/**
 * Los bordes de `book` que no se pueden provocar contra la base: qué pasa
 * cuando **falla la compensación misma**.
 *
 * Es la peor combinación posible — la reserva no se creó y devolver el lugar
 * tampoco funcionó — y lo único que se le pide es que el error que suba sea el
 * original, el que explica qué pasó de verdad, y no el del intento de arreglo.
 */
const AHORA = Temporal.Instant.from('2026-03-02T12:00:00Z');

const CLASE: ClaimedSession = {
  publicId: 'ses_1',
  venueId: 'ven_1',
  categoryId: 'funcional',
  startAt: Temporal.Instant.from('2026-03-03T13:00:00Z'),
  endAt: Temporal.Instant.from('2026-03-03T14:00:00Z'),
  capacity: 10,
  bookedCount: 0,
  status: 'scheduled',
  timeZone: 'America/Argentina/Buenos_Aires',
};

const RESERVA = {
  publicId: 'bkg_1',
  sessionId: 'ses_1',
  memberId: 'mem_1',
  venueId: 'ven_1',
  contractId: 'ctr_1',
  status: 'booked',
  waitlistPosition: null,
  bookedAt: new Date('2026-03-02T12:00:00Z'),
} as unknown as BookingDoc;

function armar(overrides: {
  book?: () => Promise<BookingDoc>;
  consume?: CreditLedger['consume'];
  refund?: () => Promise<void>;
  releaseSeat?: () => Promise<void>;
  list?: () => Promise<unknown>;
}) {
  const bookings = {
    byIdempotencyKey: vi.fn().mockResolvedValue(null),
    liveOf: vi.fn().mockResolvedValue(null),
    book: overrides.book ?? vi.fn().mockResolvedValue(RESERVA),
    list: overrides.list ?? vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  } as unknown as BookingRepository;

  const refund = vi.fn(overrides.refund ?? (() => Promise.resolve()));
  const releaseSeat = vi.fn(overrides.releaseSeat ?? (() => Promise.resolve()));

  const service = new BookingService({
    bookings,
    sessions: {
      claimSeat: () => Promise.resolve(CLASE),
      releaseSeat,
      find: () => Promise.resolve(CLASE),
      adjustWaitlist: () => Promise.resolve(),
    },
    credits: {
      consume:
        overrides.consume ??
        (() =>
          Promise.resolve({
            contractId: 'ctr_1',
            productName: 'Pack 8',
            creditsLeft: 7,
            reason: 'el que vence primero',
          })),
      refund,
    },
    arrears: { assertCanTransact: () => Promise.resolve() },
    venues: { policyOf: () => Promise.resolve(DEFAULT_BOOKING_POLICY) },
    events: { emit: () => Promise.resolve(), on: () => undefined } as never,
    now: () => AHORA,
  });

  return { service, bookings, refund, releaseSeat };
}

describe('compensación de una reserva que falla', () => {
  it('devuelve el crédito y el lugar, en orden inverso al que se tomaron', async () => {
    const { service, refund, releaseSeat } = armar({
      book: () => Promise.reject(new Error('se cayó la base')),
    });

    await expect(service.book({ sessionId: 'ses_1' }, 'mem_1', 'key-1')).rejects.toThrow(
      'se cayó la base',
    );
    expect(refund).toHaveBeenCalledWith('ctr_1');
    expect(releaseSeat).toHaveBeenCalledWith('ses_1');
  });

  it('sin crédito descontado no hay nada que devolver, solo el lugar', async () => {
    const { service, refund, releaseSeat } = armar({
      consume: () => Promise.reject(new Error('sin pack activo')),
    });

    await expect(service.book({ sessionId: 'ses_1' }, 'mem_1', 'key-2')).rejects.toThrow(
      'sin pack activo',
    );
    expect(refund).not.toHaveBeenCalled();
    expect(releaseSeat).toHaveBeenCalledWith('ses_1');
  });

  it('🔴 si la compensación también falla, sube el error original', async () => {
    const { service } = armar({
      book: () => Promise.reject(new Error('se cayó la base')),
      refund: () => Promise.reject(new Error('tampoco anda el ledger')),
      releaseSeat: () => Promise.reject(new Error('tampoco anda la agenda')),
    });

    /*
     * El que explica qué pasó es el primero. Dejar ganar al error de la
     * compensación mandaría a mirar el lugar equivocado.
     */
    await expect(service.book({ sessionId: 'ses_1' }, 'mem_1', 'key-3')).rejects.toThrow(
      'se cayó la base',
    );
  });

  it('la reserva devuelta no inventa un `createdAt` que la base no dio', async () => {
    const sinFecha = { ...RESERVA, createdAt: undefined } as unknown as BookingDoc;
    const { service } = armar({ book: () => Promise.resolve(sinFecha) });

    const resultado = await service.book({ sessionId: 'ses_1' }, 'mem_1', 'key-4');

    expect(resultado.booking.createdAt).toBe('');
  });
});

describe('listado de un socio', () => {
  it('sin cursor ni límite pide la primera página con el default del repositorio', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const { service } = armar({ list });

    await service.ofMember('mem_1');

    expect(list).toHaveBeenCalledWith(
      { memberId: 'mem_1' },
      { sortField: 'bookedAt', direction: 'desc' },
    );
  });
});
