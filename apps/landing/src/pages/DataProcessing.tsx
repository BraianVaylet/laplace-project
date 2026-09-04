/**
 * El acuerdo de tratamiento de datos entre Laplace y el centro (§9.3).
 *
 * 🔴 **El texto vinculante lo tiene que redactar un abogado.** Lo que hay acá
 * es la estructura y los hechos técnicos que sí podemos afirmar — qué datos
 * guardamos, dónde, por cuánto tiempo y qué puede pedir el centro. Las
 * cláusulas legales están marcadas como pendientes en vez de inventadas: un
 * texto legal que suena bien y no fue revisado es peor que no tenerlo, porque
 * alguien lo firma creyendo que dice algo.
 */
const HECHOS = [
  {
    titulo: 'Qué datos trata Laplace',
    detalle:
      'Los que el centro carga o genera: socios (nombre, contacto, documento), contratos y pagos, reservas y asistencias, y — solo si el socio los carga — datos de salud.',
  },
  {
    titulo: 'Quién es responsable y quién encargado',
    detalle:
      'El centro es el responsable del tratamiento de los datos de sus socios. Laplace es el encargado: los trata por cuenta del centro y solo para prestarle el servicio.',
  },
  {
    titulo: 'Separación entre centros',
    detalle:
      'Los datos de cada centro están separados de los de los demás. Esa separación se verifica automáticamente en cada versión del producto.',
  },
  {
    titulo: 'Acceso de soporte',
    detalle:
      'Un integrante de Laplace puede acceder a la cuenta del centro solo para dar soporte, con un motivo declarado. Cada acceso queda registrado y se le avisa al titular de la cuenta.',
  },
  {
    titulo: 'Portabilidad',
    detalle:
      'El centro puede exportar sus datos cuando quiera, en un formato abierto que se lee con cualquier planilla.',
  },
  {
    titulo: 'Retención después de la baja',
    detalle:
      'Los datos se conservan 90 días desde la baja, con la exportación disponible durante ese plazo. Después se purgan.',
  },
  {
    titulo: 'Falta de pago',
    detalle:
      'La suspensión por falta de pago no borra datos: la cuenta queda sin acceso y la información se conserva.',
  },
] as const;

const PENDIENTES = [
  'Cláusulas de responsabilidad y límite de responsabilidad',
  'Subencargados y transferencias internacionales',
  'Procedimiento y plazos ante un incidente de seguridad',
  'Jurisdicción y ley aplicable',
] as const;

export function DataProcessing() {
  return (
    <article className="flex flex-col gap-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Acuerdo de tratamiento de datos</h1>
        <p className="text-fg-muted max-w-prose">
          Entre Laplace y el centro que contrata el servicio, en el marco de la Ley 25.326 de
          Protección de Datos Personales de la República Argentina.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Lo que el producto hace</h2>
        <dl className="flex flex-col gap-4">
          {HECHOS.map((hecho) => (
            <div key={hecho.titulo}>
              <dt className="font-medium">{hecho.titulo}</dt>
              <dd className="text-fg-muted text-sm">{hecho.detalle}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-border flex flex-col gap-3 rounded-lg border border-dashed p-5">
        <h2 className="text-lg font-semibold">Pendiente de redacción legal</h2>
        <p className="text-fg-muted text-sm">
          Estas cláusulas las tiene que redactar y revisar un profesional antes de publicar el
          acuerdo como vinculante. Se listan para que se vea qué falta, no para dar por hecho lo que
          van a decir.
        </p>
        <ul className="text-fg-muted flex list-inside list-disc flex-col gap-1 text-sm">
          {PENDIENTES.map((pendiente) => (
            <li key={pendiente}>{pendiente}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
