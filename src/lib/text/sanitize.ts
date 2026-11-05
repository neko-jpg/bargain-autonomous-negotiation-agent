/**
 * Neutralisation for text that originates outside this system.
 *
 * Two classes of attack are handled here:
 *
 * - **Terminal / document control.** C0/C1 control characters and line
 *   separators let a value escape its container and start a new "clause" or a
 *   new instruction line.
 * - **Visual spoofing.** Bidirectional overrides (U+202A–U+202E, U+2066–U+2069)
 *   and zero-width characters let a value render differently from the bytes a
 *   human or a hash actually sees — the Trojan Source trick applied to a
 *   contract: `¥10` can be made to display as `¥100`.
 *
 * Everything is also NFKC-normalised so full-width and lookalike forms collapse,
 * and clipped to a hard length.
 */

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const ZERO_WIDTH = /[\u200b-\u200d\ufeff\u180e]/g;
const LINE_SEPARATORS = /[\u2028\u2029]/g;

/** True when the value still contains characters that can lie about its rendering. */
export function hasUnsafeCharacters(value: string): boolean {
  BIDI_CONTROLS.lastIndex = 0;
  ZERO_WIDTH.lastIndex = 0;
  CONTROL_CHARACTERS.lastIndex = 0;
  return BIDI_CONTROLS.test(value)
    || ZERO_WIDTH.test(value)
    || CONTROL_CHARACTERS.test(value)
    || LINE_SEPARATORS.test(value);
}

/**
 * Collapses an untrusted value into one line of plain text.
 *
 * Not reversible and not intended to be: anything that survives is safe to
 * place inside a quoted span in a prompt, a contract clause or a log line.
 */
export function neutralizeText(value: unknown, maxLength = 160): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(BIDI_CONTROLS, '')
    .replace(ZERO_WIDTH, '')
    .replace(LINE_SEPARATORS, ' ')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, maxLength));
}

/**
 * Renders a value that came from a counterparty so a human reading it cannot
 * mistake it for a term this system generated.
 */
export function quoteUntrusted(value: unknown, maxLength = 160): string {
  const clean = neutralizeText(value, maxLength);
  return clean ? `「${clean}」` : '（記載なし）';
}

/** A date string is only shown if it parses; otherwise the reader is told so. */
export function describeExpiry(value: unknown): string {
  const clean = neutralizeText(value, 80);
  if (!clean) return '';
  const parsed = Date.parse(clean);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}
