interface PropertyColumns {
  columns: Array<{ propertyName: string }>;
}

/** The subset of TypeORM's EntityMetadata needed to read database names in driver errors. */
export interface NamedMetadataLike {
  columns: Array<{ databaseName: string; propertyName: string }>;
  uniques: Array<PropertyColumns & { name: string }>;
  indices: Array<PropertyColumns & { name: string; isUnique: boolean }>;
  foreignKeys: Array<PropertyColumns & { name: string }>;
}

/** Names that database errors use, mapped back to entity property names. */
export interface DbNames {
  /** Column name → property name. */
  columns: ReadonlyMap<string, string>;
  /** Unique constraint, unique index or foreign key name → property names. */
  constraints: ReadonlyMap<string, string[]>;
}

export function dbNamesFor(metadata: NamedMetadataLike): DbNames {
  const constraints = new Map<string, string[]>();
  const add = (name: string, { columns }: PropertyColumns) => constraints.set(name, columns.map((column) => column.propertyName));
  for (const unique of metadata.uniques) add(unique.name, unique);
  for (const index of metadata.indices) if (index.isUnique) add(index.name, index);
  for (const foreignKey of metadata.foreignKeys) add(foreignKey.name, foreignKey);
  return { columns: new Map(metadata.columns.map((column) => [column.databaseName, column.propertyName])), constraints };
}
