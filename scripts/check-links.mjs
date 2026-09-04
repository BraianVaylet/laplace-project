#!/usr/bin/env node
/**
 * Verifica que los enlaces relativos de la documentacion apunten a algo que
 * existe.
 *
 * Documentacion con enlaces rotos es peor que sin enlaces: manda a alguien a
 * buscar una pagina que no esta y le hace dudar del resto. Corre en CI.
 *
 * Solo mira enlaces relativos. Los externos no se chequean a proposito: que un
 * sitio ajeno este caido no tiene que romper el build de este repo.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..');
const IGNORADOS = new Set(['node_modules', '.git', 'dist', 'coverage', '.turbo', 'test-results']);

/** `[texto](destino)`, sin imagenes ni referencias. */
const ENLACE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

async function markdowns(directorio) {
  const encontrados = [];

  for (const entrada of await readdir(directorio, { withFileTypes: true })) {
    if (IGNORADOS.has(entrada.name)) continue;
    const ruta = join(directorio, entrada.name);

    if (entrada.isDirectory()) encontrados.push(...(await markdowns(ruta)));
    else if (entrada.name.endsWith('.md')) encontrados.push(ruta);
  }

  return encontrados;
}

const esExterno = (destino) =>
  /^(https?:|mailto:|tel:|#)/.test(destino) || destino.startsWith('//');

async function existe(ruta) {
  try {
    await stat(ruta);

    return true;
  } catch {
    return false;
  }
}

const archivos = await markdowns(RAIZ);
const rotos = [];

for (const archivo of archivos) {
  const contenido = await readFile(archivo, 'utf8');

  for (const [, destino] of contenido.matchAll(ENLACE)) {
    if (esExterno(destino)) continue;

    // El ancla no se verifica: apunta a un titulo, no a un archivo.
    const sinAncla = destino.split('#')[0];
    if (!sinAncla) continue;

    const objetivo = resolve(dirname(archivo), decodeURIComponent(sinAncla));
    if (!(await existe(objetivo))) {
      rotos.push(`${archivo.replace(RAIZ + sep, '')} → ${destino}`);
    }
  }
}

if (rotos.length > 0) {
  process.stdout.write(`Enlaces rotos en la documentacion:\n  ${rotos.join('\n  ')}\n`);
  process.exit(1);
}

process.stdout.write(`${archivos.length} archivos revisados, sin enlaces rotos.\n`);
