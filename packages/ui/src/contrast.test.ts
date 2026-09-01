import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Se lee el archivo, no una copia de los valores: el test falla si alguien
 * cambia un token y no mira el contraste, que es justo el caso que importa.
 * (`?raw` no sirve aca: la pipeline de CSS de Vite lo intercepta y devuelve
 * vacio.)
 */
const CSS = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

/**
 * Contraste WCAG 2.2 AA sobre los tokens **reales**.
 *
 * Se calcula en vez de medirse con axe a proposito: axe usa canvas para leer el
 * color pintado y jsdom no implementa canvas, asi que ahi la regla de contraste
 * no corre — pasa siempre, que es peor que no tenerla. Leer el CSS y hacer la
 * cuenta da un resultado exacto y determinista, y ademas falla si alguien
 * cambia un token sin mirar el contraste.
 */
/** oklch → sRGB lineal. La luminancia de WCAG se calcula sobre los valores lineales. */
function oklchToLinearRgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  ];
}

function relativeLuminance(oklch: [number, number, number]): number {
  const [r, g, b] = oklchToLinearRgb(...oklch);
  const clamp = (v: number) => Math.min(Math.max(v, 0), 1);

  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];

  return (light + 0.05) / (dark + 0.05);
}

/** Lee los tokens de un bloque del CSS. `null` = el bloque `@theme` (dark). */
function tokensOf(selector: string | null): Record<string, [number, number, number]> {
  const header = selector === null ? '@theme' : selector;
  const start = CSS.indexOf(header);
  if (start === -1) throw new Error(`no se encontro el bloque ${header} en styles.css`);

  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('\n}', open);
  const block = CSS.slice(open, close);

  const tokens: Record<string, [number, number, number]> = {};
  const pattern = /--color-([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g;

  for (const match of block.matchAll(pattern)) {
    tokens[match[1] as string] = [Number(match[2]), Number(match[3]), Number(match[4])];
  }

  return tokens;
}

const dark = tokensOf(null);
const lightOverrides = tokensOf(":root[data-theme='light']");
const light = { ...dark, ...lightOverrides };

/** Los pares texto/fondo que la UI usa de verdad. */
const PAIRS: Array<[fg: string, bg: string, label: string]> = [
  ['fg', 'bg', 'texto principal sobre el fondo'],
  ['fg', 'surface', 'texto principal sobre una tarjeta'],
  ['fg', 'surface-2', 'texto principal sobre un input'],
  ['fg', 'surface-3', 'texto principal sobre un skeleton'],
  ['fg-muted', 'bg', 'texto secundario sobre el fondo'],
  ['fg-muted', 'surface', 'texto secundario sobre una tarjeta'],
  ['fg-muted', 'surface-2', 'texto secundario sobre un input'],
];

const AA_NORMAL = 4.5;
const AA_LARGE = 3;

describe.each([
  ['dark', dark],
  ['light', light],
])('contraste en tema %s', (themeName, tokens) => {
  it('los tokens del tema estan todos definidos', () => {
    const faltantes = [...new Set(PAIRS.flat().slice(0, -1))].filter(
      (name) => name.includes(' ') === false && tokens[name] === undefined,
    );

    expect(faltantes).toEqual([]);
  });

  it.each(PAIRS)('%s sobre %s (%s) cumple AA', (fg, bg, label) => {
    const ratio = contrastRatio(
      tokens[fg] as [number, number, number],
      tokens[bg] as [number, number, number],
    );

    expect(ratio, `${label} en ${themeName}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL,
    );
  });

  it('el texto blanco sobre el boton primario cumple AA', () => {
    const white: [number, number, number] = [1, 0, 0];
    const ratio = contrastRatio(white, tokens['brand-600'] as [number, number, number]);

    expect(
      ratio,
      `blanco sobre brand-600 en ${themeName}: ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('el texto blanco sobre el boton destructivo cumple AA', () => {
    const white: [number, number, number] = [1, 0, 0];
    const ratio = contrastRatio(white, tokens['danger-600'] as [number, number, number]);

    expect(
      ratio,
      `blanco sobre danger-600 en ${themeName}: ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('el borde se distingue del fondo lo suficiente para verse (AA de no-texto)', () => {
    const ratio = contrastRatio(
      tokens['border'] as [number, number, number],
      tokens['bg'] as [number, number, number],
    );

    expect(
      ratio,
      `borde sobre fondo en ${themeName}: ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(1.4);
  });

  it('el anillo de foco se ve contra el fondo: sin eso no se sabe donde se esta parado', () => {
    const ratio = contrastRatio(
      tokens['brand-500'] as [number, number, number],
      tokens['bg'] as [number, number, number],
    );

    expect(ratio, `foco sobre fondo en ${themeName}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_LARGE,
    );
  });
});

describe('la cuenta en si', () => {
  it('blanco contra negro da 21:1, que es el maximo de la escala', () => {
    const ratio = contrastRatio([1, 0, 0], [0, 0, 0]);

    expect(ratio).toBeCloseTo(21, 0);
  });

  it('un color contra si mismo da 1:1', () => {
    expect(contrastRatio([0.5, 0.1, 250], [0.5, 0.1, 250])).toBeCloseTo(1, 5);
  });

  it('el orden no importa: el contraste es simetrico', () => {
    const a: [number, number, number] = [0.2, 0.01, 250];
    const b: [number, number, number] = [0.96, 0.005, 250];

    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});
