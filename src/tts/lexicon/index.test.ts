import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../core/db';
import {
  BUILTIN_LEXICON,
  applyEntry,
  deleteUserEntry,
  entryGroup,
  expand,
  invalidate,
  lexiconVersion,
  listLexiconEntries,
  saveUserEntry,
  seedLexicon,
  setEntryEnabled,
} from './index';

// The native variant is only relevant to Android Kokoro; tests run on the web path.
const native = vi.hoisted(() => ({ value: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value },
}));

afterEach(async () => {
  native.value = false;
  await db.delete();
  await db.open();
  invalidate();
});

describe('seedLexicon', () => {
  it('writes every built-in entry once', async () => {
    await seedLexicon();
    await seedLexicon();

    const rows = await db.lexicon.where('source').equals('builtin').toArray();
    expect(rows).toHaveLength(BUILTIN_LEXICON.length);
    expect(rows.every((r) => r.id.startsWith('b-'))).toBe(true);
  });

  it('re-seeds changed built-ins but keeps user toggles and user rows', async () => {
    await seedLexicon();
    await setEntryEnabled('b-1', false);
    await saveUserEntry({ pattern: 'Caoimhe', replacement: 'Kee-va', isRegex: true });

    await db.lexicon.update('b-2', { pattern: 'stale-pattern' });
    invalidate();
    await seedLexicon();

    expect((await db.lexicon.get('b-1'))?.enabled).toBe(false);
    const b2 = BUILTIN_LEXICON.find((e) => e.id === 'b-2');
    expect((await db.lexicon.get('b-2'))?.pattern).toBe(b2?.pattern);
    expect((await db.lexicon.where('source').equals('user').count())).toBe(1);
  });
});

describe('expand', () => {
  it('applies built-in pronunciation overrides', async () => {
    await expect(expand('Tolkien wrote about Maeve.')).resolves.toBe('Toll-keen wrote about Mayv.');
    await expect(expand('Don Quixote met Ptolemy.')).resolves.toBe('Don Kee-ho-tay met Tol-eh-mee.');
  });

  it('applies user rules before built-ins and respects disabled rows', async () => {
    await saveUserEntry({ pattern: '\\bTolkien\\b', replacement: 'Custom-name', isRegex: true });
    await expect(expand('Tolkien')).resolves.toBe('Custom-name');

    await setEntryEnabled('b-1', false);
    await db.lexicon.where('source').equals('user').delete();
    invalidate();
    await expect(expand('Tolkien')).resolves.toBe('Tolkien');
  });

  it('keeps the lexicon version stable for the same enabled rules', async () => {
    const first = await lexiconVersion();
    const second = await lexiconVersion();
    expect(first).toBe(second);
  });
});

describe('editor helpers', () => {
  it('refuses unsupported user regexes and skips them when loaded from existing data', async () => {
    const rule = { pattern: 'cat|dog', replacement: 'pet', isRegex: true };
    await expect(saveUserEntry(rule)).rejects.toThrow(/fixed-text regex/);
    expect(applyEntry('cat dog', { ...rule, id: 'u-1', source: 'user', enabled: true })).toBe('cat dog');
  });

  it('lists, saves and deletes user entries', async () => {
    const saved = await saveUserEntry({ pattern: 'Siobhan', replacement: 'Shi-vawn', isRegex: true });
    const listed = await listLexiconEntries();
    expect(listed.some((e) => e.id === saved.id)).toBe(true);

    await deleteUserEntry(saved.id);
    expect(await db.lexicon.get(saved.id)).toBeUndefined();
  });

  it('reports entry groups', () => {
    expect(entryGroup('b-1')).toBe('core');
    expect(entryGroup('term-1')).toBe('term');
  });

  it('applies a plain-string entry literally', () => {
    expect(applyEntry('a & b', { id: 'u1', pattern: '&', replacement: 'and', isRegex: false, source: 'user', enabled: true })).toBe('a and b');
  });
});
