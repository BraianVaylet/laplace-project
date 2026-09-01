# Runbook — staging, backups y restauración

Procedimientos de infraestructura de la spec §6. Ambientes: `dev` (local) · `staging` (datos
sintéticos) · `prod`. **Prohibido probar en prod.**

## 1. Servicios

Cinco servicios por ambiente, uno por app. Cada uno lee su `railway.json`:

| Servicio          | Config                      | Health check | Notas                        |
| ----------------- | --------------------------- | ------------ | ---------------------------- |
| `laplace-api`     | `apps/api/railway.json`     | `/ready`     | Verifica la conexión a Mongo |
| `laplace-dfsa`    | `apps/dfsa/railway.json`    | `/`          | Solo super admin             |
| `laplace-dfsm`    | `apps/dfsm/railway.json`    | `/`          | Suscriptores y staff         |
| `laplace-wafm`    | `apps/wafm/railway.json`    | `/`          | PWA de los socios            |
| `laplace-landing` | `apps/landing/railway.json` | `/`          | Estáticos prerenderizados    |

El health check de la API apunta a `/ready` y no a `/health` a propósito: `/health` responde 200
mientras el proceso viva, aunque Mongo esté caído. Un servicio que responde pero no puede leer nada
no está listo para recibir tráfico.

## 2. Variables de entorno

Viven en Railway, **nunca en el repo**. La lista completa está en `.env.example`; las que no pueden
faltar porque la API no arranca sin ellas:

```
MONGODB_URI            # Atlas, con replica set
MONGODB_DB_NAME
BETTER_AUTH_SECRET     # openssl rand -base64 32
BETTER_AUTH_URL
CORS_ORIGINS           # los dominios de las 4 apps, sin comodines
APP_ENV                # staging | prod
JOBS_ENABLED           # false en las réplicas que no deban correr jobs
```

`loadEnv()` valida todas al arrancar y falla con la lista de las que faltan. Es deliberado: es
preferible que el deploy no levante a que levante y explote a las 3 AM con un `undefined`.

### Rotación de secretos

1. Generar el nuevo valor y cargarlo en Railway como variable nueva (`BETTER_AUTH_SECRET_NEXT`).
2. Desplegar leyendo las dos, aceptando ambas firmas.
3. Cuando no queden sesiones firmadas con la vieja (máx. el TTL de sesión), quitar la anterior.

Rotar `BETTER_AUTH_SECRET` de golpe invalida todas las sesiones activas: en un centro, a las 7 de
la mañana, eso son cuarenta personas que no pueden hacer check-in.

## 3. MongoDB Atlas

- 🔴 **Replica set obligatorio.** Las transacciones que usa la cancelación de clase —cancelar las
  reservas y devolver los créditos en una sola operación— no existen sin él (ADR-001, §5.2.4). Un
  cluster standalone hace fallar esos flujos en runtime, no en el build.
- Backups automáticos con **PITR** habilitado.
- Alertas de conexión y de storage.
- **Región:** documentar cuál es. §9.2 (Ley 25.326, Art. 12) restringe la transferencia
  internacional a países con nivel adecuado de protección; hay que poder decir dónde están los datos.

### Migraciones

```bash
pnpm exec migrate-mongo up
```

Se corren **antes** del deploy de la API, no desde el arranque del proceso: si dos instancias
levantan a la vez, dos corren las migraciones. Nunca cambios manuales en Atlas (§6).

## 4. Backup y restauración

**Objetivos:** RPO ≤ 24 h · RTO ≤ 4 h.

> Un backup sin restore probado no es un backup. Es un archivo del que nadie sabe nada.

### Procedimiento de verificación (al menos una vez, y después de cada cambio de esquema grande)

1. Elegir el snapshot más reciente en Atlas.
2. Restaurarlo a un **cluster nuevo y aparte**, nunca encima de staging ni de prod.
3. Contar documentos por colección y comparar contra el origen:

   ```js
   // En mongosh, contra el cluster restaurado
   db.getCollectionNames().forEach((name) => print(name, db[name].countDocuments()));
   ```

4. Verificar los índices críticos, que son los que sostienen la integridad:

   ```js
   db.bookings.getIndexes(); // tenant_session_member_unique
   db.payments.getIndexes(); // tenant_idempotency_unique
   ```

5. Levantar la API apuntando al cluster restaurado y comprobar que `/ready` responde 200.
6. Anotar en `docs/BITACORA.md`: fecha, snapshot usado, tiempo total y si se cumplió el RTO.
7. Borrar el cluster de prueba.

El paso 6 es el que convierte esto en un procedimiento y no en una anécdota: si nadie anotó cuánto
tardó, no sabemos si el RTO de 4 horas es real.

## 5. Monitoreo

- **Uptime externo** sobre `/ready` de la API y sobre la landing, con alerta a WhatsApp o Telegram.
  Externo y no interno: si el servicio se cae, un monitor que vive adentro se cae con él.
- Alertas de §11.3: 5xx > 1% en 5 minutos · job fallido · webhook sin procesar > 15 min.
- Los jobs dejan su corrida en `jobRun`; el panel de salud del DFSA (F1-27) lee de ahí.

## 6. Deploy

`main` con el CI en verde despliega a staging. A prod se promueve a mano, después de probar en
staging.

El CI corre, en este orden: formato → lint → typecheck → **build** → tests con gate de cobertura.
El build va antes que los tests porque las aserciones de la landing verifican el HTML
prerenderizado, que solo existe después de buildear.

## 7. Escala

Railway alcanza para las primeras decenas de tenants. El disparador para mover a VPS o Coolify es
**costo o límites de recursos, no estética** (§6). Para saberlo hace falta la métrica de costo por
tenant desde el día 1 (§13.1).
