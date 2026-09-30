import { fieldTypeOf, isSupportedColumn, type ColumnLike } from './column-field.js';
import { didYouMean } from './suggest.js';

/** `@AdminResource({ title })`: a column name, or a function of the entity (spec §5.2). */
export type TitleDefinition = string | ((record: any) => string);

/** `column` is set when the title is a column's value (options are sorted and searched by it). */
export type TitleFn = ((entity: object) => string) & { column?: string };

/** Columns that name a record, in order of preference, when a resource sets no `title`. */
export const DEFAULT_TITLE_COLUMNS = ['name', 'title', 'label', 'displayName', 'fullName', 'username', 'email', 'code', 'sku'];

interface TitleMetadataLike {
  name: string;
  columns: ColumnLike[];
  primaryColumns: ColumnLike[];
}

/**
 * Compiles a title definition. A column title reads that column; a function title gets the entity as loaded
 * (columns, and relations only when whoever loaded it joined them). Without one, the first string column named
 * like a title is used. Empty, missing or failing titles fall back to `#<id>`.
 */
export function compileTitle(definition: TitleDefinition | undefined, metadata: TitleMetadataLike, fail: (message: string) => never): TitleFn {
  const primaryKey = metadata.primaryColumns[0]?.propertyName;
  const fallback = (entity: object) => `#${String((entity as Record<string, unknown>)[primaryKey ?? ''] ?? '?')}`;
  const columns = metadata.columns.filter(isSupportedColumn);

  let read: (entity: object) => unknown;
  let titleColumn: string | undefined;
  if (typeof definition === 'function') {
    read = definition;
  } else if (typeof definition === 'string') {
    if (!columns.some((column) => column.propertyName === definition)) {
      fail(`title: unknown column "${definition}" on ${metadata.name}${didYouMean(definition, columns.map((column) => column.propertyName))}`);
    }
    read = (entity) => (entity as Record<string, unknown>)[definition];
    titleColumn = definition;
  } else {
    const textColumns = new Set(
      columns.filter((column) => ['string', 'text'].includes(fieldTypeOf(column.type))).map((column) => column.propertyName),
    );
    const column = DEFAULT_TITLE_COLUMNS.find((name) => textColumns.has(name));
    if (!column) return fallback;
    read = (entity) => (entity as Record<string, unknown>)[column];
    titleColumn = column;
  }

  const title: TitleFn = (entity) => {
    let value: unknown;
    try {
      value = read(entity);
    } catch {
      return fallback(entity);
    }
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    return typeof value === 'string' && value.trim() !== '' ? value : fallback(entity);
  };
  if (titleColumn) title.column = titleColumn;
  return title;
}
