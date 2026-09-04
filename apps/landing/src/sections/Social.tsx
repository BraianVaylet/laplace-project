import { SOCIAL_LINKS } from './social-links.js';

/** Acceso directo a redes (§5.1.4). */
export function Social() {
  return (
    <section id="redes" className="flex flex-col gap-4 py-8">
      <h2 className="text-2xl font-semibold">Seguinos</h2>
      <ul className="flex flex-wrap gap-2">
        {SOCIAL_LINKS.map((red) => (
          <li key={red.id}>
            <a
              href={red.href}
              target="_blank"
              /*
               * `noopener` no es opcional: sin él, la página que se abre puede
               * manipular la nuestra desde `window.opener`.
               */
              rel="noopener noreferrer"
              className="border-border hover:bg-surface-2 focus-visible:focus-ring flex h-11 items-center rounded-md border px-4 text-sm"
            >
              {red.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
