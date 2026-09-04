import { z } from 'zod';

/**
 * El formulario de contacto de la landing (§5.1.4), compartido front/back
 * (ADR-003): el navegador valida con el mismo schema con el que el servidor
 * rechaza, así nadie ve un error que el otro lado no explicó.
 *
 * 🔴 **Esto no es el `Lead` de §5.2.2.** Aquel es el prospecto de *un centro*
 * — alguien que quiere anotarse en el gimnasio — y por eso lleva `tenantId`.
 * Esto es un prospecto **de Laplace**: alguien que todavía no tiene centro, y
 * que por definición no puede tener `tenantId`. Son dos cosas distintas con el
 * mismo nombre en castellano.
 */
export const CONTACT_SOURCES = ['landing', 'referral', 'other'] as const;
export const contactSourceSchema = z.enum(CONTACT_SOURCES);

export const contactRequestSchema = z.object({
  name: z.string().trim().min(2, 'Poné tu nombre.').max(80),
  email: z.string().trim().toLowerCase().email('Revisá el mail.'),
  /** Opcional: pedir el teléfono de entrada espanta a la mitad de la gente. */
  phone: z.string().trim().max(30).optional(),
  centerName: z.string().trim().max(80).optional(),
  message: z.string().trim().min(10, 'Contanos algo más.').max(1000),
  source: contactSourceSchema.default('landing'),
  /**
   * 🔴 Trampa para bots: un campo que el navegador esconde y una persona nunca
   * completa. Si viene con algo, el pedido es de un robot.
   *
   * Se prefiere a un captcha porque el captcha se lo cobra al humano: hacerle
   * resolver un rompecabezas para escribirnos es la forma más segura de que no
   * escriba.
   */
  website: z.string().max(200).optional(),
});

export type ContactRequestInput = z.infer<typeof contactRequestSchema>;

/**
 * Lo que devuelve el alta. **No devuelve el pedido**: quien lo mandó ya sabe
 * lo que escribió, y responder con el contenido sería darle a un bot una forma
 * barata de confirmar que entró.
 */
export const contactRequestResultSchema = z.object({ received: z.literal(true) });

export type ContactRequestResult = z.infer<typeof contactRequestResultSchema>;
