import { Button } from '@laplace/ui';

export function App() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Laplace · Panel del centro</h1>
      <p className="text-fg-muted">Gestion del centro: clases, miembros, packs y caja.</p>
      <div>
        <Button>Empezar</Button>
      </div>
    </main>
  );
}
