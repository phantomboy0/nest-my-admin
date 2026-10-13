# @nest-my-admin/auth

The built-in sign-in for [nest-my-admin](https://github.com/phantomboy0/nest-my-admin): admin users, hashed passwords, revocable sessions, lockout and two-factor sign-in.

```ts
import { builtinAuth, ADMIN_AUTH_ENTITIES } from '@nest-my-admin/auth';

AdminModule.forRoot({ auth: builtinAuth({ bootstrapSuperuser: { username: 'admin', password: process.env.ADMIN_PASSWORD! } }) });
```

Add `ADMIN_AUTH_ENTITIES` to your TypeORM entities. Documentation: https://github.com/phantomboy0/nest-my-admin#readme
