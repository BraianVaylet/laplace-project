import { describe, expect, it } from 'vitest';
import { countLinks, looksAutomated, looksLikeSpam } from './spam.js';

/**
 * Las defensas del formulario público. Ninguna le pide nada al humano: un
 * captcha traslada el costo a quien quiere escribirnos, que es justamente la
 * persona que no queremos perder.
 */
describe('la trampa para bots', () => {
  it('🔴 un campo escondido con algo adentro delata al robot', () => {
    // Una persona no ve `website`: está oculto por CSS y sin label.
    expect(looksAutomated('http://spam.example')).toBe(true);
  });

  it('vacío o ausente es una persona', () => {
    expect(looksAutomated(undefined)).toBe(false);
    expect(looksAutomated('')).toBe(false);
    expect(looksAutomated('   ')).toBe(false);
  });
});

describe('el mensaje con demasiados enlaces', () => {
  it('cuenta los links escritos de las dos formas', () => {
    expect(countLinks('mirá https://uno.com y www.dos.com')).toBe(2);
  });

  it('🔴 quien pega su gimnasio y su Instagram no es spam', () => {
    // Un corte demasiado bajo rechaza a un cliente real.
    expect(
      looksLikeSpam('Mi box es https://boxtoro.com y estamos en www.instagram.com/boxtoro'),
    ).toBe(false);
  });

  it('cinco links en diez líneas no es alguien preguntando cuánto sale', () => {
    const publicidad = [
      'https://a.com',
      'https://b.com',
      'www.c.com',
      'https://d.com',
      'www.e.com',
    ].join(' ');

    expect(looksLikeSpam(publicidad)).toBe(true);
  });

  it('un mensaje sin links pasa', () => {
    expect(looksLikeSpam('Hola, tengo un box de 40 socios y quiero saber cuánto sale.')).toBe(
      false,
    );
  });
});
