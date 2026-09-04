import type { MemberNoteResponse, MemberResponse, MemberStatus } from '@laplace/schemas';
import { fromBsonDate } from '../../../persistence/bson-date.js';
import type { MemberDoc, MemberNoteDoc } from './member.model.js';

/**
 * Lo que sale por la API.
 *
 * Es una **lista blanca**, no un `delete doc.notes`: un campo sensible que se
 * agregue mañana al documento no se filtra por olvido. Las notas internas del
 * staff nunca salen por acá (§2.1.7); tienen su propio endpoint y su propio
 * permiso.
 */
export function toMemberResponse(doc: MemberDoc): MemberResponse {
  return {
    publicId: String(doc['publicId']),
    venueIds: doc.venueIds,
    firstName: doc.firstName,
    lastName: doc.lastName,
    ...(doc.docId === undefined ? {} : { docId: doc.docId }),
    ...(doc.phone === undefined ? {} : { phone: doc.phone }),
    ...(doc.email === undefined ? {} : { email: doc.email }),
    ...(doc.birthDate === undefined ? {} : { birthDate: doc.birthDate }),
    ...(doc.emergencyContact === undefined ? {} : { emergencyContact: doc.emergencyContact }),
    ...(doc.guardian === undefined ? {} : { guardian: doc.guardian }),
    status: doc.status as MemberStatus,
    flags: doc.flags,
    tags: doc.tags,
    balanceCents: doc.balanceCents,
    joinedAt: isoOf(doc.joinedAt) ?? '',
    lastAttendanceAt: isoOf(doc.lastAttendanceAt),
    // El mostrador tiene que poder explicar por qué alguien no puede reservar.
    noShowCount: doc.noShowCount ?? 0,
    bookingBlockedUntil: isoOf(doc.bookingBlockedUntil),
    createdAt: isoOf(doc['createdAt']) ?? '',
    updatedAt: isoOf(doc['updatedAt']) ?? '',
  };
}

export function toNoteResponse(note: MemberNoteDoc): MemberNoteResponse {
  return {
    publicId: note.publicId,
    text: note.text,
    authorId: note.authorId,
    createdAt: isoOf(note.createdAt) ?? '',
  };
}

/** El driver devuelve `Date`; la API habla ISO 8601. */
function isoOf(value: unknown): string | null {
  if (value instanceof Date) return fromBsonDate(value).toString();
  if (typeof value === 'string') return value;

  return null;
}
