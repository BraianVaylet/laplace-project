/**
 * Migraciones versionadas y reversibles. Spec §6: nunca cambios manuales en Atlas.
 * Uso: pnpm exec migrate-mongo create <nombre> | up | down | status
 */
module.exports = {
  mongodb: {
    url: process.env.MONGODB_URI,
    databaseName: process.env.MONGODB_DB_NAME,
    options: {},
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  lockCollectionName: 'changelog_lock',
  lockTtl: 0,
  migrationFileExtension: '.cjs',
  useFileHash: false,
  moduleSystem: 'commonjs',
};
