import { describe, expect, it } from 'vitest';
import { blocksFromRoot } from './html';

function xhtml(inner: string): Element {
  const source = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>${inner}</body></html>`;
  const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
  return doc.body;
}

describe('blocksFromRoot footnotes', () => {
  it('keeps a note aside instead of dropping it', () => {
    const seeds = blocksFromRoot(
      xhtml('<p>Thiazides act on the distal tubule.</p><aside epub:type="footnote"><p>Smith 2019.</p></aside>'),
    );

    expect(seeds.map((seed) => seed.kind)).toEqual(['p', 'footnote']);
    expect(seeds[1]?.text).toBe('Smith 2019.');
  });

  it('still leaves a plain sidebar aside out of the flow', () => {
    const seeds = blocksFromRoot(xhtml('<aside><p>Sidebar text.</p></aside>'));

    expect(seeds).toEqual([]);
  });

  it('does not splice a note into the paragraph that references it', () => {
    const seeds = blocksFromRoot(
      xhtml('<p>Main text<aside epub:type="endnote">A note.</aside> continues here.</p>'),
    );

    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.text).toBe('Main text continues here.');
  });

  it('still drops scripts, styles and svg', () => {
    const seeds = blocksFromRoot(xhtml('<p>Text.</p><script>x()</script><svg><text>graphic</text></svg>'));

    expect(seeds.map((seed) => seed.text)).toEqual(['Text.']);
  });
});
