/**
 * The type of a file from its first bytes (spec §8.2). The type a client declares and the extension of its name are
 * never used: they are what an attacker controls. SVG, HTML and scripts are never recognised.
 */

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  [DOCX]: '.docx',
  [XLSX]: '.xlsx',
  'video/mp4': '.mp4',
  'text/plain': '.txt',
};

/** The extension of a sniffed type; empty for anything else. */
export function extensionOf(type: string): string {
  return EXTENSIONS[type] ?? '';
}

const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ']);

const startsWith = (buffer: Buffer, ...bytes: number[]) => bytes.every((byte, index) => buffer[index] === byte);
const ascii = (buffer: Buffer, start: number, end: number) => buffer.toString('latin1', start, end);

/** Markup and script starts that must never be taken for text: the browser could run them if they were ever served inline. */
const MARKUP = /<\s*(?:!doctype|html|head|body|script|style|svg|iframe|object|embed|img|link|meta|math)\b|<\?xml/i;
const SCRIPT = /^\s*(?:["']use strict["']|(?:var|let|const|function|import|export|async|class)\s|\(\s*(?:function|async|\(|\))|(?:alert|eval|fetch|document|window|self|globalThis|console|require)\s*[.(])/;

function textType(buffer: Buffer): string | undefined {
  if (buffer.length === 0) return undefined;
  let text: string;
  try {
    // A cut multi-byte character at the end of the window is fine; anything else invalid is binary.
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.length > 3 ? buffer.subarray(0, trimPartial(buffer)) : buffer);
  } catch {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)) return undefined;
  const body = text.replace(/^﻿/, '');
  if (body.trim() === '') return undefined;
  if (body.trimStart().startsWith('<') || MARKUP.test(body) || SCRIPT.test(body)) return undefined;
  return 'text/plain';
}

/** Length without a UTF-8 sequence cut off by the end of the buffer. */
function trimPartial(buffer: Buffer): number {
  let end = buffer.length;
  for (let back = 1; back <= 3 && back <= end; back++) {
    const byte = buffer[end - back]!;
    if ((byte & 0xc0) === 0x80) continue;
    if (byte >= 0xc0) {
      const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2;
      if (needed > back) end -= back;
    }
    break;
  }
  return end;
}

function zipType(buffer: Buffer): string {
  const names = buffer.toString('latin1');
  if (!names.includes('[Content_Types].xml')) return 'application/zip';
  if (names.includes('word/')) return DOCX;
  if (names.includes('xl/')) return XLSX;
  return 'application/zip';
}

/** The type of the file whose first bytes (a few KB are enough) are `buffer`, or undefined when it is not a supported one. */
export function sniff(buffer: Buffer): string | undefined {
  if (buffer.length === 0) return undefined;
  if (startsWith(buffer, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(buffer, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  const head6 = ascii(buffer, 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(buffer, 4, 8) === 'ftyp') {
    const brand = ascii(buffer, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    return MP4_BRANDS.has(brand) ? 'video/mp4' : undefined;
  }
  if (ascii(buffer, 0, 5) === '%PDF-') return 'application/pdf';
  if (startsWith(buffer, 0x50, 0x4b, 0x03, 0x04)) return zipType(buffer);
  return textType(buffer);
}

/** Whether `type` is allowed by an `accept` list of exact types, `image/` wildcards or a lone star; an empty list allows everything. */
export function accepts(type: string, accept: readonly string[]): boolean {
  if (accept.length === 0) return true;
  const actual = type.toLowerCase();
  return accept.some((raw) => {
    const pattern = raw.trim().toLowerCase();
    if (pattern === '*' || pattern === '*/*') return true;
    if (pattern.endsWith('/*')) return actual.startsWith(pattern.slice(0, -1));
    return actual === pattern;
  });
}
