// Print sheet tests: node --test tools/sheet.test.mjs
// (in tools/ so tools/build_sw.py does not precache it)
// js/app.js is one browser IIFE; the pure previewSheetCss() is cut out of it
// and run on its own. The preview's sheet and the saved HTML file share the
// paper margin and the print look; only the preview has a fixed A4 width and
// page-end lines, and nothing on-screen reaches print or the PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const start = src.indexOf('    function previewSheetCss(');
const end = src.indexOf('\n    }\n', start) + 6;
assert.ok(start > 0 && end > start, 'previewSheetCss is in js/app.js');
const previewSheetCss = new Function(src.slice(start, end) + '\nreturn previewSheetCss;')();
const A4 = { w: 210, h: 297, margin: 14 };

// The CSS outside any @media screen block, i.e. what print and the PDF see.
function offScreen(css) {
  let out = '', i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media screen{', i);
    if (at < 0) { out += css.slice(i); break; }
    out += css.slice(i, at);
    let depth = 0, k = at;
    for (; k < css.length; k++) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}' && --depth === 0) break;
    }
    i = k + 1;
  }
  return out;
}

test('preview and file print alike: same @page margin and print look', () => {
  const pv = offScreen(previewSheetCss(A4, false)).replace('@media print{.pv-break{display:none!important;}}', '');
  const file = offScreen(previewSheetCss(A4, true));
  assert.equal(pv, file);
  assert.match(file, /@page\{margin:14mm;\}/);
  assert.match(file, /#printSheet\{display:block;\}/);
});

test('only the preview has page-end lines and a fixed A4 sheet', () => {
  const pv = previewSheetCss(A4, false);
  const file = previewSheetCss(A4, true);
  assert.match(pv, /\.pv-break\{/);
  assert.match(pv, /body\{width:210mm;min-height:297mm;/);
  assert.doesNotMatch(file, /pv-break/);
  assert.doesNotMatch(file, /min-height:297mm|[{;]width:/);
  assert.match(file, /max-width:182mm/);
});

test('the braces balance', () => {
  for (const f of [false, true]) {
    const css = previewSheetCss(A4, f);
    assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
  }
});
