import { describe, expect, test } from 'bun:test';
import { accepts, extensionOf, sniff } from './sniff.js';

const bytes = (...values: Array<number | string>) =>
  Buffer.concat(values.map((value) => (typeof value === 'number' ? Buffer.from([value]) : Buffer.from(value, 'latin1'))));
const pad = (buffer: Buffer, size = 64) => Buffer.concat([buffer, Buffer.alloc(Math.max(0, size - buffer.length))]);

describe('sniff', () => {
  test('recognises the supported types by their magic numbers', () => {
    expect(sniff(pad(bytes(0xff, 0xd8, 0xff, 0xe0)))).toBe('image/jpeg');
    expect(sniff(pad(bytes(0x89, 'PNG\r\n', 0x1a, '\n')))).toBe('image/png');
    expect(sniff(pad(bytes('GIF89a')))).toBe('image/gif');
    expect(sniff(pad(bytes('GIF87a')))).toBe('image/gif');
    expect(sniff(pad(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 ')))).toBe('image/webp');
    expect(sniff(pad(bytes(0, 0, 0, 0x1c, 'ftypavif')))).toBe('image/avif');
    expect(sniff(pad(bytes(0, 0, 0, 0x18, 'ftypisom')))).toBe('video/mp4');
    expect(sniff(pad(bytes(0, 0, 0, 0x18, 'ftypmp42')))).toBe('video/mp4');
    expect(sniff(pad(bytes('%PDF-1.7\n')))).toBe('application/pdf');
  });

  test('tells docx, xlsx and plain zip apart', () => {
    const zip = (name: string) => pad(Buffer.concat([bytes('PK', 3, 4), Buffer.alloc(26), Buffer.from(name)]), 200);
    const zipWith = (...names: string[]) => Buffer.concat(names.map((name) => zip(name)));
    expect(sniff(zipWith('[Content_Types].xml', 'word/document.xml'))).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(sniff(zipWith('[Content_Types].xml', 'xl/workbook.xml'))).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(sniff(zipWith('a.txt', 'b.txt'))).toBe('application/zip');
    expect(sniff(zipWith('[Content_Types].xml', 'other.xml'))).toBe('application/zip');
  });

  test('plain text is text/plain, including UTF-8', () => {
    expect(sniff(Buffer.from('hello world\nsecond line\n'))).toBe('text/plain');
    expect(sniff(Buffer.from('سلام دنیا'))).toBe('text/plain');
    expect(sniff(Buffer.from('id,name\n1,Ada\n'))).toBe('text/plain');
  });

  test('markup, scripts, binary junk and empty buffers are not recognised', () => {
    expect(sniff(Buffer.from('<!DOCTYPE html><html><body>hi</body></html>'))).toBeUndefined();
    expect(sniff(Buffer.from('  <html><script>alert(1)</script></html>'))).toBeUndefined();
    expect(sniff(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeUndefined();
    expect(sniff(Buffer.from('<svg onload="alert(1)"/>'))).toBeUndefined();
    expect(sniff(Buffer.from('﻿<svg/>'))).toBeUndefined();
    expect(sniff(Buffer.from('alert(document.cookie);'))).toBeUndefined();
    expect(sniff(Buffer.from('(function () { fetch("/x") })()'))).toBeUndefined();
    expect(sniff(Buffer.from('const a = 1;\nexport default a;'))).toBeUndefined();
    expect(sniff(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]))).toBeUndefined();
    expect(sniff(Buffer.alloc(0))).toBeUndefined();
  });

  test('extensionOf maps sniffed types to extensions', () => {
    expect(extensionOf('image/jpeg')).toBe('.jpg');
    expect(extensionOf('application/pdf')).toBe('.pdf');
    expect(extensionOf('text/plain')).toBe('.txt');
    expect(extensionOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('.docx');
  });
});

describe('accepts', () => {
  test('matches exact types, type wildcards and */*', () => {
    expect(accepts('image/png', ['image/*'])).toBe(true);
    expect(accepts('image/png', ['image/png', 'application/pdf'])).toBe(true);
    expect(accepts('application/pdf', ['image/*'])).toBe(false);
    expect(accepts('image/png', ['*'])).toBe(true);
    expect(accepts('application/pdf', ['*/*'])).toBe(true);
    expect(accepts('IMAGE/PNG', ['image/*'])).toBe(true);
    expect(accepts('image/png', [])).toBe(true);
    expect(accepts('video/mp4', ['image/*', ' video/* '])).toBe(true);
  });
});
