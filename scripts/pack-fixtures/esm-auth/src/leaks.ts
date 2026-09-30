import 'reflect-metadata';
import { createAdminTestingModule } from '@nest-my-admin/testing';
import { AppModule } from './app.module.js';

// @nest-my-admin/testing from the tarball: a user without roles reaches nothing, the superuser everything.
const admin = await createAdminTestingModule({ imports: [AppModule] });
await admin.superuser.create('note', { title: 'hello' });
const report = await admin.expectNoLeaks('note', { as: { id: 'nobody', roles: [] } });
if (report.records !== 1 || report.leaks.length !== 0) throw new Error(`unexpected report ${JSON.stringify(report)}`);
if ((await admin.superuser.list('note')).total !== 1) throw new Error('the superuser does not see the note');
await admin.close();
console.log('LEAKS OK');
