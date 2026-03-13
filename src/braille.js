/**
 * Unified Braille Encoding/Decoding Module
 * 
 * Two encoding modes:
 * 1. Byte-level: maps UTF-8 bytes 1:1 to braille codepoints (lossless, binary-safe)
 * 2. Character-level: maps English letters to Grade-1 braille cells (human-readable)
 */

const BRAILLE_BASE = 0x2800;

// ============================================================================
// Byte-level encoding (lossless UTF-8 ↔ Braille)
// ============================================================================

function toBraille(text) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let result = '';
  for (const byte of bytes) {
    result += String.fromCodePoint(BRAILLE_BASE + byte);
  }
  return result;
}

function fromBraille(braille) {
  const bytes = [];
  for (const char of braille) {
    const cp = char.codePointAt(0);
    if (cp >= BRAILLE_BASE && cp <= BRAILLE_BASE + 255) {
      bytes.push(cp - BRAILLE_BASE);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// ============================================================================
// Character-level encoding (English ↔ Grade-1 Braille)
// ============================================================================

const BRAILLE_MAP = {
  'a': '⠁', 'b': '⠃', 'c': '⠉', 'd': '⠙', 'e': '⠑',
  'f': '⠋', 'g': '⠛', 'h': '⠓', 'i': '⠊', 'j': '⠚',
  'k': '⠅', 'l': '⠇', 'm': '⠍', 'n': '⠝', 'o': '⠕',
  'p': '⠏', 'q': '⠟', 'r': '⠗', 's': '⠎', 't': '⠞',
  'u': '⠥', 'v': '⠧', 'w': '⠺', 'x': '⠭', 'y': '⠽',
  'z': '⠵',
  '0': '⠴', '1': '⠂', '2': '⠆', '3': '⠒', '4': '⠲',
  '5': '⠢', '6': '⠖', '7': '⠶', '8': '⠦', '9': '⠔',
  ' ': '⠀', '.': '⠲', ',': '⠂', '!': '⠖', '?': '⠦',
  "'": '⠄', '-': '⠤', ':': '⠒', ';': '⠆', '(': '⠶',
  ')': '⠶', '/': '⠌', '"': '⠄', '\n': '⠀',
};

const REVERSE_BRAILLE_MAP = Object.fromEntries(
  Object.entries(BRAILLE_MAP).map(([k, v]) => [v, k])
);

function textToBraille(text) {
  return text.toLowerCase().split('').map(char => {
    return BRAILLE_MAP[char] || '⠿';
  }).join('');
}

function brailleToText(braille) {
  return braille.split('').map(char => {
    return REVERSE_BRAILLE_MAP[char] || '?';
  }).join('');
}

module.exports = {
  BRAILLE_BASE,
  BRAILLE_MAP,
  REVERSE_BRAILLE_MAP,
  // Byte-level (lossless)
  toBraille,
  fromBraille,
  // Character-level (human-readable)
  textToBraille,
  brailleToText,
};
