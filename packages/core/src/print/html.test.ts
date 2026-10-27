import { describe, expect, test } from 'bun:test';
import { html, raw } from './html.js';

describe('html', () => {
  test('escapes values, keeps nested html and raw, joins arrays, drops null/undefined/false', () => {
    const name = '<b>"Tom" & \'Jerry\'</b>';
    const rows = ['a<', 'b'].map((value) => html`<li>${value}</li>`);
    expect(String(html`<p title="${name}">${name}</p><ul>${rows}</ul>${raw('<hr>')}${null}${undefined}${false}${0}`)).toBe(
      '<p title="&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;">&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;</p><ul><li>a&lt;</li><li>b</li></ul><hr>0',
    );
  });
});
