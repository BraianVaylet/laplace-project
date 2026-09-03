/**
 * Nombres canonicos de coleccion. Existen para que los modelos de Mongoose y
 * las migraciones no se desincronicen: un indice creado sobre `classsessions`
 * mientras el modelo escribe en `class_sessions` no protege nada y no se nota
 * hasta que la coleccion crece.
 *
 * Mongoose pluraliza solo y a veces mal, asi que cada modelo declara su nombre
 * a partir de aca.
 */
export const COLLECTIONS = {
  venue: 'venues',
  room: 'rooms',
  member: 'members',
  inviteCode: 'inviteCodes',
  product: 'products',
  contract: 'contracts',
  charge: 'charges',
  payment: 'payments',
  refund: 'refunds',
  classTemplate: 'classTemplates',
  classSession: 'classSessions',
  venueClosure: 'venueClosures',
  booking: 'bookings',
  checkInToken: 'checkInTokens',
  exercise: 'exercises',
  planning: 'plannings',
  result: 'results',
  rmRecord: 'rmRecords',
  legalDocument: 'legalDocuments',
  consent: 'consents',
  notification: 'notifications',
  notificationTemplate: 'notificationTemplates',
  notificationPreference: 'notificationPreferences',
  lead: 'leads',
  auditLog: 'auditLogs',
  metricsDaily: 'metricsDaily',
  // Infraestructura
  loginAttempt: 'loginAttempt',
  jobLock: 'jobLock',
  jobRun: 'jobRun',
} as const;

export type CollectionKey = keyof typeof COLLECTIONS;
export type CollectionName = (typeof COLLECTIONS)[CollectionKey];
