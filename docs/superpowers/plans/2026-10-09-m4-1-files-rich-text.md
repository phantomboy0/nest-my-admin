# M4-1 — Files, Uploads and Rich Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resources can have file, image and rich-text fields (spec §5.6, §8.2): uploads go to pluggable storage, records keep a key, private files are served only to people who may view the record, and rich text is sanitized on the server. First consumer: shop-nest (product media, logos, sliders, article bodies, ticket attachments).

**Architecture:**
- **Storage** (`files/storage.ts`):

  ```ts
  export interface AdminStorage {
    put(key: string, body: Readable, info: { contentType: string; size: number }): Promise<void>;
    get(key: string): Promise<{ body: Readable; contentType: string; size: number } | null>;
    delete(key: string): Promise<void>;
    /** A URL a browser can fetch directly, or undefined when downloads must go through the admin. */
    publicUrl(key: string): string | undefined;
  }
  ```

  - Built in: `localStorage({ dir, publicBaseUrl? })` (files on disk; `publicBaseUrl` when the host serves the directory itself) and `s3Storage({ endpoint, region, bucket, accessKeyId, secretAccessKey, publicBaseUrl?, forcePathStyle? })`.
  - S3 uses its own SigV4 signing (`files/sigv4.ts`, no SDK), so core keeps zero runtime dependencies. It is tested against AWS's published SigV4 test vectors. ArvanCloud, R2 and MinIO are S3-compatible.
  - Configured with `AdminModule.forRoot({ files: { storage, maxBytes?: 10_485_760 } })`; the entities come from `ADMIN_FILE_ENTITIES`.
  - `AdminStorage`, `localStorage`, `s3Storage` and `sniff`/`accepts` are exported, so hosts can use the same storage outside the admin. shop-nest uses them for storefront uploads (ticket attachments) and for images fetched from the CRM.
- **The `nma_file` table** (`files/entities.ts`, `NmaFile`):
  - Columns: `id` (uuid), `key` (unique), `name` (the original file name, cleaned), `contentType`, `size`, `visibility` (`public` | `private`), `status` (`temp` | `attached`), `resource`, `field`, `recordId` (null while temp), `createdBy`, `createdAt`.
  - Keys: `<resource>/<field>/<yyyy>/<mm>/<uuid><ext>`. The extension comes from the sniffed type, never from the name.
- **Upload: `POST /api/uploads?resource=<r>&field=<f>`.**
  - The body is the raw file. `Content-Type` is the file's type; `X-File-Name` carries the name, percent-encoded.
  - No multipart, so no parser dependency. CORS-simple types (`text/plain`, `multipart/form-data`, `application/x-www-form-urlencoded`) are refused with 415, so a foreign page cannot forge an upload without a preflight. CSRF applies as on every write.
  - The user needs `create` or `update` on the resource and edit access to the field.
  - The body is streamed to storage with a byte limit (the field's `maxBytes`, else the module's). Over the limit → 413, and the partial object is deleted.
  - The type is **sniffed from content** (`files/sniff.ts`: jpeg, png, webp, gif, avif, pdf, zip, docx/xlsx (zip with `[Content_Types].xml`), mp4, plain text). The declared type is ignored. A sniffed type outside the field's `accept` → 422.
  - SVG is never accepted (script carrier).
  - Answer: `{ token, name, contentType, size, url? }`. `token` is the `nma_file.id` while `temp`.
- **Fields.** `fields: { logo: { widget: 'image', file: { accept: ['image/*'], maxBytes, visibility: 'public' } } }`, `widget: 'file'`, and `many: true` (a `simple-json` or `json` column holding a list).
  - The column is a string (one key) or json (a list of keys).
  - Schema: `FieldSchema.widget` gains `'file' | 'image' | 'richtext'`, and `FieldSchema.file = { accept: string[]; maxBytes: number; many: boolean }`.
  - Boot check: file widgets only on string, text or json columns; `many` only on json.
- **Writes.**
  - The form sends, per file field: a token (`{ token }`) for a new upload, the existing key (`{ key }`) to keep one, or null to clear.
  - `validateWrite` accepts that shape for file fields. Before the resource method runs, `AdminApiService` resolves each value to an `AdminFile`:

    ```ts
    export interface AdminFile { key: string; name: string; contentType: string; size: number; url?: string; isNew: boolean }
    ```

    - A token must be `temp`, created by this user, for this resource and field, and younger than 24 h; otherwise 422 `is not a valid upload`.
    - A key must be one already stored on this record; otherwise 422.
  - The default `create`/`update` write the key (or the list of keys) into the column.
  - Host overrides receive the `AdminFile`s in the DTO and do what they like.
  - After the resource method succeeds (same transaction), new files become `attached` with the record id, and keys removed from the record are deleted from storage **after commit**.
- **Reading.**
  - Records carry the key in the field, plus `_files: { [field]: AdminFileRef | AdminFileRef[] }` with `{ key, name, contentType, size, url }`.
  - `url` is `publicUrl(key)` for public files, otherwise `<admin>/api/files/<key>`.
- **Download: `GET /api/files/*key`.** The `nma_file` row gives the resource, field and record. The user must be able to view that record (scope included) and that field; otherwise 404.
  - Headers: `Content-Disposition: attachment` unless the type is an image or pdf, `X-Content-Type-Options: nosniff`, and `Content-Security-Policy: sandbox`.
  - The router gains a trailing wildcard segment (`*key`), because keys contain slashes.
- **Cleanup.** A timer started in `onApplicationBootstrap` (unref'd) runs hourly. It deletes `temp` rows older than 24 h together with their objects.
- **Rich text.**
  - `widget: 'richtext'` on string/text columns. The UI is Tiptap (bold, italic, headings 2–4, lists, links, quotes, tables, images); images go through the upload endpoint with the same field, and editor images are inserted by URL.
  - **Server:** every write to a richtext field passes through `files.sanitizeHtml`. By default that is `sanitize-html` (an optional peer, loaded at boot only when a richtext field exists; boot fails with an install hint if it is missing) with an allow-list matching the editor: `p h2 h3 h4 strong em s a ul ol li blockquote table thead tbody tr th td img br hr`.
    - Links keep only `href` (http, https, mailto, relative) and get `rel="noopener noreferrer nofollow"`.
    - Images keep only `src` (this admin's file URLs or `publicUrl` prefixes) and `alt`.
  - Hosts can pass their own `sanitizeHtml(html) => string`.

**Deferred:** thumbnails (`sharp`), signed URLs for private S3 objects (downloads go through the admin), jobs, and content scanning.

**Spec:** §5.6 (file, image and rich text widgets), §8.2 (storage, upload flow, MIME from content, size limits, private by default, permission-checked downloads, orphan cleanup), §11 (`POST /uploads`, `GET /files/:id`). Plan 1 of 3 for M4 (shop-nest spec §9).

## Global Constraints

- All earlier constraints apply (CLAUDE.md conventions, every database, `.js` imports, no hardcoded `sqljs`).
- **Core keeps zero runtime dependencies.** `sanitize-html` is an optional peer, and Tiptap is a UI devDependency.
- **Private by default.** `visibility` defaults to `private`, and a private file's bytes leave only through `GET /api/files/*`, after the record-view check.
- **The client never decides the type or the extension.** Both come from sniffing.
- **A write never trusts a token it did not issue** to this user, for this resource and field.

## Review Focus

1. **Someone else's upload token** (another user's, or another field's) on a create/update → 422; the file stays `temp` and unattached. Test in Task 2.
2. **A file disguised by its extension:** `evil.png` that is really HTML/SVG/JS → refused (422), and nothing is left in storage. Test in Task 1.
3. **Downloading a private file of a record outside the user's scope**, or of a field hidden from them → 404, the same as a missing key. Test in Task 2.
4. **Replacing or clearing a file:** the old object is deleted only after the transaction commits. When the write rolls back, the old file stays and the new upload stays `temp`. Test in Task 2.
5. **Rich-text XSS:** `<img onerror>`, `javascript:` links, `<script>`, `<style>`, `<iframe>` and `data:` image URLs are stripped on save, on every database. Test in Task 3.

## File Structure

```
packages/core/src/files/storage.ts (+ test)        AdminStorage, localStorage()
packages/core/src/files/s3-storage.ts · sigv4.ts (+ tests with AWS vectors)
packages/core/src/files/sniff.ts (+ test)          content sniffing, accept matching
packages/core/src/files/entities.ts                NmaFile, ADMIN_FILE_ENTITIES
packages/core/src/files/files.service.ts (+ test)  upload, resolve tokens/keys, attach, delete-after-commit, cleanup
packages/core/src/files/file-routes.ts             POST /api/uploads, GET /api/files/*key
packages/core/src/files/rich-text.ts (+ test)      sanitizer loading, allow-list
packages/core/src/http/router.ts                   trailing *wildcard segment
packages/core/src/http/admin-http.server.ts        raw-body route exception for /api/uploads
packages/core/src/schema/field-config.ts           file/image/richtext widgets, `file` options, boot checks
packages/core/src/crud/validate-write.ts           file-field value shape
packages/core/src/api/admin-api.service.ts         resolve files before resource methods; _files on records
packages/core/src/contract.ts                      widget names, FieldSchema.file, AdminFileRef, UploadResponse
packages/core/test/files.test.ts · rich-text.test.ts
packages/ui/src/app/widgets/file-input.tsx · image-input.tsx · rich-text-input.tsx
packages/ui/src/lib/upload.ts (+ test)             XHR upload with progress
examples/demo-api                                  product image + gallery, article body; E2E
README.md · CLAUDE.md · m0-followups.md
```

---

### Task 1: Storage, sniffing and the upload endpoint

**Interfaces:** produces `AdminStorage`, `localStorage()`, `s3Storage()`, `sniff(buffer): string | undefined`, `accepts(type, accept[]): boolean`, `NmaFile`, `ADMIN_FILE_ENTITIES`, `FilesService.upload(req, resource, field, ctx): Promise<UploadResponse>`, and options `files: { storage, maxBytes?, sanitizeHtml? }`.

- [ ] **Tests first:**
  - `sniff.test.ts`: every supported magic number; HTML, SVG, JS and empty buffers → undefined; `accepts` with wildcards.
  - `sigv4.test.ts`: the AWS SigV4 test-suite vectors (`get-vanilla`, `post-vanilla`, `get-vanilla-query-order-key-case`) and a presigned GET.
  - `storage.test.ts`: local put/get/delete round trip; keys with `..` refused.
  - `files.test.ts` (upload part, every database):
    - an image upload answers a token and a `temp` row;
    - over the limit → 413 with no object left;
    - a sniffed type outside `accept` → 422 with nothing left (Review Focus 2);
    - `text/plain` and `multipart/form-data` content types → 415;
    - a user without create/update, or without edit access to the field → 403;
    - unknown resource or field, or a field that is not a file field → 404/422.
- [ ] **Implement** storage, SigV4, sniffing, the entity, the route, and the router wildcard.
- [ ] **Verify:** `bun test packages/core/test/files.test.ts packages/core/src/files`, then `bun run test:postgres` and `test:mysql` for `files.test.ts`. Commit `feat: file storage and uploads`.

### Task 2: File fields in writes, reads and downloads

**Interfaces:** consumes Task 1. Produces `AdminFile`, `AdminFileRef`, `FieldSchema.file`, `_files` on records, `FilesService.resolve(entry, dto, existing | undefined, ctx)`, `FilesService.attach(...)` and `FilesService.afterCommit(...)`.

- [ ] **Tests first** (`files.test.ts`, every database):
  - create with a token → column holds the key, the row is `attached` with the record id, `_files` carries the ref;
  - update replacing the file → the old object is deleted after commit;
  - an update that fails after resolving (the resource throws) → the old object stays and the new row stays `temp` (Review Focus 4);
  - clear with null;
  - `many` fields: add, keep and remove in one PATCH;
  - another user's token, another field's token, or an expired token → 422 (Review Focus 1);
  - a key not on this record → 422;
  - a host `update` override receives `AdminFile` objects;
  - download: viewer allowed → bytes with the right headers; out of scope / hidden field / unknown key → 404 (Review Focus 3); public files answer `url` = `publicUrl`;
  - cleanup deletes 25-hour-old temp rows and objects, and keeps attached ones.
- [ ] **Implement:** field config and boot checks, the `validateWrite` shape, resolving in `create`/`update`, the default write of keys, `_files` in `records()`, the download route, the cleanup timer.
- [ ] **Verify** on all three databases. Commit `feat: file and image fields with permission-checked downloads`.

### Task 3: Rich text on the server

**Interfaces:** produces `widget: 'richtext'` and `files.sanitizeHtml`. Consumes uploads for editor images.

- [ ] **Tests first** (`rich-text.test.ts`):
  - the allow-list keeps editor markup;
  - Review Focus 5 payloads are stripped;
  - links get `rel`;
  - images outside this admin's file URLs are removed;
  - a richtext field without `sanitize-html` installed fails at boot with the install hint;
  - a host `sanitizeHtml` replaces the default.
- [ ] **Implement:** add `sanitize-html` as an optional peer of core (and a devDependency for tests). Sanitizing runs in `validateWrite` for richtext fields.
- [ ] **Verify.** Commit `feat: rich text fields sanitized on the server`.

### Task 4: UI, demo, E2E, docs

- [ ] **UI:**
  - `lib/upload.ts` (XHR with progress, abort, error mapping; tests with a fake XHR);
  - `file-input.tsx`: drop zone, progress, name and size, remove, a list for `many` with drag-to-reorder;
  - `image-input.tsx`: preview from `_files[field].url` or a local object URL, gallery for `many`;
  - `rich-text-input.tsx`: Tiptap with the allow-listed toolbar, image upload, RTL-aware (`dir="auto"` per block);
  - list cells show thumbnails for image fields;
  - `widgetOf` maps the new widgets;
  - texts in `i18n/en.ts` and `fa.ts`.
- [ ] **Demo:**
  - `Product.image` (public image) and `Product.gallery` (many images);
  - `Article.body` (rich text) with `localStorage({ dir: 'var/uploads' })`;
  - a private `Invoice.pdf` file.
- [ ] **E2E** (`files.pw.ts`):
  - upload an image to a product, save, see the thumbnail in the list;
  - replace it;
  - an editor without access gets 404 on the private file URL;
  - write an article with bold text and an inline image, then reload.
- [ ] **Screens:** update baselines for the product form.
- [ ] **Docs:** README (files, storage, rich text, security notes), CLAUDE.md architecture bullets (M4-1), m0-followups.
- [ ] **Verify everything** (`bun run typecheck && bun run test && bun run e2e && bun run pack:smoke`). Commit `feat(ui): file, image and rich text widgets; demo; E2E; docs`.
