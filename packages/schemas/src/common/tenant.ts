import { z } from 'zod';

/**
 * El tenant es la Organization. Ver docs/adr/000-tenancy.md.
 * El tenantId JAMAS se acepta desde el body ni la query: se resuelve desde la
 * sesion. Este schema existe para el contexto interno, no para el borde HTTP.
 */
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ObjectId invalido');

export const tenantContextSchema = z.object({
  tenantId: objectIdSchema,
  venueId: objectIdSchema.optional(),
  userId: objectIdSchema,
  requestId: z.string().min(1),
});

export type TenantContext = z.infer<typeof tenantContextSchema>;
