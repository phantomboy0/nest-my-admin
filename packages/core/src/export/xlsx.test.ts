import { describe, expect, test } from 'bun:test';
import { inflateRawSync } from 'node:zlib';
import { columnName, crc32, workbook } from './xlsx.js';

/** The files of a zip written by `zip` (no data descriptors, no zip64). */
function unzip(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const size = buffer.readUInt32LE(at + 18);
    const nameLength = buffer.readUInt16LE(at + 26);
    const name = buffer.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const data = inflateRawSync(buffer.subarray(at + 30 + nameLength, at + 30 + nameLength + size));
    expect(crc32(data)).toBe(buffer.readUInt32LE(at + 14));
    files.set(name, data.toString('utf8'));
    at += 30 + nameLength + size;
  }
  return files;
}

describe('xlsx', () => {
  test('crc32 and column names', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  test('a workbook: header, text escaped, numbers, dates, empty cells, rtl', () => {
    const files = unzip(workbook({ sheet: 'سفارش/ها', header: ['نام', 'مبلغ', 'تاریخ'], rows: [['<a&b>', 1200.5, { date: new Date('2026-10-01T00:00:00Z'), time: false }], [null, 3, null]], rtl: true }));
    expect([...files.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">نام</t></is></c>');
    expect(sheet).toContain('<t xml:space="preserve">&lt;a&amp;b&gt;</t>');
    expect(sheet).toContain('<c r="B2"><v>1200.5</v></c>');
    expect(sheet).toContain('<c r="C2" s="2"><v>46296</v></c>');
    expect(sheet).toContain('<row r="3"><c r="B3"><v>3</v></c></row>');
    expect(files.get('xl/workbook.xml')).toContain('name="سفارش ها"');
  });
});
