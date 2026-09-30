import type { AdminUser } from '../auth/auth-adapter.js';
import type { SessionUser } from '../contract.js';

/** @internal */
export function toSessionUser(user: AdminUser): SessionUser {
  return {
    id: String(user.id),
    displayName: user.displayName,
    ...(user.username ? { username: user.username } : {}),
    ...(user.email ? { email: user.email } : {}),
    isSuperuser: user.isSuperuser === true,
  };
}
