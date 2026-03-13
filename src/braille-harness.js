/**
 * UEB Braille Braiding Harness
 * 
 * Uses Unified English Braille (UEB) 8-dot encoding as a semantic compression
 * and normalization layer for LLM outputs. This serves multiple purposes:
 * 
 * 1. COMPRESSION: UEB contractions reduce common patterns to single cells
 * 2. NORMALIZATION: All LLM outputs pass through same encoding layer
 * 3. COMPACTION: Braille representation enables efficient context compression
 * 4. FINGERPRINTING: Braille patterns can be hashed for deduplication
 * 5. CROSS-MODEL CONSISTENCY: DeepSeek, Claude, GPT all normalize to same form
 */

const { BRAILLE_BASE, toBraille, fromBraille } = require('./braille');

// ============================================================================
// UEB Word Contractions (Grade 2 Braille)
// These compress common words to single or double cells
// ============================================================================

const UEB_CONTRACTIONS = {
  // Single-cell whole word contractions
  'but': '⠃',
  'can': '⠉',
  'do': '⠙',
  'every': '⠑',
  'from': '⠋',
  'go': '⠛',
  'have': '⠓',
  'just': '⠚',
  'knowledge': '⠅',
  'like': '⠇',
  'more': '⠍',
  'not': '⠝',
  'people': '⠏',
  'quite': '⠟',
  'rather': '⠗',
  'so': '⠎',
  'that': '⠞',
  'us': '⠥',
  'very': '⠧',
  'will': '⠺',
  'it': '⠭',
  'you': '⠽',
  'as': '⠵',
  'and': '⠯',
  'for': '⠿',
  'of': '⠷',
  'the': '⠮',
  'with': '⠾',
  'child': '⠡',
  'shall': '⠩',
  'this': '⠹',
  'which': '⠱',
  'out': '⠳',
  'still': '⠌',
  
  // Programming-specific contractions (custom extension)
  'function': '⣋⣥',
  'return': '⣗⣞',
  'const': '⣉⣎',
  'let': '⣇⣞',
  'var': '⣧⣗',
  'if': '⣊⣋',
  'else': '⣑⣇',
  'while': '⣺⣓',
  'for': '⣋⣗',
  'class': '⣉⣇',
  'import': '⣊⣍',
  'export': '⣑⣭',
  'async': '⣁⣎',
  'await': '⣁⣺',
  'true': '⣞⣗',
  'false': '⣋⣇',
  'null': '⣝⣥',
  'undefined': '⣥⣙',
  'console': '⣉⣎⣇',
  'error': '⣑⣗⣗',
  'string': '⣎⣞⣗',
  'number': '⣝⣥⣍',
  'boolean': '⣃⣕⣇',
  'array': '⣁⣗⣗',
  'object': '⣕⣃⣚',
  'promise': '⣏⣗⣍',
};

// Reverse map for decoding
const UEB_REVERSE = {};
for (const [word, braille] of Object.entries(UEB_CONTRACTIONS)) {
  UEB_REVERSE[braille] = word;
}

// ============================================================================
// 8-Dot Braille Core Encoding (delegated to src/braille.js)
// ============================================================================

function byteToBraille(byte) {
  return String.fromCodePoint(BRAILLE_BASE + byte);
}

function brailleToByte(char) {
  const cp = char.codePointAt(0);
  if (cp >= BRAILLE_BASE && cp <= BRAILLE_BASE + 255) {
    return cp - BRAILLE_BASE;
  }
  return null;
}

// Aliases for backward compatibility — delegate to consolidated module
const textToBrailleRaw = toBraille;
const brailleToTextRaw = fromBraille;

// ============================================================================
// UEB Braiding Harness
// ============================================================================

class BrailleHarness {
  constructor(options = {}) {
    this.useContractions = options.useContractions !== false;
    this.trackStats = options.trackStats !== false;
    this.stats = {
      totalCharsIn: 0,
      totalBrailleOut: 0,
      contractionsApplied: 0,
      compressionRatio: 1.0,
    };
  }

  /**
   * Encode text to UEB braille with contractions
   * This is the "braiding" step - weaving text into braille form
   */
  braid(text) {
    if (!text) return '';
    
    this.stats.totalCharsIn += text.length;
    
    let result = text;
    
    // Apply UEB contractions if enabled
    if (this.useContractions) {
      // Sort by length descending to match longer words first
      const sortedWords = Object.keys(UEB_CONTRACTIONS)
        .sort((a, b) => b.length - a.length);
      
      for (const word of sortedWords) {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        const before = result;
        result = result.replace(regex, `⠈${UEB_CONTRACTIONS[word]}⠈`);
        if (result !== before) {
          this.stats.contractionsApplied++;
        }
      }
    }
    
    // Convert remaining text to 8-dot braille
    const parts = result.split('⠈');
    const braided = parts.map((part, i) => {
      // Odd indices are already contracted braille
      if (i % 2 === 1) return part;
      // Even indices need raw encoding
      return textToBrailleRaw(part);
    }).join('');
    
    this.stats.totalBrailleOut += braided.length;
    this.stats.compressionRatio = this.stats.totalBrailleOut / this.stats.totalCharsIn;
    
    return braided;
  }

  /**
   * Decode UEB braille back to text
   * This is the "unbraiding" step
   */
  unbraid(braille) {
    if (!braille) return '';
    
    let result = '';
    let i = 0;
    const chars = [...braille];
    
    while (i < chars.length) {
      const char = chars[i];
      
      // Check for multi-cell contractions (2-3 cells)
      const twoCell = chars.slice(i, i + 2).join('');
      const threeCell = chars.slice(i, i + 3).join('');
      
      if (UEB_REVERSE[threeCell]) {
        result += UEB_REVERSE[threeCell];
        i += 3;
      } else if (UEB_REVERSE[twoCell]) {
        result += UEB_REVERSE[twoCell];
        i += 2;
      } else if (UEB_REVERSE[char]) {
        result += UEB_REVERSE[char];
        i++;
      } else {
        // Single braille cell - decode as byte
        const byte = brailleToByte(char);
        if (byte !== null) {
          // Accumulate bytes for UTF-8 decoding
          const bytes = [byte];
          // Check for multi-byte UTF-8 sequences
          while (i + bytes.length < chars.length) {
            const nextByte = brailleToByte(chars[i + bytes.length]);
            if (nextByte !== null && nextByte >= 0x80 && nextByte < 0xC0) {
              bytes.push(nextByte);
            } else {
              break;
            }
          }
          result += new TextDecoder().decode(new Uint8Array(bytes));
          i += bytes.length;
        } else {
          result += char;
          i++;
        }
      }
    }
    
    return result;
  }

  /**
   * Generate a semantic fingerprint of braided content
   * Useful for deduplication during compaction
   */
  fingerprint(braille) {
    // Simple hash of braille content
    let hash = 0;
    for (const char of braille) {
      const cp = char.codePointAt(0);
      hash = ((hash << 5) - hash) + cp;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Compact braided content by removing redundancy
   * Returns { compacted, savings }
   */
  compact(brailleArray) {
    const seen = new Map();
    const compacted = [];
    let savings = 0;
    
    for (const item of brailleArray) {
      const fp = this.fingerprint(item);
      
      if (seen.has(fp)) {
        // Reference previous occurrence
        compacted.push({ ref: seen.get(fp), fp });
        savings += item.length;
      } else {
        seen.set(fp, compacted.length);
        compacted.push({ content: item, fp });
      }
    }
    
    return { compacted, savings, uniqueCount: seen.size };
  }

  /**
   * Expand compacted content back to full form
   */
  expand(compacted) {
    const result = [];
    
    for (const item of compacted) {
      if (item.content !== undefined) {
        result.push(item.content);
      } else if (item.ref !== undefined) {
        result.push(result[item.ref]);
      }
    }
    
    return result;
  }

  getStats() {
    return { ...this.stats };
  }

  resetStats() {
    this.stats = {
      totalCharsIn: 0,
      totalBrailleOut: 0,
      contractionsApplied: 0,
      compressionRatio: 1.0,
    };
  }
}

// ============================================================================
// Integration with Context Compaction
// ============================================================================

/**
 * Wrap conversation history in braille harness for compaction
 */
function braidConversation(history, harness = new BrailleHarness()) {
  return history.map(msg => ({
    ...msg,
    _braille: typeof msg.content === 'string' 
      ? harness.braid(msg.content)
      : null,
    _fingerprint: typeof msg.content === 'string'
      ? harness.fingerprint(harness.braid(msg.content))
      : null,
  }));
}

/**
 * Find duplicate/similar messages in braided conversation
 */
function findDuplicates(braidedHistory) {
  const fingerprints = new Map();
  const duplicates = [];
  
  braidedHistory.forEach((msg, idx) => {
    if (msg._fingerprint) {
      if (fingerprints.has(msg._fingerprint)) {
        duplicates.push({
          original: fingerprints.get(msg._fingerprint),
          duplicate: idx,
        });
      } else {
        fingerprints.set(msg._fingerprint, idx);
      }
    }
  });
  
  return duplicates;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  BrailleHarness,
  UEB_CONTRACTIONS,
  textToBrailleRaw,
  brailleToTextRaw,
  byteToBraille,
  brailleToByte,
  braidConversation,
  findDuplicates,
};
