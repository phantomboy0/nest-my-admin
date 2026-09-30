import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { seedProducts, seedUsers } from './seed.js';

const app = await NestFactory.create(AppModule);
await app.init(); // module init first: the built-in auth creates its bootstrap superuser there, before other users exist
await seedProducts(app);
await seedUsers(app);
const port = Number(process.env.PORT ?? 3000);
await app.listen(port);
console.log(`Demo API on http://localhost:${port}; admin at http://localhost:${port}/admin`);
