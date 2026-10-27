# Printing records and exporting lists (0.5)

The two generic features the owner-admin design shows and 0.4 left out (spec 2026-10-25 §8b, CLAUDE.md "Missing from the owner-admin design"). The owner asked to skip the questions; every choice below is the builder's call, made to match how the admin already works.

## Why

A shop owner prints an invoice and a shipping label for an order, and hands a filtered product or order list to an accountant as Excel. Today they copy by hand.

## Goals

- **Print:** a resource declares print templates; a record page offers a button per template, a list selection offers the bulk ones. The browser opens a print-ready page (`@page` size set) and prints it; «Save as PDF» in the print dialog is the PDF.
- **Export:** a resource opts in with `list.export`; the list toolbar gets «خروجی Excel», which downloads an `.xlsx` of the current list: same filters, search, tab, sort, scopes and field permissions as the list itself.
- Both have permission codes (roles can grant them) and leave an audit entry.

## Non-goals

- No server-side PDF engine, no template language: a print template is host code returning HTML.
- No CSV, no import, no background jobs or e-mailed exports.
- No per-record print rules (`@AdminCan`) in 0.5: a template may throw `HttpException` to refuse a record.

## Anti-goals

- An export or a print must never show a value the user could not see in the admin: rows outside their scopes, hidden fields. (Print templates get the whole entity, like actions; the code `<r>.print.<name>` is what lets someone print.)
- Host values must not inject markup into the print page: the `html` helper escapes by default.

## Print

- `@AdminPrint({ label, icon?, paper?, bulk? })` on a resource method `(records: T[], ctx) => string | Promise<string>` returning the body HTML. The method name is the template name; the code is `<resource>.print.<name>` (declared like a custom code, so roles and the role editor see it). `paper`: `'A4' | 'A5' | 'label'` (100×150 mm) or any CSS `@page size` value; default `A4`. Boot checks like actions (name is a word, no clash with base methods or actions).
- `GET /api/resources/:r/print/:name?id=…&id=…` (`bulk` allows up to 100 ids, else exactly one): `view` permission, the code, each record through `findOne` and `requireInScope`, then the method; the answer is an HTML document: `<html lang dir>` in the request's locale, `@page { size; margin: 10mm }`, the admin's font stack, a small toolbar (Print / Close) hidden in print, and `window.print()` on load. Headers: `Cache-Control: no-store`, a CSP that allows only inline style and the page's own script (a nonce) and images from the same origin and `data:`.
- `html` tagged template (escapes interpolations, arrays joined, `raw()` to pass trusted markup) exported from core.
- Audit (when on): one entry per record, event `<resource>.print.<name>` (like an action entry, no changes).
- Schema: `ResourceSchema.prints: { name, label, icon?, bulk }[]` cut to what the user may print; view-as keeps them (printing is a read).
- UI: record header shows a Printer button per template (inside the ⋯ menu when there are more than two); the list selection bar shows bulk templates. Clicking opens the URL in a new tab.

## Export

- `list.export: true | { columns?: string[]; max?: number }`. Columns default to `list.columns` (fields only; computed columns are left out); `max` default 10 000 rows, at most 100 000. Code `<resource>.export`.
- `GET /api/resources/:r/export?<list query>`: `view` + the code; the list query parsed exactly like `GET /api/resources/:r` (anti-oracle rules included); rows read through the resource's `findMany` in pages of 500 (offset), stopping at `max`; columns cut by field permissions; values serialized like the list (relations → titles, `maskReferences`/`maskOutOfScope` applied).
- Cells: numbers, money, decimals and bigints as numbers when they fit a double exactly, else text; booleans as بله/خیر (Yes/No); enums as their labels; dates and date-times as Excel dates (local display format); relations as titles (many: joined with «، »); objects as JSON text. Header row bold, frozen; sheet right-to-left for an RTL locale.
- `.xlsx` written by a small in-house writer (`export/xlsx.ts`: shared-string-free inline strings, one styles part, zip with `deflateRawSync`, CRC-32) — no new dependency.
- Response: `Content-Type` xlsx, `Content-Disposition: attachment; filename="<resource>-<yyyy-mm-dd>.xlsx"`, `Cache-Control: no-store`. When rows were cut at `max`, the header `X-Export-Truncated: <max>` and the UI says so.
- Audit: event `<resource>.export` with the query string and the row count.
- UI: «خروجی Excel» on the list toolbar when `schema.list.export` and the user holds the code; it downloads the current URL's query.

## Left to the builder

File layout, test split, the exact toolbar placement and the CSP string.
