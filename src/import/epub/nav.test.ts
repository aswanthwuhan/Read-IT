import { describe, expect, it } from 'vitest';
import { parseNavDocument, parseNcx } from './nav';

function navDoc(inner: string): Document {
  const source = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>${inner}</body></html>`;
  return new DOMParser().parseFromString(source, 'application/xhtml+xml');
}

function ncxDoc(inner: string): Document {
  const source = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">${inner}</ncx>`;
  return new DOMParser().parseFromString(source, 'text/xml');
}

describe('parseNavDocument', () => {
  it('reads nested toc lists with their depth', () => {
    const doc = navDoc(`
<nav epub:type="toc">
  <ol>
    <li><a href="ch1.xhtml">Chapter 1</a></li>
    <li><a href="part2.xhtml">Part 2</a>
      <ol>
        <li><a href="ch2.xhtml">Chapter 2</a></li>
        <li><a href="ch3.xhtml">Chapter 3</a>
          <ol>
            <li><a href="sec.xhtml">Section</a></li>
          </ol>
        </li>
      </ol>
    </li>
  </ol>
</nav>`);

    const entries = parseNavDocument(doc);

    expect(entries.map((entry) => entry.title)).toEqual(['Chapter 1', 'Part 2']);
    expect(entries[0]?.depth).toBe(0);
    expect(entries[0]?.href).toBe('ch1.xhtml');
    expect(entries[0]?.kind).toBe('toc');
    expect(entries[0]?.children).toEqual([]);

    const part = entries[1]!;
    expect(part.depth).toBe(0);
    expect(part.children.map((entry) => entry.title)).toEqual(['Chapter 2', 'Chapter 3']);
    expect(part.children[1]?.depth).toBe(1);
    expect(part.children[1]?.children[0]?.depth).toBe(2);
    expect(part.children[1]?.children[0]?.href).toBe('sec.xhtml');
  });

  it('flattens page-list entries', () => {
    const doc = navDoc(`
<nav epub:type="page-list">
  <ol>
    <li><a href="page-1.xhtml">1</a></li>
    <li><a href="page-2.xhtml">2</a>
      <ol><li><a href="page-2b.xhtml">2a</a></li></ol>
    </li>
  </ol>
</nav>`);

    const entries = parseNavDocument(doc);

    expect(entries.map((entry) => entry.href)).toEqual(['page-1.xhtml', 'page-2.xhtml', 'page-2b.xhtml']);
    expect(entries.every((entry) => entry.kind === 'page-list')).toBe(true);
    expect(entries.every((entry) => entry.depth === 0 && entry.children.length === 0)).toBe(true);
  });

  it('marks landmarks with their own kind', () => {
    const doc = navDoc(`
<nav epub:type="toc">
  <ol><li><a href="ch1.xhtml">Chapter 1</a></li></ol>
</nav>
<nav epub:type="landmarks">
  <ol>
    <li><a epub:type="bodymatter" href="text.xhtml">Start</a></li>
    <li><a epub:type="toc" href="nav.xhtml">Contents</a></li>
  </ol>
</nav>`);

    const landmarks = parseNavDocument(doc).filter((entry) => entry.kind === 'landmarks');

    expect(landmarks.map((entry) => entry.title)).toEqual(['Start', 'Contents']);
    expect(landmarks[0]?.href).toBe('text.xhtml');
    expect(landmarks[0]?.depth).toBe(0);
  });

  it('returns an empty outline when there is no nav', () => {
    expect(parseNavDocument(navDoc('<p>No navigation here.</p>'))).toEqual([]);
  });

  it('falls back to the first nav that has a list', () => {
    const doc = navDoc(`
<nav>
  <ol><li><a href="ch1.xhtml">Chapter 1</a></li></ol>
</nav>`);

    const entries = parseNavDocument(doc);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('toc');
    expect(entries[0]?.title).toBe('Chapter 1');
  });

  it('reads epub:type through the namespace when the prefix differs', () => {
    const source = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ops="http://www.idpf.org/2007/ops">
<body>
  <nav ops:type="toc"><ol><li><a href="ch1.xhtml">Chapter 1</a></li></ol></nav>
</body></html>`;
    const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');

    const entries = parseNavDocument(doc);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe('Chapter 1');
  });

  it('skips entries with no href or empty text but keeps their children', () => {
    const doc = navDoc(`
<nav epub:type="toc">
  <ol>
    <li><a href="blank.xhtml">   </a></li>
    <li><span>Untitled group</span>
      <ol><li><a href="ch1.xhtml">Chapter 1</a></li></ol>
    </li>
    <li><a href="ch2.xhtml">Chapter 2</a></li>
  </ol>
</nav>`);

    const entries = parseNavDocument(doc);

    expect(entries.map((entry) => entry.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(entries.map((entry) => entry.href)).toEqual(['ch1.xhtml', 'ch2.xhtml']);
  });

  it('does not throw on an empty document', () => {
    const doc = new DOMParser().parseFromString('', 'application/xhtml+xml');
    expect(parseNavDocument(doc)).toEqual([]);
  });
});

describe('parseNcx', () => {
  it('walks navPoints recursively with their depth', () => {
    const doc = ncxDoc(`
<navMap>
  <navPoint id="p1">
    <navLabel><text>Chapter 1</text></navLabel>
    <content src="ch1.xhtml"/>
  </navPoint>
  <navPoint id="p2">
    <navLabel><text>Part 2</text></navLabel>
    <content src="part2.xhtml"/>
    <navPoint id="p2-1">
      <navLabel><text>Chapter 2</text></navLabel>
      <content src="ch2.xhtml"/>
      <navPoint id="p2-1-1">
        <navLabel><text>Section</text></navLabel>
        <content src="sec.xhtml"/>
      </navPoint>
    </navPoint>
  </navPoint>
</navMap>`);

    const entries = parseNcx(doc);

    expect(entries.map((entry) => entry.title)).toEqual(['Chapter 1', 'Part 2']);
    expect(entries[0]?.depth).toBe(0);
    expect(entries[0]?.href).toBe('ch1.xhtml');
    expect(entries[0]?.kind).toBe('toc');
    expect(entries[1]?.children[0]?.depth).toBe(1);
    expect(entries[1]?.children[0]?.href).toBe('ch2.xhtml');
    expect(entries[1]?.children[0]?.children[0]?.depth).toBe(2);
    expect(entries[1]?.children[0]?.children[0]?.title).toBe('Section');
  });

  it('returns an empty outline without a navMap', () => {
    expect(parseNcx(ncxDoc('<docTitle><text>Title</text></docTitle>'))).toEqual([]);
  });

  it('does not throw on missing content or malformed nesting', () => {
    const doc = ncxDoc(`
<navMap>
  <navPoint>
    <navLabel><text>No target</text></navLabel>
    <navPoint>
      <navLabel><text>Chapter 1</text></navLabel>
      <content src="ch1.xhtml"/>
    </navPoint>
  </navPoint>
</navMap>`);

    let entries: ReturnType<typeof parseNcx> = [];
    expect(() => {
      entries = parseNcx(doc);
    }).not.toThrow();
    expect(entries.map((entry) => entry.title)).toEqual(['Chapter 1']);
    expect(entries[0]?.href).toBe('ch1.xhtml');
  });

  it('does not throw on an empty document', () => {
    const doc = new DOMParser().parseFromString('', 'text/xml');
    expect(parseNcx(doc)).toEqual([]);
  });
});
