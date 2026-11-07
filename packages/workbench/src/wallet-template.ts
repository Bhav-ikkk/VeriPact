/**
 * @veripact/workbench v5 wallet templates: QR encoder, pairing ceremony
 * page, and additive UI partials (HTML + CSS + embeddable client JS).
 *
 * The QR encoder below is a REAL, spec-shaped implementation (byte mode,
 * ECC level M, versions 1–6, Reed–Solomon + mask-penalty selection) —
 * verified matrix-for-matrix against the independent `qrcode` reference
 * library (uncommitted scratch oracle, run 14). It stays dependency-free
 * and self-contained (no imports, no closures) so the compiled functions
 * embed verbatim into the browser via `QR_CLIENT_JS`.
 */
import type { PairingSession } from '@veripact/core';

/* ------------------------------------------------------------------ */
/* QR encoder (byte mode, ECC-M, versions 1–6)                          */
/* Self-contained: plain control flow only, so `.toString()` output is  */
/* valid browser JS. Keep every helper nested or standalone-pure.       */
/* ------------------------------------------------------------------ */

/** Decoded QR matrix (row-major, `true` = dark module). */
export interface QrMatrix {
  version: number;
  size: number;
  modules: boolean[][];
}

export function qrEncodeMatrix(text: string): QrMatrix {
  function utf8Bytes(s: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < s.length; i += 1) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const lo = s.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
          i += 1;
        }
      }
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c < 0x10000) {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else {
        out.push(
          0xf0 | (c >> 18),
          0x80 | ((c >> 12) & 0x3f),
          0x80 | ((c >> 6) & 0x3f),
          0x80 | (c & 0x3f),
        );
      }
    }
    return out;
  }

  function gfMul(a: number, b: number, exp: number[], log: number[]): number {
    if (a === 0 || b === 0) {
      return 0;
    }
    return exp[(log[a] ?? 0) + (log[b] ?? 0)] ?? 0;
  }

  function rsRemainder(data: number[], ecLen: number, exp: number[], log: number[]): number[] {
    let gen: number[] = [1];
    for (let i = 0; i < ecLen; i += 1) {
      const next: number[] = [];
      for (let k = 0; k <= gen.length; k += 1) {
        next.push(0);
      }
      for (let j = 0; j < gen.length; j += 1) {
        next[j] = (next[j] ?? 0) ^ (gen[j] ?? 0);
        next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(gen[j] ?? 0, exp[i] ?? 0, exp, log);
      }
      gen = next;
    }
    const res: number[] = data.slice();
    for (let i = 0; i < ecLen; i += 1) {
      res.push(0);
    }
    for (let i = 0; i < data.length; i += 1) {
      const coef = res[i] ?? 0;
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j += 1) {
          res[i + j] = (res[i + j] ?? 0) ^ gfMul(gen[j] ?? 0, coef, exp, log);
        }
      }
    }
    return res.slice(data.length);
  }

  function maskApplies(m: number, x: number, y: number): boolean {
    if (m === 0) {
      return (x + y) % 2 === 0;
    }
    if (m === 1) {
      return y % 2 === 0;
    }
    if (m === 2) {
      return x % 3 === 0;
    }
    if (m === 3) {
      return (x + y) % 3 === 0;
    }
    if (m === 4) {
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    }
    if (m === 5) {
      return (x * y) % 2 + ((x * y) % 3) === 0;
    }
    if (m === 6) {
      return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    }
    return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
  }

  // ECC-M code tables, versions 1–6 (single RS block group each).
  const DATA_CW = [16, 28, 44, 64, 86, 108];
  const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16];
  const NUM_BLOCKS = [1, 1, 1, 2, 2, 4];
  const ALIGN_LAST = [0, 18, 22, 26, 30, 34];
  const bytes = utf8Bytes(text);
  let version = 0;
  for (let v = 1; v <= 6; v += 1) {
    if ((DATA_CW[v - 1] ?? 0) * 8 >= 12 + bytes.length * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    throw new Error('qr: text too long (max 106 bytes at ECC-M v6)');
  }
  const dataCw = DATA_CW[version - 1] ?? 0;
  const ecLen = EC_PER_BLOCK[version - 1] ?? 0;
  const numBlocks = NUM_BLOCKS[version - 1] ?? 1;
  const perBlock = dataCw / numBlocks;

  // Data codewords: mode + count + bytes + terminator + pad.
  const bits: number[] = [];
  function appendBits(val: number, len: number): void {
    for (let i = len - 1; i >= 0; i -= 1) {
      bits.push((val >>> i) & 1);
    }
  }
  appendBits(4, 4);
  appendBits(bytes.length, 8);
  for (let i = 0; i < bytes.length; i += 1) {
    appendBits(bytes[i] ?? 0, 8);
  }
  const capacity = dataCw * 8;
  const termBits = Math.min(4, capacity - bits.length);
  for (let i = 0; i < termBits; i += 1) {
    bits.push(0);
  }
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let w = 0;
    for (let j = 0; j < 8; j += 1) {
      w = (w << 1) | (bits[i + j] ?? 0);
    }
    data.push(w);
  }
  let padByte = 0xec;
  while (data.length < dataCw) {
    data.push(padByte);
    padByte = padByte === 0xec ? 0x11 : 0xec;
  }

  // Galois tables + RS blocks + interleave.
  const exp: number[] = [];
  const log: number[] = [];
  let gx = 1;
  for (let i = 0; i < 255; i += 1) {
    exp.push(gx);
    log[gx] = i;
    gx <<= 1;
    if (gx >= 256) {
      gx ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i += 1) {
    exp.push(exp[i - 255] ?? 0);
  }
  const codewords: number[] = [];
  const ecBlocks: number[][] = [];
  for (let b = 0; b < numBlocks; b += 1) {
    ecBlocks.push(rsRemainder(data.slice(b * perBlock, (b + 1) * perBlock), ecLen, exp, log));
  }
  for (let i = 0; i < perBlock; i += 1) {
    for (let b = 0; b < numBlocks; b += 1) {
      codewords.push(data[b * perBlock + i] ?? 0);
    }
  }
  for (let i = 0; i < ecLen; i += 1) {
    for (let b = 0; b < numBlocks; b += 1) {
      codewords.push(ecBlocks[b]?.[i] ?? 0);
    }
  }

  // Matrix + function patterns.
  const size = version * 4 + 17;
  const modules: boolean[][] = [];
  const isFunc: boolean[][] = [];
  for (let y = 0; y < size; y += 1) {
    const mrow: boolean[] = [];
    const frow: boolean[] = [];
    for (let x = 0; x < size; x += 1) {
      mrow.push(false);
      frow.push(false);
    }
    modules.push(mrow);
    isFunc.push(frow);
  }
  function setFunc(x: number, y: number, dark: boolean): void {
    if (x < 0 || y < 0 || x >= size || y >= size) {
      return;
    }
    const mrow = modules[y];
    const frow = isFunc[y];
    if (mrow === undefined || frow === undefined) {
      return;
    }
    mrow[x] = dark;
    frow[x] = true;
  }
  function reserveFunc(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= size || y >= size) {
      return;
    }
    const frow = isFunc[y];
    if (frow !== undefined) {
      frow[x] = true;
    }
  }
  for (let i = 0; i < size; i += 1) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }
  const finderCenters = [3, size - 4];
  for (let ci = 0; ci < finderCenters.length; ci += 1) {
    for (let cj = 0; cj < finderCenters.length; cj += 1) {
      if (ci === 1 && cj === 1) {
        continue;
      }
      const cx = finderCenters[ci] ?? 0;
      const cy = finderCenters[cj] ?? 0;
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFunc(cx + dx, cy + dy, dist !== 2 && dist !== 4);
        }
      }
    }
  }
  if (version >= 2) {
    const c = ALIGN_LAST[version - 1] ?? 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setFunc(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  // Reserve format info (drawn after masking) + dark module at (8, 4V+9).
  for (let i = 0; i <= 5; i += 1) {
    reserveFunc(8, i);
  }
  reserveFunc(8, 7);
  reserveFunc(8, 8);
  reserveFunc(7, 8);
  for (let i = 9; i < 15; i += 1) {
    reserveFunc(14 - i, 8);
  }
  for (let i = 0; i < 8; i += 1) {
    reserveFunc(size - 1 - i, 8);
  }
  for (let i = 8; i < 15; i += 1) {
    reserveFunc(8, size - 15 + i);
  }
  reserveFunc(8, version * 4 + 9);

  // Data placement zigzag (unmasked; remainder bits stay light).
  const totalBits = codewords.length * 8;
  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const frow = isFunc[y];
        const mrow = modules[y];
        if (frow !== undefined && mrow !== undefined && frow[x] !== true && bitIdx < totalBits) {
          const w = codewords[bitIdx >>> 3] ?? 0;
          mrow[x] = ((w >>> (7 - (bitIdx & 7))) & 1) === 1;
          bitIdx += 1;
        }
      }
    }
  }

  // Mask penalty evaluation (N1–N4), keep the best of 8.
  function cellOf(grid: boolean[][], x: number, y: number): boolean {
    return grid[y]?.[x] === true;
  }
  function penaltyOf(grid: boolean[][]): number {
    let pen = 0;
    for (let y = 0; y < size; y += 1) {
      let run = 1;
      let prev = cellOf(grid, 0, y);
      for (let x = 1; x < size; x += 1) {
        const cur = cellOf(grid, x, y);
        if (cur === prev) {
          run += 1;
        } else {
          if (run >= 5) {
            pen += 3 + (run - 5);
          }
          run = 1;
          prev = cur;
        }
      }
      if (run >= 5) {
        pen += 3 + (run - 5);
      }
    }
    for (let x = 0; x < size; x += 1) {
      let run = 1;
      let prev = cellOf(grid, x, 0);
      for (let y = 1; y < size; y += 1) {
        const cur = cellOf(grid, x, y);
        if (cur === prev) {
          run += 1;
        } else {
          if (run >= 5) {
            pen += 3 + (run - 5);
          }
          run = 1;
          prev = cur;
        }
      }
      if (run >= 5) {
        pen += 3 + (run - 5);
      }
    }
    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const a = cellOf(grid, x, y);
        if (a === cellOf(grid, x + 1, y) && a === cellOf(grid, x, y + 1) && a === cellOf(grid, x + 1, y + 1)) {
          pen += 3;
        }
      }
    }
    const patA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x + 10 < size; x += 1) {
        let fwd = true;
        let rev = true;
        for (let k = 0; k < 11; k += 1) {
          const bit = cellOf(grid, x + k, y) ? 1 : 0;
          if (bit !== (patA[k] ?? 0)) {
            fwd = false;
          }
          if (bit !== (patA[10 - k] ?? 0)) {
            rev = false;
          }
        }
        if (fwd || rev) {
          pen += 40;
        }
      }
    }
    for (let x = 0; x < size; x += 1) {
      for (let y = 0; y + 10 < size; y += 1) {
        let fwd = true;
        let rev = true;
        for (let k = 0; k < 11; k += 1) {
          const bit = cellOf(grid, x, y + k) ? 1 : 0;
          if (bit !== (patA[k] ?? 0)) {
            fwd = false;
          }
          if (bit !== (patA[10 - k] ?? 0)) {
            rev = false;
          }
        }
        if (fwd || rev) {
          pen += 40;
        }
      }
    }
    let dark = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (cellOf(grid, x, y)) {
          dark += 1;
        }
      }
    }
    const total = size * size;
    pen += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return pen;
  }
  let bestMask = 0;
  let bestPenalty = -1;
  let best: boolean[][] = modules;
  for (let m = 0; m < 8; m += 1) {
    const trial: boolean[][] = [];
    for (let y = 0; y < size; y += 1) {
      const trow: boolean[] = [];
      for (let x = 0; x < size; x += 1) {
        const dark = cellOf(modules, x, y);
        const func = isFunc[y]?.[x] === true;
        trow.push(func ? dark : dark !== maskApplies(m, x, y));
      }
      trial.push(trow);
    }
    const pen = penaltyOf(trial);
    if (bestPenalty < 0 || pen < bestPenalty) {
      bestPenalty = pen;
      bestMask = m;
      best = trial;
    }
  }

  // Format info: BCH(15,5) over (ECC-M=00 + mask), XOR 0x5412.
  let fmtDiv = bestMask << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if (((fmtDiv >>> i) & 1) === 1) {
      fmtDiv ^= 0x537 << (i - 10);
    }
  }
  const fmtCode = ((bestMask << 10) | (fmtDiv & 0x3ff)) ^ 0x5412;
  function fmtBit(i: number): boolean {
    return ((fmtCode >>> i) & 1) === 1;
  }
  function setFinal(x: number, y: number, dark: boolean): void {
    const frow = best[y];
    if (frow !== undefined && x >= 0 && y >= 0 && x < size && y < size) {
      frow[x] = dark;
    }
  }
  for (let i = 0; i <= 5; i += 1) {
    setFinal(8, i, fmtBit(i));
  }
  setFinal(8, 7, fmtBit(6));
  setFinal(8, 8, fmtBit(7));
  setFinal(7, 8, fmtBit(8));
  for (let i = 9; i < 15; i += 1) {
    setFinal(14 - i, 8, fmtBit(i));
  }
  for (let i = 0; i < 8; i += 1) {
    setFinal(size - 1 - i, 8, fmtBit(i));
  }
  for (let i = 8; i < 15; i += 1) {
    setFinal(8, size - 15 + i, fmtBit(i));
  }
  setFinal(8, version * 4 + 9, true);
  return { version, size, modules: best };
}

/** Render a QR matrix as a crisp SVG (4-module quiet zone included). */
export function qrMatrixToSvg(matrix: QrMatrix, px: number): string {
  const quiet = 4;
  const extent = matrix.size + quiet * 2;
  let d = '';
  for (let y = 0; y < matrix.size; y += 1) {
    const row = matrix.modules[y];
    if (row === undefined) {
      continue;
    }
    for (let x = 0; x < matrix.size; x += 1) {
      if (row[x] === true) {
        d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
      }
    }
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    px +
    '" height="' +
    px +
    '" viewBox="0 0 ' +
    extent +
    ' ' +
    extent +
    '" shape-rendering="crispEdges" role="img" aria-label="Pairing QR code">' +
    '<rect width="' +
    extent +
    '" height="' +
    extent +
    '" fill="#ffffff"/>' +
    '<path d="' +
    d +
    '" fill="#101828"/></svg>'
  );
}

/**
 * Browser-embeddable QR encoder source: the compiled functions above,
 * serialized verbatim (they are self-contained — no imports/closures).
 * Evaluated by unit tests in `node:vm` for parity with direct calls.
 */
export const QR_CLIENT_JS: string =
  qrEncodeMatrix.toString() + '\n' + qrMatrixToSvg.toString() + '\n';

/* ------------------------------------------------------------------ */
/* HTML escaping (server-side partials)                                 */
/* ------------------------------------------------------------------ */

function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ */
/* Additive workbench UI: wallet CSS + HTML partials (editorial tokens)  */
/* ------------------------------------------------------------------ */

/**
 * Wallet component CSS. Strictly additive: new selectors only, existing
 * rules untouched. Every flex/grid child carries `min-width:0`, wide
 * content scrolls inside its own shell — zero page-level overflow at
 * 1600×900 / 1366×768 / 1050×800 / 768×1024.
 */
export const WALLET_CSS = [
  '#wallet-card{padding:14px 20px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-card);box-shadow:var(--shadow-card)}',
  '.wallet-grid{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:20px;align-items:start}',
  '.wallet-qr{display:flex;gap:14px;align-items:flex-start;min-width:0}',
  '#qr-svg-box{width:76px;height:76px;flex-shrink:0;border:1px solid var(--border-subtle);border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden}',
  '#qr-svg-box svg{display:block}',
  '.qr-meta{min-width:0;flex:1;display:flex;flex-direction:column;gap:6px}',
  '#pair-code{font-family:var(--font-mono);font-size:20px;font-weight:650;letter-spacing:.18em;font-variant-numeric:tabular-nums}',
  '.pair-btns{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
  '.pair-btns .btn{font-size:12px;min-height:34px;padding:6px 14px;font-weight:600}',
  '.part-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:10px 0}',
  '.part-metrics>div{min-width:0}',
  '.part-metrics b{display:block;font-size:22px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums}',
  '.part-metrics span{font-size:12px;color:var(--text-muted)}',
  '#part-available[data-state="healthy"]{color:var(--status-success-ink)}',
  '#part-available[data-state="low"]{color:var(--status-warn-ink)}',
  '#part-available[data-state="wall"]{color:var(--status-danger-ink)}',
  '.part-track{height:10px;border-radius:5px;background:var(--bg-subtle);border:1px solid var(--border-subtle);overflow:hidden}',
  '#part-progress-fill{display:block;height:100%;width:0;background:var(--status-success-solid)}',
  '#part-progress-fill[data-state="low"]{background:var(--status-warn-ink)}',
  '#part-progress-fill[data-state="wall"]{background:var(--status-danger-ink)}',
  '.part-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center}',
  '.part-actions .btn{font-size:12px;min-height:34px;padding:6px 14px;font-weight:600}',
  '#part-cap-input{font:inherit;font-size:13px;padding:6px 10px;border:1px solid var(--border-strong);border-radius:8px;width:110px;font-variant-numeric:tabular-nums}',
  '#connectors-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-bottom:12px}',
  '.conn-card{border:1px solid var(--border-subtle);border-radius:10px;padding:12px 14px;min-width:0;background:var(--bg-muted)}',
  '.conn-card h3{margin:0 0 4px;font-size:13.5px}',
  '.conn-card p{margin:0 0 8px;font-size:12.5px;color:var(--text-secondary)}',
  '.conn-card .btn{font-size:12px;min-height:32px;padding:5px 12px}',
  '.conn-out{margin:8px 0 0}',
  '.sync-scroll{overflow-x:auto;max-width:100%;border:1px solid var(--border-subtle);border-radius:12px;background:#fff}',
  '.sync-note{border:1px solid var(--status-warn-border);background:var(--status-warn-bg);color:var(--status-warn-ink);border-radius:10px;padding:9px 14px;font-size:12.5px;font-weight:600;margin:0 0 12px}',
  '@media (max-width:960px){.wallet-grid{grid-template-columns:minmax(0,1fr)}#connectors-row{grid-template-columns:minmax(0,1fr)}.part-metrics{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}',
  '#rb-partition{display:inline-block;margin-top:6px;max-width:100%;white-space:normal;overflow-wrap:anywhere}',
].join('\n');

/** View 1 Agentic Wallet card: QR pairing (left) + partition bar (right). */
export function walletCardHtml(): string {
  return [
    '<div class="card" id="wallet-card">',
    '<div class="card-head"><h2>Agentic Wallet &amp; Partition Enforcer</h2><span class="pill pill-info" id="wallet-net-pill">Deterministic demo wallet</span></div>',
    '<div class="wallet-grid">',
    '<div id="qr-connect-box">',
    '<h3>Phone QR Account Pairing</h3>',
    '<div class="wallet-qr"><div id="qr-svg-box" aria-label="Pairing QR code"><span class="status-line" style="font-size:11px;text-align:center">No session yet</span></div>',
    '<div class="qr-meta"><div id="pair-code" aria-label="6-digit pairing code">······</div>',
    '<div><span class="pill pill-info" id="pair-status-pill">Not paired</span></div>',
    '<div class="pair-btns"><button type="button" class="btn" id="btn-pair-start">Start QR Pair</button><a class="btn" id="btn-pair-approve" href="#" target="_blank" rel="noopener" aria-disabled="true" style="text-decoration:none">Approve / Open Mobile Ceremony</a></div>',
    '</div></div>',
    '<p class="status-line" id="pair-status" aria-live="polite"></p>',
    '</div>',
    '<div id="partition-bar-box">',
    '<h3>Partitioned Sub-Balance Enforcer</h3>',
    '<div class="part-metrics"><div><b id="part-allocated">$350.00</b><span>Allocated Cap</span></div><div><b id="part-captured">$0.00</b><span>Net Used (Active)</span></div><div><b id="part-available" data-state="healthy">$350.00</b><span>Available for Agents</span></div></div>',
    '<div class="part-track" role="progressbar" aria-label="Partition used vs remaining"><i id="part-progress-fill"></i></div>',
    '<div class="part-actions"><button type="button" class="btn btn-primary" id="btn-part-spend">Agent Spend ($297 via Partition)</button><button type="button" class="btn" id="btn-part-refund">Undo / Refund Last Capture (+$297)</button><label class="skip" for="part-cap-input">Partition cap USD</label><input id="part-cap-input" type="number" min="1" step="0.01" value="350"><button type="button" class="btn" id="btn-part-config">Set $350 Partition</button></div>',
    '<p class="status-line" id="part-status" aria-live="polite"></p>',
    '</div>',
    '</div>',
    '</div>',
  ].join('');
}

/** View 2 connectors strip: ChatGPT card + Claude/Cursor card. */
export function connectorsRowHtml(): string {
  return [
    '<div id="connectors-row">',
    '<div class="conn-card" id="card-conn-chatgpt"><h3>ChatGPT / OpenAI GPT Actions</h3><p>OpenAPI 3.1 Spec: <span class="mono">GET /openapi.json</span> · scoped Bearer&#32;token</p><button type="button" class="btn btn-primary" id="btn-mint-chatgpt">Mint ChatGPT Bearer&#32;token</button><pre class="mono-scroll conn-out" id="chatgpt-token-out" hidden></pre></div>',
    '<div class="conn-card" id="card-conn-mcp"><h3>Claude &amp; Cursor MCP</h3><p>Stdio MCP: <span class="mono">npx @veripact/mcp-server</span> (7 tools)</p><button type="button" class="btn btn-primary" id="btn-mint-mcp">Mint Claude/Cursor Token</button><pre class="mono-scroll conn-out" id="mcp-token-out" hidden></pre></div>',
    '</div>',
  ].join('');
}

/** View 2 sync shell: disclosure banner + comparison table mount point. */
export function syncShellHtml(): string {
  return [
    '<div class="ag-shell" id="sync-shell" hidden>',
    '<div style="padding:14px 16px"><p class="sync-note">PayPal Transaction Search has up to a 3-hour indexing delay; real-time partition balance is enforced by the VeriPact Clearing Ledger.</p>',
    '<div id="ag-sync-payments-grid" class="ag-theme-quartz" style="height: 360px; width: 100%; margin-bottom: 12px;"></div>',
    '<div id="sync-table-wrap"><div id="sync-body"><p class="status-line">Loading synced payments…</p></div></div></div>',
    '</div>',
  ].join('');
}

/* ------------------------------------------------------------------ */
/* Phone pairing ceremony page (GET /pair/:sessionId)                   */
/* ------------------------------------------------------------------ */

/** Payer account shown on the ceremony page (sandbox buyer identity). */
export const PAIRING_PAYER_EMAIL = 'buyer-vault@sandbox.paypal.com';

/** Default partition terms shown on the ceremony page. */
export const PAIRING_PARTITION_TERMS = {
  totalCapUsd: 350,
  perOrderLimitUsd: 320,
  witnessNote: 'Automatic 3-Rung SELF -> WIT -> SIGN Witness Protection',
} as const;

/**
 * Standalone mobile approval page. Zero dependencies, responsive light
 * editorial styling, 1-tap approve → POST pair/approve → green connected
 * state + same-origin `VERIPACT_WALLET_PAIRED` postMessage to the opener.
 */
export function renderPairPage(session: PairingSession): string {
  const approved = session.status === 'APPROVED';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VeriPact Wallet — Phone QR Pairing Ceremony</title>
<style>
:root{--ink:#1a2332;--muted:#3d4a5c;--line:#d5dbe3;--bg:#e7ebf0;--card:#ffffff;--blue:#1a2332;--green:#0f6e56;--green-bg:#e7f6f1;--green-bd:#b7e0d2}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Segoe UI",system-ui,sans-serif}
.wrap{max-width:480px;margin:0 auto;padding:28px 16px 48px}
.brand{display:flex;align-items:center;gap:10px;margin:0 0 16px}
.brand h1{font-family:"Palatino Linotype",Palatino,Georgia,serif;font-size:22px;font-weight:600;margin:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px}
.card h2{margin:0 0 4px;font-size:17px;font-weight:650}
.sub{margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.45}
.kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;font-size:13.5px;margin:12px 0}
.kv dt{color:var(--muted)}.kv dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
.code{font-family:ui-monospace,Consolas,monospace;font-size:28px;font-weight:650;letter-spacing:.22em;text-align:center;margin:8px 0 2px;font-variant-numeric:tabular-nums}
.terms{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-size:13px;margin:12px 0;line-height:1.45}
.terms b{display:block;margin-bottom:2px}
.btn{display:block;width:100%;border:0;border-radius:8px;background:var(--blue);color:#fff;font-size:15px;font-weight:650;padding:13px;cursor:pointer;font-family:inherit;margin-top:14px}
.btn:disabled{opacity:.55;cursor:default}
.done{background:var(--green-bg);border:1px solid var(--green-bd);border-radius:8px;padding:14px;text-align:center;color:var(--green);font-weight:650;font-size:15px;margin-top:14px}
#pair-status{margin-top:10px;font-size:13px;color:var(--muted);text-align:center;min-height:20px}
.fine{font-size:12px;color:var(--muted);margin-top:14px;text-align:center;line-height:1.4}
</style></head><body>
<main class="wrap">
<div class="brand"><svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="6" fill="#1a2332"/><path d="M7 13.2l3.2 3.2L19 8.6" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><h1>VeriPact Wallet</h1></div>
<div class="card">
<h2>Phone QR Pairing Ceremony</h2>
<p class="sub">Approve on this phone to link the PayPal sandbox account and initialize the agentic partition.</p>
<div class="code" id="pair-code">${escHtml(session.pairingCode)}</div>
<dl class="kv">
<dt>Session</dt><dd class="mono">${escHtml(session.sessionId)}</dd>
<dt>Payer</dt><dd class="mono">${escHtml(PAIRING_PAYER_EMAIL)}</dd>
<dt>Expires</dt><dd>${escHtml(session.expiresAtUtc)}</dd>
</dl>
<div class="terms"><b>Default Agentic Partition to initialize</b>$${PAIRING_PARTITION_TERMS.totalCapUsd.toFixed(2)} total cap · $${PAIRING_PARTITION_TERMS.perOrderLimitUsd.toFixed(2)} per-order limit · ${escHtml(PAIRING_PARTITION_TERMS.witnessNote)}</div>
<div id="pair-action">${approved ? `<div class="done">Connected! Desktop Workbench Updated</div>` : `<button type="button" class="btn" id="btn-pair-ok">Approve &amp; Link PayPal Account</button><p id="pair-status" role="status" aria-live="polite"></p>`}</div>
<p class="fine">Timestamps prove hash existence at time T plus witness observation — never content truth.</p>
</div>
</main>
<script>
(function(){
var sessionId=${JSON.stringify(session.sessionId)};
var payerEmail=${JSON.stringify(PAIRING_PAYER_EMAIL)};
var btn=document.getElementById('btn-pair-ok');
if(!btn){return;}
btn.addEventListener('click',function(){
btn.disabled=true;
var st=document.getElementById('pair-status');
if(st){st.textContent='Linking PayPal account…';}
fetch('/api/wallet/pair/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:sessionId,payerEmail:payerEmail})}).then(function(r){return r.json().then(function(j){if(!r.ok){throw new Error(j.error||('HTTP '+r.status));}return j;});}).then(function(){
document.getElementById('pair-action').innerHTML='<div class="done">Connected! Desktop Workbench Updated</div>';
try{
if(window.opener&&!window.opener.closed){
var loc=window.location;var targetOrigin=loc.origin||(loc.protocol+'//'+loc.host);
window.opener.postMessage({type:'VERIPACT_WALLET_PAIRED',sessionId:sessionId},targetOrigin);
}
}catch(e){/* opener notify is best-effort */}
},function(e){btn.disabled=false;if(st){st.textContent=e.message;}});
});
})();
</script>
</body></html>`;
}
