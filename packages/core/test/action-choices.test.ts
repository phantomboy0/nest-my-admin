import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import request from 'supertest';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AdminAction, AdminResource, AdminResourceBase, type ActionOutcome, type AdminContext } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('ch_site')
class Site {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
}

class LaunchDto {
  @IsString() backend: string;
  @IsOptional() @IsString() frontend?: string;
  @IsOptional() @IsString() note?: string;
}

let branches = ['main', 'develop'];
let seenLocale: string | undefined;

@AdminResource(Site, { name: 'site' })
class SiteAdmin extends AdminResourceBase<Site> {
  @AdminAction({ target: 'resource', input: LaunchDto, choices: { backend: 'backendBranches', frontend: 'frontendBranches' } })
  async launch(input: LaunchDto): Promise<ActionOutcome> {
    return { message: `${input.backend}/${input.frontend ?? '-'}` };
  }

  async backendBranches(ctx: AdminContext) {
    seenLocale = ctx.locale;
    return branches;
  }

  frontendBranches() {
    return [{ value: 'main', label: { en: 'main (default)', fa: 'main (پیش‌فرض)' } }, { value: 'next' }];
  }
}

@Module({ providers: [SiteAdmin] })
class ChoicesModule {}

let app: INestApplication;
const api = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp({ imports: [ChoicesModule], entities: [Site] });
});
afterAll(async () => {
  await app?.close();
});

describe(`action input choices (${TEST_DB})`, () => {
  test('the schema marks choice fields; the endpoint lists their options', async () => {
    const schema = (await api().get('/admin/api/meta/resources/site')).body;
    const fields = schema.actions.find((action: { name: string }) => action.name === 'launch').input.fields;
    expect(fields.map((field: { name: string; choices?: true }) => [field.name, field.choices ?? false])).toEqual([
      ['backend', true],
      ['frontend', true],
      ['note', false],
    ]);
    expect((await api().get('/admin/api/resources/site/actions/launch/choices/backend')).body).toEqual({
      items: [
        { value: 'main', label: 'main' },
        { value: 'develop', label: 'develop' },
      ],
    });
    expect(seenLocale).toBeDefined();
    expect((await api().get('/admin/api/resources/site/actions/launch/choices/frontend')).body.items).toEqual([
      { value: 'main', label: 'main (default)' },
      { value: 'next', label: 'next' },
    ]);
    expect((await api().get('/admin/api/resources/site/actions/launch/choices/note')).status).toBe(404);
  });

  test('a run takes one of the choices; one that is not (or no longer) is a 422 on its field', async () => {
    const run = (input: object) => api().post('/admin/api/resources/site/actions/launch').send({ input });
    expect((await run({ backend: 'develop', frontend: 'next' })).body.message).toBe('develop/next');
    expect((await run({ backend: 'develop' })).body.message).toBe('develop/-');
    const bad = await run({ backend: 'feature-x' });
    expect(bad.status).toBe(422);
    expect(bad.body.fields).toEqual({ backend: ['is not one of the choices'] });
    branches = ['main'];
    expect((await run({ backend: 'develop' })).status).toBe(422);
    branches = ['main', 'develop'];
  });

  test('choices that are not a list fail loudly', async () => {
    const saved = branches;
    branches = 'main' as never;
    expect((await api().get('/admin/api/resources/site/actions/launch/choices/backend')).status).toBe(500);
    branches = saved;
  });
});

describe(`choices checked at boot (${TEST_DB})`, () => {
  const boot = async (resource: Function) => {
    @Module({ providers: [resource as never] })
    class BootModule {}
    return createTestApp({ imports: [BootModule], entities: [Site] });
  };

  test('an unknown field or a missing method fails at boot', async () => {
    @AdminResource(Site, { name: 'typo' })
    class TypoAdmin extends AdminResourceBase<Site> {
      @AdminAction({ target: 'resource', input: LaunchDto, choices: { backnd: 'branches' } as never }) async launch(_input: LaunchDto) {}
      branches() {
        return [];
      }
    }
    await expect(boot(TypoAdmin)).rejects.toThrow('choices: unknown input field "backnd" (did you mean "backend"?)');

    @AdminResource(Site, { name: 'methodless' })
    class MethodlessAdmin extends AdminResourceBase<Site> {
      @AdminAction({ target: 'resource', input: LaunchDto, choices: { backend: 'branches' } }) async launch(_input: LaunchDto) {}
    }
    await expect(boot(MethodlessAdmin)).rejects.toThrow('choices: "backend" names "branches", which is not a method of MethodlessAdmin');
  });
});
