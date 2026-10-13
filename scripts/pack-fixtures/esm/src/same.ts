// `nest-my-admin` is `@nest-my-admin/core` under its unscoped name: every export is the same object.
import * as scoped from '@nest-my-admin/core';
import * as unscoped from 'nest-my-admin';
import { AdminFiles, AdminModule } from 'nest-my-admin';

// (`default` is what a CommonJS build's interop helper adds to each namespace: not an export.)
const namesOf = (module: object) => Object.keys(module).filter((name) => name !== 'default').sort();
const names = namesOf(scoped) as Array<keyof typeof scoped>;
const different = names.filter((name) => (unscoped as Record<string, unknown>)[name] !== scoped[name]);
if (different.length > 0 || names.join() !== namesOf(unscoped).join()) throw new Error(`exports differ: ${different.join(', ') || 'another set of names'}`);
if (AdminModule !== scoped.AdminModule || AdminFiles !== scoped.AdminFiles) throw new Error('AdminModule or AdminFiles is another object');
if (typeof AdminFiles !== 'function' || typeof AdminFiles.prototype.publicFile !== 'function' || typeof AdminFiles.prototype.openPublic !== 'function') {
  throw new Error('AdminFiles is not the service with publicFile() and openPublic()');
}
console.log(`SAME OK (${names.length} exports)`);
