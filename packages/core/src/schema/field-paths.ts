type Leaf = string | number | bigint | boolean | symbol | null | undefined | Date | Function | readonly unknown[];

type Key<T> = Extract<keyof T, string>;

/**
 * Field names of `T` and paths through its object properties, up to three segments:
 * `'name' | 'customer' | 'customer.name' | 'customer.company.name'`. Arrays (many-to-many) are names only.
 * The registry checks at boot that each path goes through to-one relations to a column.
 */
export type FieldPath<T, Depth extends unknown[] = []> = Depth['length'] extends 3
  ? never
  : {
      [K in Key<T>]: NonNullable<T[K]> extends Leaf ? K : K | `${K}.${FieldPath<NonNullable<T[K]>, [...Depth, unknown]>}`;
    }[Key<T>];
