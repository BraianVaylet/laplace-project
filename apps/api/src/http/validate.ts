import type { Context } from 'hono';
import type { ZodType, ZodIssue } from 'zod';
import { AppError } from './errors.js';

/**
 * Traduce los issues de Zod a un error de modulo. Devolver `undefined` deja que
 * caiga el generico.
 *
 * Existe porque el diccionario de errores promete codigos concretos: §5.0 dice
 * que la politica de reserva inconsistente responde `LP-SCHD-422-001`, no un
 * "payload invalido" que obliga a leer el detalle para entender que paso.
 */
export type IssueMapper = (issues: ZodIssue[]) => AppError | undefined;

export interface ValidateOptions {
  mapIssues?: IssueMapper | undefined;
}

/**
 * Valida el body con el schema de `@laplace/schemas` **antes** de que el handler
 * lo vea, y traduce el error de Zod al envelope de §5.0.
 *
 * Existe para que ningun handler tenga que acordarse: sin esto uno valida, otro
 * confia, y el que confia es el que rompe.
 */
export function validated<T, E extends { Variables: Record<string, unknown> }>(
  schema: ZodType<T>,
  handler: (c: Context<E>, input: T) => Promise<Response> | Response,
  options: ValidateOptions = {},
) {
  return async (c: Context<E>): Promise<Response> => {
    const raw: unknown = await c.req.json().catch(() => undefined);
    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
      const mapped = options.mapIssues?.(parsed.error.issues);
      if (mapped) throw mapped;

      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join(' · ');

      throw new AppError({
        code: 'LP-SYS-422-006',
        status: 422,
        // El mensaje dice QUE campo esta mal: "datos invalidos" a secas obliga
        // al usuario a adivinar cual de doce.
        message: `Revisá los datos: ${detail}`,
        meta: { issues: parsed.error.issues },
      });
    }

    return handler(c, parsed.data);
  };
}
