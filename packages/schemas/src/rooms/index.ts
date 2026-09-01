import { z } from 'zod';

/**
 * Fuente única de validación de Rooms, compartida front/back (ADR-003).
 *
 * La Room es el espacio físico con capacidad y equipamiento (§1.1). Es de donde
 * hereda la capacidad una clase. El límite del plan **no** la cuenta: cuenta
 * Venues activos.
 */

/**
 * Nombre de la sala que se crea sola con el Venue.
 *
 * §1.1: el 90% de los centros tiene una sola sala y nunca debería ver el
 * concepto. Vive acá para que el suscriptor de `venue.created` y la UI digan lo
 * mismo sin copiarse el string.
 */
export const DEFAULT_ROOM_NAME = 'Principal';

/** Los que nombra §2.1 más un `other` con etiqueta libre. */
export const EQUIPMENT_KINDS = ['rack', 'bike', 'rower', 'treadmill', 'mat', 'other'] as const;
export const equipmentKindSchema = z.enum(EQUIPMENT_KINDS);
export type EquipmentKind = z.infer<typeof equipmentKindSchema>;

export const equipmentSchema = z
  .object({
    kind: equipmentKindSchema,
    /** Obligatoria para `other`: sin etiqueta nadie sabría qué se reservó. */
    label: z.string().trim().min(2).max(40).optional(),
    quantity: z.number().int().min(1).max(500),
  })
  .refine((item) => item.kind !== 'other' || item.label !== undefined, {
    message: 'Poné un nombre para el equipamiento.',
    path: ['label'],
  });

export type Equipment = z.infer<typeof equipmentSchema>;

/** Identifica una entrada de equipamiento: el tipo, o el tipo + la etiqueta si es `other`. */
const equipmentKey = (item: Equipment) =>
  item.kind === 'other' ? `other:${item.label}` : item.kind;

/**
 * El equipamiento es un inventario, no una bitácora: cada tipo aparece una vez
 * con su cantidad. Repetirlo haría que "8 racks" y "2 racks" convivan sin que
 * nadie sepa cuántos hay.
 */
const equipmentListSchema = z
  .array(equipmentSchema)
  .max(20)
  .default([])
  .refine((items) => new Set(items.map(equipmentKey)).size === items.length, {
    message: 'Hay equipamiento repetido. Sumá las cantidades en una sola línea.',
  });

export const ROOM_STATES = ['active', 'archived'] as const;
export const roomStatusSchema = z.enum(ROOM_STATES);
export type RoomStatus = z.infer<typeof roomStatusSchema>;

export const createRoomSchema = z.object({
  /** `publicId` del Venue. Una sala sin sede no existe en el modelo (§1.1). */
  venueId: z.string().min(1, 'Elegí la sede de la sala.'),
  name: z.string().trim().min(2, 'El nombre tiene que tener al menos 2 caracteres.').max(60),
  /** Cupo máximo. Es el que hereda la clase, con override por sesión (§2.1.5.b). */
  capacity: z
    .number()
    .int('La capacidad se mide en personas enteras.')
    .min(1, 'La sala tiene que admitir al menos 1 persona.')
    .max(500, 'Revisá la capacidad: ¿tantas personas entran?'),
  equipment: equipmentListSchema,
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

/**
 * La sede **no** se edita: mover una sala de Venue dejaría sesiones pasadas
 * apuntando a una sede donde nunca ocurrieron.
 */
export const updateRoomSchema = createRoomSchema.omit({ venueId: true }).partial();
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

export const roomSchema = z.object({
  publicId: z.string(),
  venueId: z.string(),
  name: z.string(),
  capacity: z.number().int(),
  equipment: z.array(equipmentSchema),
  status: roomStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Room = z.infer<typeof roomSchema>;
