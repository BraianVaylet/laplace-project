import { Button, Card, EmptyState } from '@laplace/ui';

/** El tablero operativo del día. Lo llena F1-24; hoy es el punto de entrada. */
export function Home() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-fg text-xl font-semibold">Hoy</h1>

      <Card title="Clases de hoy">
        <EmptyState
          title="Todavía no tenés clases"
          description="Creá la primera y empezá a recibir reservas."
          action={<Button>Crear la primera</Button>}
        />
      </Card>
    </div>
  );
}
