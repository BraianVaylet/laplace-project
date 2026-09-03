import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelo de Mongoose de Member. **Solo lo usa el repositorio** (ADR-000 regla 1).
 *
 * Los indices viven en la migracion (F0-10), no aca: `{ tenantId, status,
 * lastAttendanceAt }` y el unico PARCIAL `{ tenantId, docId }`. Declararlos en
 * los dos lados es la forma mas facil de que se desincronicen.
 */
export interface MemberNoteDoc {
  publicId: string;
  text: string;
  authorId: string;
  createdAt: Date;
}

export interface MemberDoc extends Record<string, unknown> {
  venueIds: string[];
  /** Cuenta de la WAFM, cuando el socio la vincula con un codigo (F1-04). */
  userId?: string;
  firstName: string;
  lastName: string;
  docId?: string;
  phone?: string;
  email?: string;
  birthDate?: string;
  emergencyContact?: { fullName: string; phone: string; relationship?: string };
  guardian?: { fullName: string; phone: string; relationship?: string };
  status: string;
  flags: { debtor: boolean; suspended: boolean };
  tags: string[];
  balanceCents: number;
  joinedAt: Date;
  lastAttendanceAt?: Date | null;
  /**
   * Faltas acumuladas (§2.1.5.d). Es un contador de la ficha, no la fuente de
   * verdad de la penalizacion: el umbral se cuenta sobre las reservas en
   * `no_show` de la ventana movil, que no se puede desincronizar.
   */
  noShowCount: number;
  /** Hasta cuando no puede reservar por faltas. `null` si no esta penalizado. */
  bookingBlockedUntil?: Date | null;
  /** Notas internas del staff. NUNCA salen en la respuesta del miembro (§2.1.7). */
  notes: MemberNoteDoc[];
}

const contact = {
  _id: false,
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  relationship: { type: String, required: false },
};

const memberSchema = new Schema<MemberDoc>(
  {
    venueIds: { type: [String], required: true },
    userId: { type: String, required: false },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    docId: { type: String, required: false },
    phone: { type: String, required: false },
    email: { type: String, required: false },
    birthDate: { type: String, required: false },
    emergencyContact: { type: contact, required: false },
    guardian: { type: contact, required: false },
    status: { type: String, required: true, default: 'lead' },
    flags: {
      _id: false,
      debtor: { type: Boolean, required: true, default: false },
      suspended: { type: Boolean, required: true, default: false },
    },
    tags: { type: [String], required: true, default: [] },
    /** Centavos enteros, nunca float (§3.1). Negativo = debe. */
    balanceCents: { type: Number, required: true, default: 0 },
    joinedAt: { type: Date, required: true },
    lastAttendanceAt: { type: Date, required: false, default: null },
    noShowCount: { type: Number, required: true, default: 0 },
    bookingBlockedUntil: { type: Date, required: false, default: null },
    notes: [
      {
        _id: false,
        publicId: { type: String, required: true },
        text: { type: String, required: true },
        authorId: { type: String, required: true },
        createdAt: { type: Date, required: true },
      },
    ],
  },
  { collection: COLLECTIONS.member },
);

memberSchema.plugin(tenantPlugin);
memberSchema.plugin(baseFieldsPlugin);

/** El modelo se registra una sola vez: en los tests el modulo se importa varias. */
export const MemberModel: Model<MemberDoc> =
  (mongoose.models[COLLECTIONS.member] as Model<MemberDoc> | undefined) ??
  mongoose.model<MemberDoc>(COLLECTIONS.member, memberSchema);
