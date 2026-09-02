import { randomBytes } from 'node:crypto';

/**
 * Identificadores publicos con prefijo legible (spec §5.2.1). El `_id` de Mongo
 * sigue siendo el interno; esto es lo que ve el usuario y lo que le dicta a
 * soporte por telefono.
 */
export const ID_PREFIXES = {
  organization: 'org',
  venue: 'ven',
  room: 'rom',
  member: 'mem',
  memberNote: 'mnt',
  product: 'prd',
  contract: 'ctr',
  charge: 'chg',
  payment: 'pay',
  refund: 'ref',
  classTemplate: 'tpl',
  classSession: 'ses',
  booking: 'bkg',
  exercise: 'exr',
  planning: 'pln',
  result: 'rsl',
  notification: 'ntf',
  lead: 'led',
  legalDocument: 'doc',
} as const;

export type IdEntity = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdEntity];

/**
 * Alfabeto de Crockford en minuscula: sin `i`, `l`, `o` ni `u`. Un socio le
 * dicta el ID a la recepcionista por telefono; `l` y `1` no pueden ser el mismo
 * problema dos veces.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const LENGTH = 20;

const PUBLIC_ID_PATTERN = new RegExp(`^(${Object.values(ID_PREFIXES).join('|')})_[${ALPHABET}]+$`);

export function publicId(entity: IdEntity): string {
  const bytes = randomBytes(LENGTH);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];

  return `${ID_PREFIXES[entity]}_${out}`;
}

export function isPublicId(value: string): boolean {
  return PUBLIC_ID_PATTERN.test(value);
}

export function prefixOf(value: string): IdPrefix | null {
  if (!isPublicId(value)) return null;
  return value.slice(0, value.indexOf('_')) as IdPrefix;
}
