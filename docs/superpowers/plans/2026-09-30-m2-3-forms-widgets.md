# M2-3 — Forms and Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forms become configurable and pleasant:
- per-field labels, help, placeholders and enum value labels in every language;
- a widget per field: money, switch, radio, textarea, password, color, JSON with a format button, slug, and a badge for display;
- read-only fields, including per-record `readonlyIf` enforced on the server;
- live `showIf`;
- layout sections, tabs and columns;
- a detail header with title, badges and external links;
- an unsaved-changes guard, ⌘/Ctrl+S, Duplicate, and Save & new.

**Architecture:**
- **Field config.** Three sources are merged in the spec §5.3 resolution order: TypeORM → DTO → `@AdminField()` on the entity → `@AdminField()` on the DTO → the resource's `fields` config.
  - Static options (labels, help, widget, enum labels, colours, `showIf`, `readonly`, `slugFrom`, …) become schema properties.
  - Localized texts stay raw in the registry and are resolved per request, like resource labels.
  - Function options (`readonlyIf`) stay on the server: each record carries `_readonly` (the fields locked for it), and PATCH refuses to change them.
- **Layout.** `form.layout` (sections with columns, grouped into tabs) is validated at boot: every name exists and is on a form, and nothing is listed twice.
- **Links.** `links(record)` on the resource gives each record `_links` for the detail header.
- **UI.** A widget registry maps a field to its input. `showIf` is evaluated in the browser on the current values: hidden fields are not sent. The server leaves them alone; a hidden field is a presentation choice, not a permission.

**Deferred:** rich text (Tiptap plus server-side sanitization) and file/image widgets need the storage layer and a vetted sanitizer; they move to M4 with uploads. Jalali date pickers are M2-4.

**Spec:** §5.2 (`fields: { widget, readonlyIf, colors, showIf, from, … }`, `links`), §5.3 (resolution order; object conditions evaluated live in the browser, function conditions on the server as `_perm.readonly` and re-checked on save), §5.6 (widgets), §9.4 (detail header with title, status badges, external links; layout sections/tabs/columns; unsaved-changes guard; Ctrl/⌘+S; Duplicate and Save & new), §10.1 (`fieldsets`, `readonly_fields`, `prepopulated_fields`, `save_as`, `view_on_site`). Plan 3 of 4 for M2.

## Global Constraints

- All earlier constraints apply (exact pins, logical utilities only, every string through `t()` in `en` and `fa`, the error contract, per-app test databases, no AI attribution, never commit `.idea/`, `.serena/` or the local Playwright config).
- **Config validation.** Configuration errors are boot errors with did-you-mean hints:
  - an unknown field in `fields` or `layout`;
  - an unknown widget, or a widget that does not fit the field type (`money` on a boolean);
  - `slugFrom` naming a missing field;
  - `showIf` naming a missing field.
- **`readonlyIf` failures.** A function that throws counts as read-only (fail closed) and is logged once with the resource name.
- **Wire format:**
  - `_readonly` and `_links` join `_id` and `_title` as reserved record keys;
  - a PATCH that sends a read-only field is 422 `{ field: ['is read-only'] }`;
  - `create` ignores `readonlyIf` (there is no record yet).

## Review Focus

1. **Per-record read-only.** A field locked by `readonlyIf` cannot be changed through PATCH even by a hand-made request, including inline cell edits and on every database; an unlocked record of the same resource can.
2. **Labels in Persian.** Field labels, help and enum value labels switch with the language; values sent stay the raw enum values.
3. **Hidden fields are not sent.** A field hidden by `showIf` is not submitted, and shows again with its value when the condition flips back.
4. **Leaving with unsaved changes** asks first (in-app navigation and tab close), and saving or discarding clears the guard. ⌘/Ctrl+S saves without leaving the keyboard.

## File Structure

```
packages/core/src/
  decorators/admin-field.ts (+ test)       (@AdminField options on entity and DTO properties)
  schema/field-config.ts (+ test)          (merge order, widget/type fit, showIf/slugFrom checks, layout validation)
  schema/build-resource-schema.ts          (applies it; form.readonly, form.layout)
  registry/resource-registry.ts            (raw field texts per resource)
  api/admin-api.service.ts                 (localized field texts; _readonly, _links; PATCH read-only check)
  resource/admin-resource-base.ts          (fields, links())
  contract.ts                              (FieldSchema.help/placeholder/widget/enumLabels/colors/showIf/slugFrom/currency; form.readonly/layout)
packages/core/test/fields-config.test.ts
packages/ui/src/
  app/widgets/*.tsx                        (money, switch, radio, color, json, slug, password, textarea, badge)
  app/field-input.tsx                      (registry dispatch; help; placeholder)
  app/form-layout.tsx                      (sections/tabs/columns; showIf)
  app/form-page.tsx                        (header with badges and links; guard; ⌘S; Duplicate; Save & new)
  lib/show-if.ts (+ test) · lib/slug.ts (+ test) · lib/money.ts (+ test)
examples/demo-api                          (Product: fields config, layout, readonlyIf for archived, links; @AdminField on DTO)
README.md · CLAUDE.md · m0-followups.md
```

---

### Task 1: Field config, layout, read-only and links in core

- [ ] **Tests first:**
  - `field-config.test.ts`:
    - the merge order;
    - widget/type fit;
    - unknown names with suggestions;
    - layout validation (unknown, duplicate, not on a form);
    - `showIf`/`slugFrom` references.
  - `fields-config.test.ts` (integration, every database):
    - `GET /meta/resources/x` in `en` and `fa` gives localized labels, help and enum labels (Review Focus 2);
    - records carry `_readonly` from `readonlyIf` and `_links` from `links()`;
    - PATCH of a locked field is 422 and writes nothing, while other fields of that record and the same field of an unlocked record save (Review Focus 1);
    - a throwing `readonlyIf` locks the field;
    - `readonly: true` removes the field from `form.update` and lists it in `form.readonly`.
- [ ] **Implement:**
  - `@AdminField(options)`;
  - `FieldsConfig<T>` on `AdminResourceBase`;
  - `FormConfig.layout`;
  - schema properties for the static options;
  - `links(record)`;
  - `_readonly` and `_links` in `AdminApiService.records`;
  - the PATCH check before the resource method.
- [ ] **Verify** on all three databases, then commit `feat: fields config, @AdminField, layouts, read-only fields and record links`.

### Task 2: Widgets

- [ ] **Tests first (unit):**
  - `money.ts`: grouping for display (`1234567.5` → `1,234,567.50` with the field scale) and parsing back ("1,234.5" → "1234.5");
  - `slug.ts`: `slugify('Hello World — Tehran!')` → `hello-world-tehran`, keeping Persian letters (`سلام دنیا` → `سلام-دنیا`);
  - the widget registry picks from `field.widget`, else infers it from type and format.
- [ ] **Implement:**
  - **Widgets:**
    - `money` (text input, inputMode decimal, grouped on blur, with a currency suffix);
    - `switch` (Radix-free button `role=switch`);
    - `radio` (enum);
    - `textarea`;
    - `password`;
    - `color` (swatch plus hex text);
    - `json` (monospace, a "Format" button, parse errors inline);
    - `slug` (fills from `slugFrom` until the user edits it);
    - `badge` for display in list cells, the quick view and the header (a `colors` map to a fixed palette).
  - Labels, help (`aria-describedby`), placeholders and enum labels in selects and filters.
- [ ] **Verify**, then commit `feat(ui): widgets, field help and enum labels`.

### Task 3: Layout, `showIf`, read-only fields, detail header

- [ ] **Tests first.** `show-if.ts`: `{ status: 'draft' }`, `{ status: ['draft', 'active'] }`, `{ stock: 0 }`, and several keys (all must match); values compared as the form holds them.
- [ ] **Implement:**
  - `FormLayout` renders sections (headings, 1–3 columns, single column on mobile) and tabs (Radix-free tablist with arrow keys); fields not in any section go into a trailing section.
  - `showIf` hides fields live; hidden fields are left out of the payload (Review Focus 3).
  - Read-only fields (`form.readonly` and the record's `_readonly`) render as text with a lock icon.
  - The detail header shows the title, badge fields and `_links` as external links (`rel="noopener"`).
- [ ] **Verify**, then commit `feat(ui): form layout (sections, tabs, columns), live showIf, read-only fields, detail header`.

### Task 4: Guard, ⌘S, Duplicate, Save & new

- [ ] **Implement:**
  - The guard:
    - `useBlocker` (react-router) asks before leaving a dirty form, as an inline confirm bar ("Leave without saving?" Stay / Leave);
    - `beforeunload` covers tab close;
    - a successful save or "Leave" releases it.
  - ⌘/Ctrl+S submits (preventDefault).
  - "Duplicate" opens `/r/new?from=<id>` with the record's create-form values except keys, read-only fields and unique columns (schema flag `unique`).
  - "Save & new" saves and opens an empty create form.
- [ ] **E2E:**
  - leaving a dirty form asks, and "Stay" keeps the edits;
  - ⌘S saves;
  - Duplicate prefills and saves a copy with a new SKU;
  - Save & new lands on an empty form.
- [ ] **Verify**, then commit `feat(ui): unsaved-changes guard, keyboard save, Duplicate, Save & new`.

### Task 5: Demo, E2E, docs

- [ ] **Demo** (Product):
  - `fields`:
    - `price { widget: 'money', currency: 'USD' }`;
    - `status { widget: 'badge', colors: { active: 'green', archived: 'gray', draft: 'amber' }, enumLabels: { draft: { en: 'Draft', fa: 'پیش‌نویس' }, … } }`;
    - `slug` from `name`;
    - `releasedOn { showIf: { status: ['active', 'archived'] } }`;
    - Persian labels and help.
  - `readonlyIf` locks price on archived products.
  - `links` point to a (fake) shop URL.
  - A layout with "Details" and "Pricing and stock" sections in two columns, plus a "Catalog" tab.
- [ ] **E2E:**
  - Persian labels and enum labels;
  - money grouping;
  - the badge in the list;
  - showIf hiding and revealing `releasedOn`;
  - a locked price on an archived product (the UI shows read-only, and a hand PATCH is 422);
  - the external link in the header.
- [ ] **Docs:** README (fields, widgets, layout, read-only, links), CLAUDE.md, and m0-followups.
- [ ] **Verify everything** (typecheck, three databases, compat, pack:smoke, e2e), then commit `feat(demo): configured product form; E2E; docs`.

## After this plan

M2-4: Persian and mobile (Jalali pickers and filters, Persian search normalization and digits, mobile cards and filter drawer, command palette, and the screenshot matrix).
