/**
 * Política de privacidad. §9.3 la exige, y §9.2 define su contenido: la Ley
 * 25.326 pide finalidad declarada, derechos ARCO y el encuadre del rol dual
 * (el centro es responsable, Laplace es encargado).
 */
export function Privacy() {
  return (
    <article className="prose-sm flex flex-col gap-4 py-8">
      <h1 className="text-2xl font-semibold">Política de privacidad</h1>
      <p className="text-fg-muted">
        Tratamos datos personales bajo la Ley 25.326. El centro deportivo es el responsable del
        tratamiento y Laplace, su encargado. El texto completo se publica versionado y se completa
        con F1-26.
      </p>
    </article>
  );
}
