import { deflateRawSync } from 'node:zlib';

/** One cell: text, a number, a date (shown as a date, or with `time` as a date and time), or empty. */
export type Cell = string | number | { date: Date; time: boolean } | null;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip archive of `files` (deflated), the container of an `.xlsx`. */
export function zip(files: Array<{ name: string; data: Uint8Array }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time and date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(0, 12);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
/** XML text: escaped, and without the control characters XML 1.0 forbids. */
const xml = (text: string): string => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"]/g, (char) => XML_ESCAPES[char]!);

/** `A`, …, `Z`, `AA`, … */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Days since 1899-12-30 (Excel's serial date), in UTC. */
const serial = (date: Date): number => date.getTime() / 86_400_000 + 25569;

/** Excel's cell text limit. */
const MAX_TEXT = 32_767;

function cellXml(cell: Cell, ref: string, header: boolean): string {
  if (cell === null || cell === '') return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? `<c r="${ref}"><v>${cell}</v></c>` : '';
  if (typeof cell === 'string') return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(cell.slice(0, MAX_TEXT))}</t></is></c>`;
  return Number.isNaN(cell.date.getTime()) ? '' : `<c r="${ref}" s="${cell.time ? 3 : 2}"><v>${serial(cell.date)}</v></c>`;
}

/**
 * A one-sheet workbook: the header row bold and frozen, then the rows. `rtl` shows the sheet right to left. Dates
 * are written in UTC (callers shift them to the time they want shown).
 */
export function workbook(input: { sheet: string; header: string[]; rows: Cell[][]; rtl?: boolean }): Buffer {
  const width = input.header.length;
  const rows = [input.header as Cell[], ...input.rows].map((row, r) => {
    const cells = Array.from({ length: width }, (_, c) => cellXml(row[c] ?? null, `${columnName(c)}${r + 1}`, r === 0)).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  });
  const widths = input.header.map((_, c) => `<col min="${c + 1}" max="${c + 1}" width="${columnWidth(input.header[c]!, input.rows.slice(0, 200).map((row) => row[c] ?? null))}" customWidth="1"/>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${input.rtl ? ' rightToLeft="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${width > 0 ? `<cols>${widths}</cols>` : ''}<sheetData>${rows.join('')}</sheetData></worksheet>`;
  const name = xml(input.sheet.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  const text = (value: string) => new TextEncoder().encode(value);
  return zip([
    { name: '[Content_Types].xml', data: text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>') },
    { name: '_rels/.rels', data: text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') },
    { name: 'xl/styles.xml', data: text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>') },
    { name: 'xl/worksheets/sheet1.xml', data: text(sheet) },
  ]);
}

/** A column wide enough for its header and the first rows, between 8 and 60 characters. */
function columnWidth(header: string, cells: Cell[]): number {
  const length = (cell: Cell) => (cell === null ? 0 : typeof cell === 'string' ? cell.length : typeof cell === 'number' ? String(cell).length : cell.time ? 16 : 10);
  return Math.min(60, Math.max(8, header.length + 2, ...cells.map((cell) => length(cell) + 2)));
}
