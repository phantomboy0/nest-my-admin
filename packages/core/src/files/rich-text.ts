import { In, type Repository } from 'typeorm';
import type { NmaFile } from './entities.js';

/** Where an editor image may live: this admin's download route, and the storage's public base URL when it has one. */
export interface ImageUrls {
  /** `<admin path>/api/files/` */
  adminPrefix: string;
  /** What `publicUrl(key)` starts with, e.g. `https://cdn.example.com/f/` */
  publicPrefix?: string;
}

/** The subset of `sanitize-html` this file uses. */
type SanitizeHtml = ((html: string, options: Record<string, unknown>) => string) & { simpleTransform: (tag: string, attributes: Record<string, string>) => unknown };

/** Loads the optional peer; tests replace it (`richTextLoader.import`) to simulate a missing package. */
export const richTextLoader: { import: () => Promise<SanitizeHtml> } = {
  import: async () => ((await import('sanitize-html')) as unknown as { default: SanitizeHtml }).default,
};

export const INSTALL_HINT = 'nest-my-admin: a field uses the "richtext" widget, which sanitizes HTML with the optional package "sanitize-html". Install it: npm install sanitize-html (or pass files.sanitizeHtml to AdminModule.forRoot)';

/** `sanitize-html`, or an error that says what to install. */
export async function loadSanitizerModule(load: () => Promise<SanitizeHtml> = richTextLoader.import): Promise<SanitizeHtml> {
  try {
    return await load();
  } catch (error) {
    throw new Error(`${INSTALL_HINT} (${error instanceof Error ? error.message : String(error)})`);
  }
}

/** Tags of the editor (spec §5.6): headings 2-4, marks, lists, quotes, tables, images, links. */
const TAGS = ['p', 'h2', 'h3', 'h4', 'strong', 'em', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'br', 'hr'];
const REL = 'noopener noreferrer nofollow';

/**
 * The default sanitizer: the editor's allow-list, nothing else. Links keep `href` (http, https, mailto, relative) and
 * always get `rel`; images keep `alt` and a `src` that is one of this admin's files (an `<img>` pointing anywhere else,
 * `data:` included, is removed whole).
 */
export async function createSanitizer(urls: ImageUrls | undefined, load: () => Promise<SanitizeHtml> = richTextLoader.import): Promise<(html: string) => string> {
  const sanitizeHtml = await loadSanitizerModule(load);
  return (html) =>
    sanitizeHtml(html, {
      allowedTags: TAGS,
      allowedAttributes: { a: ['href', 'rel'], img: ['src', 'alt'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
      allowedSchemes: ['http', 'https', 'mailto'],
      allowProtocolRelative: false,
      disallowedTagsMode: 'discard',
      transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: REL }) },
      exclusiveFilter: (frame: { tag: string; attribs: Record<string, string> }) => frame.tag === 'img' && !(urls && typeof keyOfSrc(frame.attribs.src, urls) === 'string'),
    });
}

/**
 * The storage key an `<img src>` points at: a string for this admin's file URLs (and the public base URL), `null` for
 * a URL in that space that is not a plain key (query, fragment, dot segments, bad escapes), `undefined` for any other.
 */
export function keyOfSrc(src: string | undefined, urls: ImageUrls): string | null | undefined {
  if (src === undefined) return undefined;
  const prefix = [urls.adminPrefix, urls.publicPrefix].find((candidate) => candidate !== undefined && src.startsWith(candidate));
  if (prefix === undefined) return undefined;
  const rest = src.slice(prefix.length);
  if (rest === '' || /[?#]/.test(rest)) return null;
  try {
    const key = rest.split('/').map(decodeURIComponent).join('/');
    // eslint-disable-next-line no-control-regex
    return key.split('/').some((part) => part === '' || part === '.' || part === '..') || /[\u0000-\u001f\\]/.test(key) ? null : key;
  } catch {
    return null;
  }
}

const IMG = /<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** The first `src` of an `<img ...>` tag (attributes parsed, so `alt=" src=x"` is not mistaken for it). */
function srcOf(tag: string): string | undefined {
  for (const match of tag.slice(4).matchAll(ATTRIBUTE)) {
    if (match[1]!.toLowerCase() === 'src') return (match[2] ?? match[3] ?? match[4] ?? '').replace(/&amp;/g, '&');
  }
  return undefined;
}

/** The distinct keys of the images of this admin that `html` references, in order. */
export function imageKeysOf(html: unknown, urls: ImageUrls): string[] {
  if (typeof html !== 'string') return [];
  const keys = new Set<string>();
  for (const [tag] of html.matchAll(IMG)) {
    const key = keyOfSrc(srcOf(tag), urls);
    if (typeof key === 'string') keys.add(key);
  }
  return [...keys];
}

/** Removes the images of this admin's file space that `keep` refuses (`null` for a malformed URL); other images are left to the sanitizer. */
export function stripImages(html: string, keep: (key: string | null) => boolean, urls: ImageUrls): string {
  return html.replace(IMG, (tag) => {
    const key = keyOfSrc(srcOf(tag), urls);
    return key === undefined || keep(key) ? tag : '';
  });
}

/** What the images of a write's richtext fields come to: the first-time uploads it takes, and what each field held before. */
export interface ImageChanges {
  /** Uploads referenced for the first time: they become the record's files. */
  fresh: Array<{ id: string; field: string }>;
  /** Per field sent: the keys of this record's images the stored HTML referenced. */
  before: Map<string, string[]>;
}

/**
 * For each richtext field the write sends (already sanitized), keeps only the images the writer may use: their own
 * unsaved upload to this resource and field (less than a day old) or an image already attached to this record in this
 * field. Any other image of this admin's file space (someone else's upload, another record's file) is removed from the
 * HTML, not rejected. Edits `values` in place.
 */
export async function resolveImages(options: {
  repo: Repository<NmaFile>;
  resource: string;
  fields: string[];
  values: Record<string, unknown>;
  existing?: Record<string, unknown>;
  /** The record's id; undefined on create. */
  recordId?: string;
  user: string | null;
  oldest: number;
  urls: ImageUrls;
}): Promise<ImageChanges> {
  const { repo, resource, values, existing, recordId, user, oldest, urls } = options;
  const fields = options.fields.filter((name) => Object.hasOwn(values, name));
  const changes: ImageChanges = { fresh: [], before: new Map() };
  if (fields.length === 0) return changes;
  const keys = [...new Set(fields.flatMap((name) => [...imageKeysOf(values[name], urls), ...imageKeysOf(existing?.[name], urls)]))];
  const rows = new Map((keys.length > 0 ? await repo.findBy({ key: In(keys), resource }) : []).map((row) => [row.key, row]));
  const ofRecord = (row: NmaFile | undefined, field: string) => row !== undefined && row.field === field && row.status === 'attached' && recordId !== undefined && row.recordId === recordId;
  const taken = new Set<string>();
  for (const field of fields) {
    changes.before.set(field, imageKeysOf(existing?.[field], urls).filter((key) => ofRecord(rows.get(key), field)));
    if (typeof values[field] !== 'string') continue;
    values[field] = stripImages(
      values[field],
      (key) => {
        const row = key === null ? undefined : rows.get(key);
        if (!row) return false;
        if (ofRecord(row, field)) return true;
        const mine = row.status === 'temp' && row.field === field && user !== null && row.createdBy === user && row.createdAt.getTime() > oldest;
        if (mine && !taken.has(row.id)) {
          taken.add(row.id);
          changes.fresh.push({ id: row.id, field });
        }
        return mine;
      },
      urls,
    );
  }
  return changes;
}
