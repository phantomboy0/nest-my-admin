import type { FileOwner } from '../files/file-owner.js';
import type { AdminPolicy } from '../policy/admin-policy.service.js';
import { loadPage, type RegisteredPage } from './page-registry.js';

/** `nma_file.resource` of a page's files is `page:<name>`; so is the `resource` of an upload for one. */
export const PAGE_OWNER_PREFIX = 'page:';

/** A page is one "record": every file of it has this `nma_file.recordId`. */
export const PAGE_RECORD_ID = 'page';

/**
 * A settings page as the owner of its files: uploading and changing need `page.{name}.update`, downloading
 * `page.{name}`, and what the page holds is what its `load()` returns for the field now.
 *
 * Two spellings, both part of what hosts rely on (stored rows and objects exist; `test/admin-files.test.ts` pins them):
 *
 * - the owner is `page:<name>`: the upload is `POST /api/uploads?resource=page:<name>&field=<field>`, and
 *   `nma_file.resource` holds `page:<name>` (with `recordId` = `page`);
 * - the storage key is `page/<name>/<field>/<yyyy>/<mm>/<uuid><ext>`, with a slash.
 */
export function pageFileOwner(page: RegisteredPage, policy: AdminPolicy): FileOwner {
  return {
    name: `${PAGE_OWNER_PREFIX}${page.name}`,
    // `page/shop/…`, not `page:shop/…`: a colon is not a file name everywhere.
    keyPrefix: `page/${page.name}`,
    dataSource: page.dataSource,
    fieldConfig: page.form.config,
    hasField: (field) => page.form.fields.some((candidate) => candidate.name === field),
    recordId: () => PAGE_RECORD_ID,
    requireWrite: (ctx) => policy.requirePage(page, 'update', ctx),
    mayWrite: (ctx) => policy.canPage(page, 'update', ctx),
    mayEdit: (_field, ctx) => policy.canPage(page, 'update', ctx),
    async held(_recordId, field, ctx) {
      // A secret is never a file field; were one asked for, nothing of it leaves.
      if (!policy.canPage(page, 'view', ctx) || page.secrets.includes(field)) return undefined;
      return (await loadPage(page, ctx))[field];
    },
  };
}
