import { Button, Card, EmptyState } from '@laplace/ui';

/** El home del socio. Lo llena F1-28/F1-29; hoy es el punto de entrada. */
export function Home() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-fg text-xl font-semibold">Hoy</h1>

      <Card title="Tus próximas clases">
        <EmptyState
          title="No tenés reservas"
          description="Mirá el horario del centro y anotate."
          action={<Button>Ver horario</Button>}
        />
      </Card>
    </div>
  );
}
