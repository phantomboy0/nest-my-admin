/** Reflect-metadata key holding an @AdminResource definition. String keys survive duplicate package copies. */
export const ADMIN_RESOURCE_METADATA = 'nest-my-admin:resource';

/** Reflect-metadata key holding @AdminGroup options on a Nest module class. */
export const ADMIN_GROUP_METADATA = 'nest-my-admin:group';

/** Reflect-metadata key holding the lifecycle hook method names of a resource class. */
export const ADMIN_HOOKS_METADATA = 'nest-my-admin:hooks';

/** Injection token for the resolved AdminModule options. */
export const ADMIN_OPTIONS = 'NEST_MY_ADMIN_OPTIONS';

/** Reflect-metadata key holding @AdminField options by property, on an entity or DTO class. */
export const ADMIN_FIELD_METADATA = 'nest-my-admin:fields';
export const ADMIN_SCOPES_METADATA = 'nest-my-admin:scopes';
export const ADMIN_CAN_METADATA = 'nest-my-admin:can';
