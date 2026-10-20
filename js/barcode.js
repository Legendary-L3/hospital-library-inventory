/**
 * barcode.js
 * ---------------------------------------------------------------------------
 * Dependency-free barcode generator that renders barcodes as inline SVG.
 *
 * Two symbologies are supported. Both are read by essentially every
 * off-the-shelf USB/Bluetooth barcode scanner:
 *
 *   - CODE 128 (subset B)  - default. Compact, full ASCII, built-in checksum.
 *   - CODE 39              - older, longer, but extremely tolerant of cheap
 *                            scanners and low-quality printers. Uppercase
 *                            letters, digits and "- . $ / + % space" only.
 *
 * The admin can switch symbology in Settings. If scanners at your site
 * struggle to read labels, try the other symbology first and then increase
 * the "Bar width" setting (also in Settings) before changing printers.
 *
 * Public API (all pure functions, no DOM access):
 *   Barcode.svg(text, options)        -> SVG markup string
 *   Barcode.encode(text, symbology)   -> array of {bar: boolean, width: number}
 *   Barcode.isEncodable(text, symb)   -> boolean
 *   Barcode.selfTest()                -> throws if the pattern tables are corrupt
 *
 * `options` for svg():
 *   symbology  'code128' | 'code39'      (default 'code128')
 *   moduleWidth  width of one narrow bar in SVG units (default 2)
 *   height       bar height in SVG units (default 60)
 *   showText     print the human-readable text under the bars (default true)
 *   fontSize     text size in SVG units (default 14)
 *   quietZone    blank modules left/right of the bars (default 10)
 *
 * The returned SVG uses a viewBox, so it scales to whatever CSS width the
 * surrounding label gives it while keeping the bar ratios exact.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /* =========================================================================
   * CODE 128
   * -------------------------------------------------------------------------
   * Each symbol is 6 elements (bar, space, bar, space, bar, space) whose widths
   * add up to 11 modules. The table index is the symbol *value* (0..106).
   * Values 0..94 correspond to ASCII 32..126 in subset B. 103/104/105 are the
   * three start codes and 106 is the stop pattern (7 elements, 13 modules).
   * ======================================================================= */
  const CODE128_PATTERNS = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
  ];
  const CODE128_START_B = 104;
  const CODE128_STOP = 106;

  /**
   * Encode `text` with Code 128 subset B.
   * @returns {Array<{bar:boolean,width:number}>} sequence of elements
   */
  function encodeCode128(text) {
    const values = [];
    for (const ch of String(text)) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) {
        throw new Error(`Code 128 subset B cannot encode character "${ch}" (code ${code}).`);
      }
      values.push(code - 32);
    }
    if (values.length === 0) throw new Error('Cannot encode an empty barcode.');

    // Checksum: start value + sum(position * value), modulo 103.
    let checksum = CODE128_START_B;
    values.forEach((v, i) => { checksum += v * (i + 1); });
    checksum %= 103;

    const symbols = [CODE128_START_B, ...values, checksum, CODE128_STOP];
    const elements = [];
    for (const symbol of symbols) {
      const pattern = CODE128_PATTERNS[symbol];
      for (let i = 0; i < pattern.length; i++) {
        elements.push({ bar: i % 2 === 0, width: Number(pattern[i]) });
      }
    }
    return elements;
  }

  /* =========================================================================
   * CODE 39
   * -------------------------------------------------------------------------
   * Each character is 9 elements (5 bars + 4 spaces, starting with a bar).
   * 'n' = narrow, 'w' = wide. Exactly three elements per character are wide.
   * Characters are separated by one narrow space; the whole code is wrapped
   * in the '*' start/stop character.
   * ======================================================================= */
  const CODE39_PATTERNS = {
    '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
    '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
    'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn',
    'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
    'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn',
    'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
    'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn',
    'Z': 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
    '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
  };
  const CODE39_WIDE_RATIO = 3; // Wide elements are 3x narrow (spec allows 2.0-3.0; 3 scans best).

  /**
   * Encode `text` with Code 39. Lower-case letters are upper-cased because
   * Code 39 has no lower-case characters.
   */
  function encodeCode39(text) {
    const upper = String(text).toUpperCase();
    if (upper.length === 0) throw new Error('Cannot encode an empty barcode.');
    for (const ch of upper) {
      if (!(ch in CODE39_PATTERNS) || ch === '*') {
        throw new Error(`Code 39 cannot encode character "${ch}".`);
      }
    }
    const chars = `*${upper}*`;
    const elements = [];
    for (let c = 0; c < chars.length; c++) {
      const pattern = CODE39_PATTERNS[chars[c]];
      for (let i = 0; i < pattern.length; i++) {
        elements.push({ bar: i % 2 === 0, width: pattern[i] === 'w' ? CODE39_WIDE_RATIO : 1 });
      }
      // Inter-character gap (a narrow space) between characters, not after the last one.
      if (c < chars.length - 1) elements.push({ bar: false, width: 1 });
    }
    return elements;
  }

  /* =========================================================================
   * Public helpers
   * ======================================================================= */

  /** Encode text into an element list for the chosen symbology. */
  function encode(text, symbology) {
    return symbology === 'code39' ? encodeCode39(text) : encodeCode128(text);
  }

  /** True when `text` can be represented in the chosen symbology. */
  function isEncodable(text, symbology) {
    try { encode(text, symbology); return true; } catch (e) { return false; }
  }

  /** Escape text for safe inclusion inside SVG/HTML markup. */
  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * Render a barcode as an SVG string. See file header for option details.
   * The SVG has no fixed width/height attributes; size it with CSS.
   */
  function svg(text, options) {
    const opts = Object.assign({
      symbology: 'code128',
      moduleWidth: 2,
      height: 60,
      showText: true,
      fontSize: 14,
      quietZone: 10,
    }, options || {});

    const elements = encode(text, opts.symbology);
    const totalModules = elements.reduce((sum, el) => sum + el.width, 0) + opts.quietZone * 2;
    const width = totalModules * opts.moduleWidth;
    const textHeight = opts.showText ? opts.fontSize * 1.6 : 0;
    const height = opts.height + textHeight;

    let x = opts.quietZone * opts.moduleWidth;
    const rects = [];
    for (const el of elements) {
      const w = el.width * opts.moduleWidth;
      if (el.bar) {
        rects.push(`<rect x="${x}" y="0" width="${w}" height="${opts.height}" fill="#000"/>`);
      }
      x += w;
    }

    const label = opts.showText
      ? `<text x="${width / 2}" y="${opts.height + opts.fontSize * 1.15}" text-anchor="middle" ` +
        `font-family="'Courier New', Courier, monospace" font-size="${opts.fontSize}" fill="#000">${escapeXml(text)}</text>`
      : '';

    // shape-rendering="crispEdges" keeps bar edges sharp when printed; preserveAspectRatio
    // keeps the bar/space ratios exact if the SVG is scaled non-uniformly by CSS.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
      `preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" role="img" ` +
      `aria-label="Barcode ${escapeXml(text)}" class="barcode-svg">` +
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>${rects.join('')}${label}</svg>`;
  }

  /**
   * Sanity-check the pattern tables. Every Code 128 symbol must be 11 modules
   * wide (stop = 13); every Code 39 character must have exactly 3 wide elements.
   * Called once at start-up by app.js; a thrown error means the tables above
   * were edited incorrectly.
   */
  function selfTest() {
    CODE128_PATTERNS.forEach((p, i) => {
      const sum = p.split('').reduce((a, d) => a + Number(d), 0);
      const expected = i === CODE128_STOP ? 13 : 11;
      if (sum !== expected) throw new Error(`Code 128 pattern ${i} ("${p}") sums to ${sum}, expected ${expected}.`);
    });
    if (CODE128_PATTERNS.length !== 107) throw new Error('Code 128 table must have 107 entries.');
    Object.entries(CODE39_PATTERNS).forEach(([ch, p]) => {
      const wide = p.split('').filter((c) => c === 'w').length;
      if (p.length !== 9 || wide !== 3) throw new Error(`Code 39 pattern for "${ch}" is invalid.`);
    });
    // Known-answer check for the checksum computation.
    const probe = encodeCode128('LIB000001');
    if (probe.length !== 6 * 11 + 7) throw new Error('Code 128 element count is wrong.');
    return true;
  }

  global.Barcode = { svg, encode, isEncodable, selfTest };
})(window);
