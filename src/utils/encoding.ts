const CODEPAGE_TO_ENCODING: Readonly<Record<number, string>> = {
  65001: 'utf-8',
  1200: 'utf-16le',
  1201: 'utf-16be',
  1252: 'windows-1252',
  28591: 'windows-1252', // ISO-8859-1 maps to windows-1252 per WHATWG
  20127: 'windows-1252', // US-ASCII superset
  28605: 'iso-8859-15',
  1250: 'windows-1250',
  28592: 'iso-8859-2',
  1251: 'windows-1251',
  28595: 'iso-8859-5',
  20866: 'koi8-r',
  21866: 'koi8-u',
  866: 'ibm866',
  1253: 'windows-1253',
  28597: 'iso-8859-7',
  1254: 'windows-1254',
  28599: 'iso-8859-9',
  1255: 'windows-1255',
  28598: 'iso-8859-8',
  1256: 'windows-1256',
  28596: 'iso-8859-6',
  1257: 'windows-1257',
  28594: 'iso-8859-4',
  28603: 'iso-8859-13',
  1258: 'windows-1258',
  874: 'windows-874',
  932: 'shift_jis',
  50220: 'iso-2022-jp',
  51932: 'euc-jp',
  936: 'gb18030',
  54936: 'gb18030',
  949: 'euc-kr',
  51949: 'euc-kr',
  950: 'big5',
  10000: 'macintosh',
  850: 'cp850',
  858: 'cp858',
};

// CP850 high-byte table (0x80..0xFF) because WHATWG TextDecoder does not provide ibm850
const CP850_HIGH_BYTES: readonly string[] = [
  '\u00C7', '\u00FC', '\u00E9', '\u00E2', '\u00E4', '\u00E0', '\u00E5', '\u00E7',
  '\u00EA', '\u00EB', '\u00E8', '\u00EF', '\u00EE', '\u00EC', '\u00C4', '\u00C5',
  '\u00C9', '\u00E6', '\u00C6', '\u00F4', '\u00F6', '\u00F2', '\u00FB', '\u00F9',
  '\u00FF', '\u00D6', '\u00DC', '\u00F8', '\u00A3', '\u00D8', '\u00D7', '\u0192',
  '\u00E1', '\u00ED', '\u00F3', '\u00FA', '\u00F1', '\u00D1', '\u00AA', '\u00BA',
  '\u00BF', '\u00AE', '\u00AC', '\u00BD', '\u00BC', '\u00A1', '\u00AB', '\u00BB',
  '\u2591', '\u2592', '\u2593', '\u2502', '\u2524', '\u00C1', '\u00C2', '\u00C0',
  '\u00A9', '\u2563', '\u2551', '\u2557', '\u255D', '\u00A2', '\u00A5', '\u2510',
  '\u2514', '\u2534', '\u252C', '\u251C', '\u2500', '\u253C', '\u00E3', '\u00C3',
  '\u255A', '\u2554', '\u2569', '\u2566', '\u2560', '\u2550', '\u256C', '\u00A4',
  '\u00F0', '\u00D0', '\u00CA', '\u00CB', '\u00C8', '\u0131', '\u00CD', '\u00CE',
  '\u00CF', '\u2518', '\u250C', '\u2588', '\u2584', '\u00A6', '\u00CC', '\u2580',
  '\u00D3', '\u00DF', '\u00D4', '\u00D2', '\u00F5', '\u00D5', '\u00B5', '\u00FE',
  '\u00DE', '\u00DA', '\u00DB', '\u00D9', '\u00FD', '\u00DD', '\u00AF', '\u00B4',
  '\u00AD', '\u00B1', '\u2017', '\u00BE', '\u00B6', '\u00A7', '\u00F7', '\u00B8',
  '\u00B0', '\u00A8', '\u00B7', '\u00B9', '\u00B3', '\u00B2', '\u25A0', '\u00A0',
];

const decoderCache = new Map<string, TextDecoder>();
const utf8FatalDecoder = new TextDecoder('utf-8', { fatal: true });

// WHATWG Windows-1252 C1 table (0x80..0x9F) guards against runtimes whose latin1 fast-path skips C1 mapping
const WIN1252_C1_MAP: Readonly<Record<number, string>> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

function upgradeWin1252C1(str: string): string {
  return /[\u0080-\u009f]/.test(str)
    ? str.replace(/[\u0080-\u009f]/g, (ch) => WIN1252_C1_MAP[ch.charCodeAt(0)] ?? ch)
    : str;
}

function getDecoder(label: string): TextDecoder {
  const existing = decoderCache.get(label);
  if (existing) return existing;
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label, { fatal: false });
  } catch {
    decoder = decoderCache.get('windows-1252') ?? new TextDecoder('windows-1252', { fatal: false });
  }
  decoderCache.set(label, decoder);
  return decoder;
}

export function mapCodepageToEncoding(codepage?: number): string | null {
  if (codepage === undefined || !Number.isFinite(codepage)) return null;
  return CODEPAGE_TO_ENCODING[codepage] ?? null;
}

export function normalizeCharsetLabel(raw?: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (!cleaned) return null;

  if (cleaned === 'cp850' || cleaned === 'ibm850' || cleaned === 'cp-850') return 'cp850';
  if (cleaned === 'cp858' || cleaned === 'ibm858') return 'cp858';
  if (cleaned === 'utf8' || cleaned === 'utf-8') return 'utf-8';
  if (cleaned === 'latin1' || cleaned === 'iso-8859-1' || cleaned === 'iso_8859-1' || cleaned === 'cp1252' || cleaned === 'us-ascii' || cleaned === 'ascii') {
    return 'windows-1252';
  }
  if (cleaned === 'latin9' || cleaned === 'iso-8859-15' || cleaned === 'iso8859-15') {
    return 'iso-8859-15';
  }
  if (cleaned === 'cp1250' || cleaned === 'windows-1250') return 'windows-1250';
  if (cleaned === 'cp1251' || cleaned === 'windows-1251') return 'windows-1251';
  if (cleaned === 'cp1254' || cleaned === 'windows-1254') return 'windows-1254';

  const cpMatch = cleaned.match(/^(?:cp|windows-?)(\d+)$/);
  if (cpMatch) {
    const mapped = mapCodepageToEncoding(Number(cpMatch[1]));
    if (mapped) return mapped;
  }

  try {
    new TextDecoder(cleaned, { fatal: false });
    return cleaned;
  } catch {
    return null;
  }
}

export function decodeCp850(bytes: Uint8Array, isCp858 = false): string {
  let out = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    const b = bytes[i];
    if (b === 0) continue;
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (isCp858 && b === 0xd5) {
      out += '\u20AC';
    } else {
      out += CP850_HIGH_BYTES[b - 0x80];
    }
  }
  return out;
}

function detectBomOrUtf16(bytes: Uint8Array): 'utf-8' | 'utf-16le' | 'utf-16be' | null {
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }
  if (bytes.byteLength >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  }
  if (bytes.byteLength >= 8 && bytes.byteLength % 2 === 0) {
    const samplePairs = Math.min(64, bytes.byteLength / 2);
    let evenNulls = 0;
    let oddNulls = 0;
    for (let i = 0; i < samplePairs; i += 1) {
      if (bytes[i * 2] === 0) evenNulls += 1;
      if (bytes[i * 2 + 1] === 0) oddNulls += 1;
    }
    if (evenNulls === 0 && oddNulls >= Math.ceil(samplePairs * 0.6)) {
      return 'utf-16le';
    }
  }
  return null;
}

/**
 * Decodes raw 8-bit/Unicode text bytes while preserving German umlauts and European
 * special characters across UTF-8, Windows-1252, ISO-8859-1/15, CP850, and MAPI codepages.
 */
export function decodeSmartTextBytes(
  bytes: Uint8Array,
  codepageOrCharset?: number | string,
): string {
  if (bytes.byteLength === 0) return '';

  const bomEncoding = detectBomOrUtf16(bytes);
  if (bomEncoding) {
    return getDecoder(bomEncoding).decode(bytes).replace(/\0/g, '');
  }

  const hintLabel =
    typeof codepageOrCharset === 'number'
      ? mapCodepageToEncoding(codepageOrCharset)
      : normalizeCharsetLabel(codepageOrCharset);

  let hasHighBit = false;
  let hasEsc = false;
  for (let i = 0; i < bytes.byteLength; i += 1) {
    const b = bytes[i];
    if (b >= 0x80) {
      hasHighBit = true;
      break;
    }
    if (b === 0x1b) hasEsc = true;
  }

  if (!hasHighBit) {
    const asciiLabel = hasEsc && hintLabel === 'iso-2022-jp' ? 'iso-2022-jp' : 'windows-1252';
    return getDecoder(asciiLabel).decode(bytes).replace(/\0/g, '');
  }

  // Test strict UTF-8 first: single-byte Windows-1252 umlauts (e.g. "für" = 0xFC 0x72)
  // throw TypeError immediately under { fatal: true }, avoiding U+FFFD replacement chars.
  try {
    return utf8FatalDecoder.decode(bytes).replace(/\0/g, '');
  } catch {
    // Fall back to explicit MAPI codepage / charset hint or Windows-1252
  }

  if (hintLabel === 'cp850' || hintLabel === 'cp858') {
    return decodeCp850(bytes, hintLabel === 'cp858').replace(/\0/g, '');
  }

  const fallbackLabel = hintLabel && hintLabel !== 'utf-8' ? hintLabel : 'windows-1252';
  const decoded = getDecoder(fallbackLabel).decode(bytes).replace(/\0/g, '');
  return fallbackLabel === 'windows-1252' ? upgradeWin1252C1(decoded) : decoded;
}

/**
 * Decodes HTML byte payloads (`PidTagHtml` / `.msg` `data.html`) by inspecting BOM,
 * `<meta charset="...">`, strict UTF-8 validation, and MAPI codepage hints.
 */
export function decodeSmartHtmlBytes(bytes: Uint8Array, codepageHint?: number): string {
  if (bytes.byteLength === 0) return '';

  const bomEncoding = detectBomOrUtf16(bytes);
  if (bomEncoding) {
    return getDecoder(bomEncoding).decode(bytes).replace(/\0/g, '');
  }

  const headLen = Math.min(bytes.byteLength, 4096);
  const headAscii = getDecoder('windows-1252').decode(bytes.subarray(0, headLen));
  const metaMatch = headAscii.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9._-]+)/i);
  const sniffedCharset = metaMatch ? normalizeCharsetLabel(metaMatch[1]) : null;

  return decodeSmartTextBytes(bytes, sniffedCharset ?? codepageHint);
}

function decodeQuotedPrintableWord(payload: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < payload.length; i += 1) {
    const ch = payload[i];
    if (ch === '_') {
      bytes.push(0x20);
    } else if (ch === '=' && i + 2 < payload.length) {
      const hex = payload.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
      bytes.push(ch.charCodeAt(0) & 0xff);
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function decodeBase64Word(payload: string): Uint8Array {
  const compact = payload.replace(/\s+/g, '');
  const binary = atob(compact);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Decodes RFC 2047 MIME encoded words (`=?charset?Q|B?...?=`) that sometimes remain in
 * raw MAPI Subject / Sender / To strings.
 */
export function decodeMimeWords(input: string): string {
  if (!input || !input.includes('=?')) return input;
  const joined = input.replace(/(\?=)\s+(=\?)/g, '$1$2');
  return joined.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (fullMatch, charset: string, encoding: string, payload: string) => {
      try {
        const bytes =
          encoding.toUpperCase() === 'B'
            ? decodeBase64Word(payload)
            : decodeQuotedPrintableWord(payload);
        return decodeSmartTextBytes(bytes, charset);
      } catch {
        return fullMatch;
      }
    },
  );
}

interface RtfGroupState {
  uc: number;
  ignore: boolean;
  isHtmlTag: boolean;
  expectDestination: boolean;
}

const RTF_IGNORED_DESTINATIONS = new Set<string>([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'footer',
  'headerl',
  'headerr',
  'headerf',
  'footerl',
  'footerr',
  'footerf',
  'footnote',
  'listtable',
  'listoverridetable',
  'revtbl',
  'rsidtbl',
  'mmathPr',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'xmlnstbl',
  'fldinst',
]);

/**
 * Extracts readable HTML (`\fromhtml1` encapsulated) or plain text from LZFu-decompressed
 * RTF (`0x1009`), translating RTF hex escapes (`\'f6` -> `ö`) and `\uN` Unicode escapes.
 */
export function extractRtfBody(
  rtf: string,
  fallbackCodepage?: number,
): { html: string; text: string } {
  if (!rtf || !rtf.trim()) return { html: '', text: '' };

  const cpgMatch = rtf.match(/\\ansicpg(\d+)/i);
  const ansicpg = cpgMatch ? Number(cpgMatch[1]) : (fallbackCodepage ?? 1252);
  const isFromHtml = /\\fromhtml1\b/i.test(rtf);

  const stack: RtfGroupState[] = [
    { uc: 1, ignore: false, isHtmlTag: false, expectDestination: false },
  ];
  let current = (): RtfGroupState => stack[stack.length - 1];

  let out = '';
  let hexBuffer: number[] = [];
  let skipFallbackChars = 0;
  let htmlRtfSuppress = false;

  const flushHex = (): void => {
    if (hexBuffer.length === 0) return;
    out += decodeSmartTextBytes(new Uint8Array(hexBuffer), ansicpg);
    hexBuffer = [];
  };

  const canEmit = (): boolean => {
    const st = current();
    if (st.ignore) return false;
    if (isFromHtml && htmlRtfSuppress && !st.isHtmlTag) return false;
    return true;
  };

  let i = 0;
  while (i < rtf.length) {
    const ch = rtf[i];

    if (ch === '{') {
      flushHex();
      skipFallbackChars = 0;
      const parent = current();
      stack.push({
        uc: parent.uc,
        ignore: parent.ignore,
        isHtmlTag: parent.isHtmlTag,
        expectDestination: false,
      });
      i += 1;
      continue;
    }

    if (ch === '}') {
      flushHex();
      skipFallbackChars = 0;
      if (stack.length > 1) stack.pop();
      i += 1;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }

    if (ch === '\\') {
      i += 1;
      if (i >= rtf.length) break;
      const next = rtf[i];

      // Hex escape \'hh
      if (next === "'") {
        const hex = rtf.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          i += 3;
          if (skipFallbackChars > 0) {
            skipFallbackChars -= 1;
          } else if (canEmit()) {
            hexBuffer.push(parseInt(hex, 16));
          }
          continue;
        }
        flushHex();
        i += 1;
        continue;
      }

      // Escaped symbol character
      if (next === '{' || next === '}' || next === '\\') {
        flushHex();
        if (skipFallbackChars > 0) {
          skipFallbackChars -= 1;
        } else if (canEmit()) {
          out += next;
        }
        i += 1;
        continue;
      }

      if (next === '*') {
        flushHex();
        current().expectDestination = true;
        i += 1;
        continue;
      }

      if (next === '~') {
        flushHex();
        if (skipFallbackChars > 0) {
          skipFallbackChars -= 1;
        } else if (canEmit()) {
          out += '\u00A0';
        }
        i += 1;
        continue;
      }

      if (next === '_') {
        flushHex();
        if (skipFallbackChars > 0) {
          skipFallbackChars -= 1;
        } else if (canEmit()) {
          out += '-';
        }
        i += 1;
        continue;
      }

      if (next === '-') {
        flushHex();
        i += 1;
        continue;
      }

      if (!/[a-zA-Z]/.test(next)) {
        flushHex();
        i += 1;
        continue;
      }

      // Parse control word + optional integer parameter + single optional space delimiter
      const wordStart = i;
      while (i < rtf.length && /[a-zA-Z]/.test(rtf[i])) i += 1;
      const word = rtf.slice(wordStart, i);

      let param: number | null = null;
      if (i < rtf.length && (rtf[i] === '-' || /[0-9]/.test(rtf[i]))) {
        const numStart = i;
        if (rtf[i] === '-') i += 1;
        while (i < rtf.length && /[0-9]/.test(rtf[i])) i += 1;
        const parsed = Number(rtf.slice(numStart, i));
        if (Number.isFinite(parsed)) param = parsed;
      }

      if (i < rtf.length && rtf[i] === ' ') {
        i += 1;
      }

      const st = current();
      if (st.expectDestination) {
        st.expectDestination = false;
        if (isFromHtml && word === 'htmltag') {
          st.ignore = false;
          st.isHtmlTag = true;
        } else {
          st.ignore = true;
        }
        continue;
      }

      if (RTF_IGNORED_DESTINATIONS.has(word)) {
        flushHex();
        st.ignore = true;
        continue;
      }

      if (word === 'bin' && param !== null && param > 0) {
        flushHex();
        i += param;
        continue;
      }

      if (word === 'uc' && param !== null) {
        st.uc = Math.max(0, param);
        continue;
      }

      if (isFromHtml && word === 'htmlrtf') {
        flushHex();
        htmlRtfSuppress = param !== 0;
        continue;
      }

      if (word === 'u' && param !== null) {
        flushHex();
        const codePoint = param < 0 ? param + 65536 : param;
        if (canEmit() && codePoint >= 0 && codePoint <= 0x10ffff) {
          out += String.fromCodePoint(codePoint);
        }
        skipFallbackChars = st.uc;
        continue;
      }

      if (word === 'par' || word === 'line') {
        flushHex();
        if (canEmit()) out += '\n';
        continue;
      }

      if (word === 'tab') {
        flushHex();
        if (canEmit()) out += '\t';
        continue;
      }

      if (word === 'emdash') {
        flushHex();
        if (canEmit()) out += '—';
        continue;
      }

      if (word === 'endash') {
        flushHex();
        if (canEmit()) out += '–';
        continue;
      }

      if (word === 'lquote' || word === 'rquote') {
        flushHex();
        if (canEmit()) out += word === 'lquote' ? '‘' : '’';
        continue;
      }

      if (word === 'ldblquote' || word === 'rdblquote') {
        flushHex();
        if (canEmit()) out += word === 'ldblquote' ? '“' : '”';
        continue;
      }

      if (word === 'bullet') {
        flushHex();
        if (canEmit()) out += '•';
        continue;
      }

      continue;
    }

    // Plain character
    flushHex();
    if (skipFallbackChars > 0) {
      skipFallbackChars -= 1;
    } else if (canEmit()) {
      out += ch;
    }
    i += 1;
  }

  flushHex();

  const cleaned = out.trim();
  return isFromHtml ? { html: cleaned, text: '' } : { html: '', text: cleaned };
}
