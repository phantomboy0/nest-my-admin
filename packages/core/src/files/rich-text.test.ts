import { describe, expect, test } from 'bun:test';
import { createSanitizer, imageKeysOf, keyOfSrc, loadSanitizerModule, stripImages, type ImageUrls } from './rich-text.js';

const urls: ImageUrls = { adminPrefix: '/admin/api/files/', publicPrefix: 'https://cdn.example.com/f/' };
const KEY = 'post/body/2026/10/0b6f2c1e-1111-4222-8333-444455556666.png';
const ADMIN_SRC = `/admin/api/files/${KEY}`;

describe('keyOfSrc', () => {
  test('admin and public URLs give the key, others are not ours', () => {
    expect(keyOfSrc(ADMIN_SRC, urls)).toBe(KEY);
    expect(keyOfSrc(`https://cdn.example.com/f/${KEY}`, urls)).toBe(KEY);
    expect(keyOfSrc('/admin/api/files/post/body/a%20b.png', urls)).toBe('post/body/a b.png');
    expect(keyOfSrc('https://evil.example/x.png', urls)).toBeUndefined();
    expect(keyOfSrc('data:image/png;base64,AAAA', urls)).toBeUndefined();
    expect(keyOfSrc(undefined, urls)).toBeUndefined();
  });
  test('a URL of ours that is not a plain key is malformed (null)', () => {
    expect(keyOfSrc(`${ADMIN_SRC}?x=1`, urls)).toBeNull();
    expect(keyOfSrc(`${ADMIN_SRC}#f`, urls)).toBeNull();
    expect(keyOfSrc('/admin/api/files/a/../b.png', urls)).toBeNull();
    expect(keyOfSrc('/admin/api/files/', urls)).toBeNull();
    expect(keyOfSrc('/admin/api/files/%zz', urls)).toBeNull();
  });
});

describe('imageKeysOf / stripImages', () => {
  const html = `<p>a</p><img src="${ADMIN_SRC}" alt="x"><img alt=' src="/admin/api/files/other.png" ' src='https://cdn.example.com/f/b.png'/><img src="https://elsewhere/p.png">`;
  test('reads src of img tags only, quote aware, unique and in order', () => {
    expect(imageKeysOf(html, urls)).toEqual([KEY, 'b.png']);
    expect(imageKeysOf(null, urls)).toEqual([]);
    expect(imageKeysOf(`<p>${ADMIN_SRC}</p>`, urls)).toEqual([]);
  });
  test('removes the images the predicate refuses, malformed ones of ours included, and leaves foreign ones to the sanitizer', () => {
    const out = stripImages(`${html}<img src="${ADMIN_SRC}?x">`, (key) => key === KEY, urls);
    expect(out).toBe(`<p>a</p><img src="${ADMIN_SRC}" alt="x"><img src="https://elsewhere/p.png">`);
  });
});

describe('loadSanitizerModule', () => {
  test('a missing package fails with the package and the install command', async () => {
    const failing = () => Promise.reject(Object.assign(new Error("Cannot find module 'sanitize-html'"), { code: 'ERR_MODULE_NOT_FOUND' }));
    await expect(loadSanitizerModule(failing)).rejects.toThrow(/sanitize-html.*npm install sanitize-html|npm install sanitize-html/s);
  });
});

describe('default allow-list', () => {
  const sanitize = createSanitizer(urls, async () => (await import('sanitize-html')).default);
  const run = async (html: string) => (await sanitize)(html);

  test('keeps the editor markup', async () => {
    const html = '<h2>T</h2><h3>S</h3><h4>U</h4><p>a <strong>b</strong> <em>c</em> <s>d</s><br>e</p><ul><li>x</li></ul><ol><li>y</li></ol><blockquote>q</blockquote><hr>' +
      '<table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td>1</td><td rowspan="1">2</td></tr></tbody></table>';
    expect(await run(html)).toBe(html.replace('<br>', '<br />').replace('<hr>', '<hr />'));
  });
  test('links keep href (http, https, mailto, relative) and always get rel', async () => {
    expect(await run('<a href="https://a.example/x" target="_blank" onclick="x()" style="a:b">l</a>')).toBe('<a href="https://a.example/x" rel="noopener noreferrer nofollow">l</a>');
    expect(await run('<a href="mailto:a@b.c">m</a><a href="/p/1">r</a><a href="http://x.y">h</a>')).toBe(
      '<a href="mailto:a@b.c" rel="noopener noreferrer nofollow">m</a><a href="/p/1" rel="noopener noreferrer nofollow">r</a><a href="http://x.y" rel="noopener noreferrer nofollow">h</a>',
    );
    expect(await run('<a href="https://a.example" rel="opener">l</a>')).toContain('rel="noopener noreferrer nofollow"');
  });
  test('images keep src (ours) and alt only', async () => {
    expect(await run(`<img src="${ADMIN_SRC}" alt="logo" onerror="x()" width="9" style="x:y">`)).toBe(`<img src="${ADMIN_SRC}" alt="logo" />`);
    expect(await run(`<img src="https://cdn.example.com/f/${KEY}">`)).toBe(`<img src="https://cdn.example.com/f/${KEY}" />`);
  });
  test('images outside this admin are removed', async () => {
    expect(await run('<p>a</p><img src="https://evil.example/x.png"><img src="/other/x.png"><img src="//evil.example/x.png"><img>')).toBe('<p>a</p>');
  });
  test('without a public base only admin URLs are kept', async () => {
    const only = await createSanitizer({ adminPrefix: '/admin/api/files/' }, async () => (await import('sanitize-html')).default);
    expect(only(`<img src="https://cdn.example.com/f/${KEY}"><img src="${ADMIN_SRC}">`)).toBe(`<img src="${ADMIN_SRC}" />`);
  });
  test('without files configured every image is removed', async () => {
    const none = await createSanitizer(undefined, async () => (await import('sanitize-html')).default);
    expect(none(`<p>a</p><img src="${ADMIN_SRC}">`)).toBe('<p>a</p>');
  });
});

describe('Review Focus 5: XSS payloads are stripped', () => {
  const sanitize = createSanitizer(urls, async () => (await import('sanitize-html')).default);
  const payloads: Array<[string, string]> = [
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['img onerror with an admin src', `<img src="${ADMIN_SRC}" onerror="alert(1)">`],
    ['javascript: link', '<a href="javascript:alert(1)">x</a>'],
    ['javascript: link, obfuscated', '<a href="  jAvA&#x09;script:alert(1)">x</a>'],
    ['vbscript link', '<a href="vbscript:msgbox(1)">x</a>'],
    ['data: link', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
    ['script', '<p>a</p><script>alert(1)</script>'],
    ['script with src', '<script src="https://evil.example/x.js"></script>'],
    ['style', '<style>body{background:url(javascript:alert(1))}</style><p>a</p>'],
    ['style attribute', '<p style="background:url(javascript:alert(1))">a</p>'],
    ['iframe', '<iframe src="https://evil.example"></iframe><iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ['data: image', '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">'],
    ['data: image, png', '<img src="data:image/png;base64,AAAA">'],
    ['svg', '<svg onload="alert(1)"><script>alert(1)</script></svg>'],
    ['object and embed', '<object data="x.swf"></object><embed src="x.swf">'],
    ['event attribute', '<p onmouseover="alert(1)">a</p>'],
    ['form', '<form action="https://evil.example"><input name=x></form>'],
    ['base', '<base href="https://evil.example/">'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
  ];
  for (const [name, payload] of payloads) {
    test(name, async () => {
      const out = (await sanitize)(payload);
      expect(out).not.toMatch(/javascript:|vbscript:|data:|onerror|onload|onmouseover|<script|<style|<iframe|<svg|<object|<embed|<form|<base|<meta|alert\(|srcdoc|style=/i);
    });
  }
});
