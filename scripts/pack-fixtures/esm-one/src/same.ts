// One install: `nest-my-admin`, `nest-my-admin/auth` and `nest-my-admin/testing` are the scoped packages under one name.
import * as core from '@nest-my-admin/core';
import * as auth from '@nest-my-admin/auth';
import * as testing from '@nest-my-admin/testing';
import * as one from 'nest-my-admin';
import * as oneAuth from 'nest-my-admin/auth';
import * as oneTesting from 'nest-my-admin/testing';

// (`default` is what a CommonJS build's interop helper adds to each namespace: not an export.)
const namesOf = (module: object) => Object.keys(module).filter((name) => name !== 'default').sort();
for (const [label, scoped, unscoped] of [['core', core, one], ['auth', auth, oneAuth], ['testing', testing, oneTesting]] as const) {
  const names = namesOf(scoped);
  const different = names.filter((name) => (unscoped as Record<string, unknown>)[name] !== (scoped as Record<string, unknown>)[name]);
  if (names.length === 0 || different.length > 0 || names.join() !== namesOf(unscoped).join()) throw new Error(`${label}: exports differ: ${different.join(', ') || 'another set of names'}`);
}
console.log('SAME OK (core, auth, testing)');
