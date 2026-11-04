import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { seedShowcase } from './showcase/seed.js';
import { seedContent, seedProducts, seedRbac, seedSales, seedSettings, seedStaff, seedUsers } from './seed.js';

const app = await NestFactory.create(AppModule);
await app.init(); // module init first: the built-in auth creates its bootstrap superuser there, before other users exist
// NMA_DEMO_SHOWCASE=1: the Lumen & Oak shop of the README's screenshots, in place of the E2E data below.
if (process.env.NMA_DEMO_SHOWCASE === '1') await seedShowcase(app);
await seedProducts(app);
await seedContent(app);
await seedSales(app);
await seedSettings(app);
await seedStaff(app);
await seedUsers(app);
await seedRbac(app);
const port = Number(process.env.PORT ?? 3000);
await app.listen(port);
console.log(`Demo API on http://localhost:${port}; admin at http://localhost:${port}/admin`);
