interface PropertyColumns {
  columns: Array<{ propertyName: string; propertyPath?: string }>;
}

/** The subset of TypeORM's EntityMetadata needed to read database names in driver errors. */
export interface NamedMetadataLike {
  columns: Array<{ databaseName: string; propertyName: string; propertyPath?: string }>;
  uniques: Array<PropertyColumns & { name: string }>;
  indices: Array<PropertyColumns & { name: string; isUnique: boolean }>;
  foreignKeys: Array<PropertyColumns & { name: string }>;
  checks?: Array<{ name: string; expression?: string }>;
}

/** Names that database errors use, mapped back to entity property names. */
export interface DbNames {
  /** Column name → property name. */
  columns: ReadonlyMap<string, string>;
  /** Unique constraint, unique index, foreign key or check constraint name → property names. */
  constraints: ReadonlyMap<string, string[]>;
}

export function dbNamesFor(metadata: NamedMetadataLike): DbNames {
  const constraints = new Map<string, string[]>();
  const add = (name: string, { columns }: PropertyColumns) => constraints.set(name, columns.map((column) => column.propertyPath ?? column.propertyName));
  for (const unique of metadata.uniques) add(unique.name, unique);
  for (const index of metadata.indices) if (index.isUnique) add(index.name, index);
  for (const foreignKey of metadata.foreignKeys) add(foreignKey.name, foreignKey);
  // A check names no columns; the ones its expression mentions (`stock >= 0`) are the fields to blame.
  for (const check of metadata.checks ?? []) {
    const words = new Set((check.expression ?? '').match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
    const columns = metadata.columns.filter((column) => words.has(column.databaseName));
    if (columns.length > 0) add(check.name, { columns });
  }
  // Fields of embeddeds are named by their dotted path (`address.city`), as their errors are.
  return { columns: new Map(metadata.columns.map((column) => [column.databaseName, column.propertyPath ?? column.propertyName])), constraints };
}
