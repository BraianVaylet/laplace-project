import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import type {
  AccountStatement,
  MemberNoteResponse,
  MemberOverview,
  MemberResponse,
  Venue,
} from '@laplace/schemas';
import {
  ApiRequestError,
  formatDate,
  formatDateTime,
  type ApiClient,
  type VenueTime,
} from '@laplace/client';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '@laplace/ui';
import { api } from './api.js';

/**
 * La ficha 360 del socio (§2.1.7).
 *
 * Es la pantalla más usada del DFSM, y la abre alguien que tiene a una persona
 * enfrente esperando. De ahí las dos decisiones de acá:
 *
 * 1. **Cada sección es su propio pedido.** Si se cae cobranza, el mostrador
 *    sigue viendo los packs; una pantalla que se cae entera por una sección es
 *    una pantalla que no se puede usar justo cuando más hace falta.
 * 2. 🔴 **Lo que no es del rol no aparece, y tampoco llegó.** La plata y las
 *    notas las corta la API con su propio permiso (§2.1.12). Un 403 en una
 *    sección no es un error que mostrar: es que esa sección no es suya.
 */
export interface MemberFileProps {
  memberId: string;
  client?: ApiClient;
}

export function MemberFile({ memberId, client = api }: MemberFileProps) {
  const socio = useQuery({
    queryKey: ['member', memberId],
    queryFn: () => client.get<MemberResponse>(`/members/${memberId}`),
  });

  const ficha = useQuery({
    queryKey: ['member', memberId, 'overview'],
    queryFn: () => client.get<MemberOverview>(`/members/${memberId}/overview`),
  });

  const cuenta = useQuery({
    queryKey: ['member', memberId, 'statement'],
    queryFn: () => client.get<AccountStatement>(`/members/${memberId}/statement`),
    retry: false,
  });

  const notas = useQuery({
    queryKey: ['member', memberId, 'notes'],
    queryFn: () => client.get<MemberNoteResponse[]>(`/members/${memberId}/notes`),
    retry: false,
  });

  /*
   * Las fechas van en la zona del **centro**, no en la del navegador (§2.1.2).
   * Quien atiende desde su casa a las 23:00 tiene que ver la misma hora que
   * está pegada en la puerta del box.
   */
  const sedes = useQuery({
    queryKey: ['venues'],
    queryFn: () => client.get<{ items: Venue[] }>('/venues'),
  });

  const sede = (sedes.data?.items ?? []).find((venue) =>
    socio.data?.venueIds.includes(venue.publicId),
  );
  const zona: VenueTime = { timeZone: sede?.timeZone ?? 'America/Argentina/Buenos_Aires' };

  return (
    <div className="flex flex-col gap-6">
      <Seccion
        query={socio}
        titulo="Datos del socio"
        cargando="Cargando los datos del socio"
        error="No pudimos traer sus datos"
      >
        {(datos) => <Identidad socio={datos} zona={zona} />}
      </Seccion>

      {/*
        La plata va arriba de los packs: quien atiende necesita saber si puede
        cobrarle antes de venderle otra cosa.
      */}
      <Seccion
        query={cuenta}
        titulo="Estado de cuenta"
        cargando="Cargando el estado de cuenta"
        error="No pudimos traer el estado de cuenta"
      >
        {(estado) => <Cuenta estado={estado} />}
      </Seccion>

      <Seccion
        query={ficha}
        titulo="Sus packs"
        cargando="Cargando sus packs"
        error="No pudimos traer sus packs"
      >
        {(datos) => <Packs ficha={datos} />}
      </Seccion>

      <Seccion
        query={ficha}
        titulo="Lo que viene"
        cargando="Cargando sus reservas"
        error="No pudimos traer sus reservas"
      >
        {(datos) => <Proximas ficha={datos} zona={zona} />}
      </Seccion>

      <Seccion
        query={ficha}
        titulo="Asistencia"
        cargando="Cargando su asistencia"
        error="No pudimos traer su asistencia"
      >
        {(datos) => <Asistencia ficha={datos} />}
      </Seccion>

      <Seccion
        query={ficha}
        titulo="Firmas"
        cargando="Cargando sus firmas"
        error="No pudimos traer sus firmas"
      >
        {(datos) => <Firmas ficha={datos} zona={zona} />}
      </Seccion>

      <Seccion
        query={notas}
        titulo="Notas internas"
        cargando="Cargando las notas"
        error="No pudimos traer las notas"
      >
        {(lista) => <Notas notas={lista} zona={zona} />}
      </Seccion>
    </div>
  );
}

/**
 * Una sección con sus tres estados propios.
 *
 * 🔴 El 403 no pinta nada: no es un error del usuario, es que ese dato no es
 * suyo. Mostrarle "no tenés permiso" en su pantalla de todos los días sería
 * decirle siete veces por día que hay cosas que no puede ver.
 */
function Seccion<T>({
  query,
  titulo,
  cargando,
  error,
  children,
}: {
  query: UseQueryResult<T>;
  titulo: string;
  cargando: string;
  error: string;
  children: (datos: T) => ReactNode;
}) {
  if (query.isPending) return <Skeleton className="h-28" label={cargando} />;

  if (query.isError) {
    if (query.error instanceof ApiRequestError && query.error.status === 403) return null;

    return (
      <ErrorState
        title={error}
        message={mensajeDe(query.error)}
        onRetry={() => void query.refetch()}
        {...accionDe(query.error)}
      />
    );
  }

  return <Card title={titulo}>{children(query.data)}</Card>;
}

function Identidad({ socio, zona }: { socio: MemberResponse; zona: VenueTime }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-fg text-xl font-semibold">
          {socio.firstName} {socio.lastName}
        </h1>
        <Badge tone={socio.status === 'active' ? 'success' : 'neutral'}>
          {ESTADOS[socio.status] ?? socio.status}
        </Badge>
        {socio.flags.suspended ? <Badge tone="danger">Suspendido</Badge> : null}
      </div>

      <dl className="text-fg-muted grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {socio.phone ? <Dato termino="Teléfono" valor={socio.phone} /> : null}
        {socio.email ? <Dato termino="Email" valor={socio.email} /> : null}
        <Dato termino="Socio desde" valor={fecha(socio.joinedAt, zona)} />
        {socio.tags.length > 0 ? <Dato termino="Etiquetas" valor={socio.tags.join(', ')} /> : null}
      </dl>
    </div>
  );
}

function Cuenta({ estado }: { estado: AccountStatement }) {
  const debe = estado.balanceCents < 0;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <p className="text-fg text-2xl font-semibold">{pesos(Math.abs(estado.balanceCents))}</p>
      <Badge tone={debe ? 'danger' : 'success'}>{debe ? 'Debe' : 'Al día'}</Badge>
      {estado.overdueCents > 0 ? (
        <p className="text-fg-muted text-sm">{pesos(estado.overdueCents)} vencidos.</p>
      ) : null}
    </div>
  );
}

function Packs({ ficha }: { ficha: MemberOverview }) {
  if (ficha.contracts.length === 0) {
    return (
      <EmptyState
        title="Todavía no compró nada"
        description="Sin un pack o una membresía no puede reservar."
        action={<Button>Venderle un pack</Button>}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {ficha.contracts.map((contrato) => (
        <li key={contrato.contractId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-fg text-sm font-medium">{contrato.productName}</span>
          <Badge tone={contrato.status === 'active' ? 'success' : 'neutral'}>
            {ESTADOS_CONTRATO[contrato.status] ?? contrato.status}
          </Badge>
          <span className="text-fg-muted text-sm">{creditosDe(contrato)}</span>
          <span className="text-fg-muted text-sm">{vencimientoDe(contrato)}</span>
        </li>
      ))}
    </ul>
  );
}

function Proximas({ ficha, zona }: { ficha: MemberOverview; zona: VenueTime }) {
  if (ficha.upcomingBookings.length === 0) {
    return (
      <p className="text-fg-muted text-sm">
        No tiene nada reservado. Puede anotarse desde la app o desde el mostrador.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {ficha.upcomingBookings.map((reserva) => (
        <li key={reserva.bookingId} className="flex flex-wrap items-center gap-3">
          <span className="text-fg text-sm font-medium">{reserva.className}</span>
          <span className="text-fg-muted text-sm">{fechaYHora(reserva.startAt, zona)}</span>
          {reserva.status === 'waitlisted' ? <Badge tone="warning">En espera</Badge> : null}
        </li>
      ))}
    </ul>
  );
}

function Asistencia({ ficha }: { ficha: MemberOverview }) {
  const { attended, noShows, windowDays, daysSinceLastVisit } = ficha.attendance;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-fg text-sm">
        {attended} {attended === 1 ? 'clase' : 'clases'} en los últimos {windowDays} días
      </p>
      {noShows > 0 ? (
        <p className="text-fg-muted text-sm">
          {noShows} {noShows === 1 ? 'ausencia' : 'ausencias'} sin avisar.
        </p>
      ) : null}
      {/*
        "Hace 9 días que no viene" es accionable. "Última visita: 21/02" hay que
        calcularlo mentalmente, con alguien esperando del otro lado.
      */}
      <p className="text-fg-muted text-sm">{ausenciaDe(daysSinceLastVisit)}</p>
    </div>
  );
}

function Firmas({ ficha, zona }: { ficha: MemberOverview; zona: VenueTime }) {
  if (ficha.waivers.length === 0) {
    return <p className="text-fg-muted text-sm">No firmó ningún documento todavía.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {ficha.waivers.map((firma) => (
        <li key={firma.documentId} className="flex flex-wrap items-center gap-3">
          <span className="text-fg text-sm font-medium">{firma.title}</span>
          <span className="text-fg-muted text-sm">
            v{firma.version} · {fecha(firma.acceptedAt, zona)}
          </span>
          {/*
            "Firmó el reglamento" y "firmó ESTE reglamento" son cosas distintas,
            y la diferencia es la que importa el día que alguien reclama.
          */}
          {firma.outdated ? <Badge tone="warning">Hay una versión más nueva</Badge> : null}
        </li>
      ))}
    </ul>
  );
}

function Notas({ notas, zona }: { notas: MemberNoteResponse[]; zona: VenueTime }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-fg-muted text-sm">Son del staff: nunca las ve el socio.</p>

      {notas.length === 0 ? (
        <p className="text-fg-muted text-sm">Todavía no hay ninguna.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notas.map((nota) => (
            <li key={nota.publicId} className="flex flex-col">
              <span className="text-fg text-sm">{nota.text}</span>
              <span className="text-fg-muted text-xs">{fecha(nota.createdAt, zona)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Dato({ termino, valor }: { termino: string; valor: string }) {
  return (
    <div className="flex gap-2">
      <dt className="font-medium">{termino}:</dt>
      <dd>{valor}</dd>
    </div>
  );
}

const ESTADOS: Record<string, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
  suspended: 'Suspendido',
  archived: 'Archivado',
};

const ESTADOS_CONTRATO: Record<string, string> = {
  active: 'Activo',
  frozen: 'Congelado',
  expired: 'Vencido',
  exhausted: 'Sin clases',
  cancelled: 'Cancelado',
  pending_payment: 'Falta pagarlo',
};

function creditosDe(contrato: MemberOverview['contracts'][number]): string {
  if (contrato.creditsLeft === null) return 'Membresía: sin tope de clases.';
  if (contrato.creditsLeft === 0) return 'Sin clases disponibles.';

  return `${contrato.creditsLeft} de ${contrato.creditsTotal ?? contrato.creditsLeft} clases.`;
}

function vencimientoDe(contrato: MemberOverview['contracts'][number]): string {
  if (contrato.daysLeft === null) return 'No vence.';
  if (contrato.daysLeft < 0) return 'Ya venció.';
  if (contrato.daysLeft === 0) return 'Vence hoy.';

  return `Vence en ${contrato.daysLeft} ${contrato.daysLeft === 1 ? 'día' : 'días'}.`;
}

function ausenciaDe(dias: number | null): string {
  if (dias === null) return 'Todavía no vino a ninguna clase.';
  if (dias === 0) return 'Vino hoy.';

  return `Hace ${dias} ${dias === 1 ? 'día' : 'días'} que no viene.`;
}

/** Centavos enteros a pesos. El dinero nunca es float (§3.1). */
function pesos(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

const fecha = (iso: string, zona: VenueTime) => formatDate(Temporal.Instant.from(iso), zona);

const fechaYHora = (iso: string, zona: VenueTime) =>
  formatDateTime(Temporal.Instant.from(iso), zona);

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}

function accionDe(error: unknown) {
  return error instanceof ApiRequestError && error.action ? { action: error.action } : {};
}
