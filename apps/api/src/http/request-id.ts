import { randomUUID } from 'node:crypto';
import { createMiddleware } from 'hono/factory';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * El requestId viaja del front al back y vuelve al usuario en el mensaje de
 * error, para que pueda reportarlo. Spec §11.1.
 */
export const requestId = createMiddleware<{ Variables: { requestId: string } }>(async (c, next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const id = incoming && incoming.length > 0 ? incoming : randomUUID();
  c.set('requestId', id);
  c.header(REQUEST_ID_HEADER, id);
  await next();
});
