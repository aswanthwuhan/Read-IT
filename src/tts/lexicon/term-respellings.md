# Book-name respellings (`book-lexicon.json`)

General ebooks are full of proper names that a speech engine's English front end
splits badly. A name such as *Tolkien* or *Szymborska* is pronounced with perfect
audio quality but the wrong phonemes, and the listener has no cue that the engine
— not the author — is wrong. The built-in rules in
[`book-lexicon.json`](book-lexicon.json) respell a small set of frequently
mispronounced literary names before synthesis.

The list is deliberately short. It is maintained by hand from names readers
actually meet in books: authors, characters and places from widely read fiction
and non-fiction. It is not a dictionary and it makes no claim to linguistic
authority — it is a fix for a small, observable failure in the on-device voices.

## Rules

- Every entry has a stable `b-N` id, a regex `pattern`, a plain-text
  `replacement` and `isRegex: true`. Seeding uses the id to keep a reader's
  on/off choice when the list is refreshed.
- Whole-word rules are written as `\b[Tt]olkien\b` so both a capitalised name at
  the start of a sentence and a lowercase mention are caught. The replacement
  uses hyphens to separate the syllables the voice should say: `Toll-keen`.
- Rules run in file order, user entries first. An entry can be switched off in
  Settings → Pronunciation but built-ins are not editable.
- A respelling must be idempotent: applying a rule to its own output changes
  nothing. Patterns must also compile on the oldest WebView the app supports;
  see [regex-portability.md](regex-portability.md).

## Adding a name

1. Confirm the name is mispronounced by the default voice on a real device.
2. Add one row to `book-lexicon.json` with the next free `b-N` id.
3. Add a focused case to `src/tts/lexicon/index.test.ts` so the rule cannot be
   lost in a later cleanup.
4. Keep the list to names with broad readership. Padding it with obscure names
   would slow every sentence for almost no benefit.

Reader-created rules live in the same table with `source: 'user'` and always run
before the built-ins, so a personal rule can override a shipped one.
