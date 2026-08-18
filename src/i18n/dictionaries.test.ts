import assert from 'node:assert/strict';
import test from 'node:test';

import { getDictionary } from './dictionaries/index.ts';
import { SUPPORTED_LOCALES } from './locales.ts';

test('every supported locale resolves a complete dictionary', () => {
  const reference = getDictionary('en-US');
  const referenceKeys = Object.keys(reference);

  for (const locale of SUPPORTED_LOCALES) {
    const dict = getDictionary(locale);
    assert.deepEqual(
      Object.keys(dict).sort(),
      referenceKeys.sort(),
      `${locale} must cover exactly the same keys as en-US`,
    );
    for (const key of referenceKeys) {
      assert.ok(dict[key]?.length > 0, `${locale}:${key} must not be empty`);
    }
  }
});

test('translated values preserve all placeholder variables', () => {
  const reference = getDictionary('en-US');
  const placeholders = (value: string) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

  for (const locale of SUPPORTED_LOCALES) {
    const dict = getDictionary(locale);
    for (const key of Object.keys(reference)) {
      assert.deepEqual(
        placeholders(dict[key]),
        placeholders(reference[key]),
        `${locale}:${key} must keep the same placeholders`,
      );
    }
  }
});

test('non-English dictionaries are actually translated', () => {
  const reference = getDictionary('en-US');
  for (const locale of SUPPORTED_LOCALES.filter((candidate) => candidate !== 'en-US')) {
    const dict = getDictionary(locale);
    const identical = Object.keys(reference).filter((key) => dict[key] === reference[key]).length;
    // Proper nouns (Agent, FAB, Skill, MCP, A2UI…) may stay identical; the bulk must differ.
    assert.ok(identical < 30, `${locale} looks untranslated (${identical} keys equal en-US)`);
  }
});
