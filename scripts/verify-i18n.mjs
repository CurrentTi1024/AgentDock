/**
 * Full cross-check of every AgentDock i18n dictionary entry against the
 * public MyMemory translation API (en -> each target language).
 *
 * Usage:
 *   node --experimental-strip-types scripts/verify-i18n.mjs
 *
 * Env:
 *   I18N_THRESHOLD=0.45     minimum similarity before a key is flagged
 *   I18N_TARGETS=de,fr      run only these targets (comma separated)
 *   I18N_REPORT=/tmp/i18n-verify-report.json
 */
import { writeFileSync } from 'node:fs';
import { getDictionary } from '../src/i18n/dictionaries/index.ts';

const LOCALE_TO_CODE = {
  ar: 'ar', 'bg-BG': 'bg', 'de-DE': 'de', 'es-ES': 'es', 'fa-IR': 'fa',
  'fr-FR': 'fr', 'it-IT': 'it', 'ja-JP': 'ja', 'ko-KR': 'ko', 'nl-NL': 'nl',
  'pl-PL': 'pl', 'pt-BR': 'pt', 'ru-RU': 'ru', 'tr-TR': 'tr', 'vi-VN': 'vi',
};

const THRESHOLD = Number(process.env.I18N_THRESHOLD ?? 0.45);
const ONLY_TARGETS = process.env.I18N_TARGETS
  ? process.env.I18N_TARGETS.split(',').map((value) => value.trim())
  : null;
const REPORT_PATH = process.env.I18N_REPORT ?? '/tmp/i18n-verify-report.json';
// Point I18N_BASE_URL at a local Argos Translate server (scripts/argos-translate-server.py)
// to run without external quota, or keep the default MyMemory endpoint.
const BASE_URL = process.env.I18N_BASE_URL ?? 'https://api.mymemory.translated.net';
const BATCH_BYTES_LIMIT = 480;

const placeholderToToken = (value) =>
  value.replace(/\{(\w+)\}/g, (_, name) => `[${name.toUpperCase()}]`);

const normalize = (value) =>
  value
    .toLowerCase()
    .replace(/\[(name|date|count|page|total)\]/g, ' X ')
    .replace(/[^a-z0-9\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const levenshtein = (a, b) => {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
};

const similarity = (a, b) => {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  return 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class QuotaExceededError extends Error {}

const translate = async (text, target, attempt = 1) => {
  const url = `${BASE_URL}/get?q=${encodeURIComponent(text)}&langpair=en|${target}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.quotaFinished) throw new QuotaExceededError(`${target} quota finished`);
  if (data.responseStatus !== 200) {
    if (attempt < 3) {
      await sleep(1500 * attempt);
      return translate(text, target, attempt + 1);
    }
    throw new Error(`${target} API error: ${data.responseStatus} ${data.responseDetails}`);
  }
  return data.responseData.translatedText ?? '';
};

const bytes = (value) => new TextEncoder().encode(value).length;

const batchEntries = (entries) => {
  const batches = [];
  let current = [];
  let size = 0;
  for (const entry of entries) {
    const line = placeholderToToken(entry.source);
    const lineBytes = bytes(line) + 1;
    if (current.length > 0 && size + lineBytes > BATCH_BYTES_LIMIT) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push({ ...entry, line });
    size += lineBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
};

const en = getDictionary('en-US');
const allKeys = Object.keys(en);
const report = { generatedAt: new Date().toISOString(), threshold: THRESHOLD, results: {} };
let quotaHit = false;

for (const [locale, target] of Object.entries(LOCALE_TO_CODE)) {
  if (ONLY_TARGETS && !ONLY_TARGETS.includes(target)) continue;
  const dict = getDictionary(locale);
  const entries = allKeys.map((key) => ({ key, source: en[key], mine: dict[key] }));
  const flagged = [];
  let totalScore = 0;
  let exact = 0;
  let high = 0;
  let checkedCount = 0;

  for (const batch of batchEntries(entries)) {
    if (quotaHit) break;
    const text = batch.map((entry) => entry.line).join('\n');
    let machine;
    try {
      machine = await translate(text, target);
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        quotaHit = true;
        console.log(`QUOTA_FINISHED at ${locale} (${batch.length} entries left in batch)`);
        break;
      }
      throw error;
    }
    const lines = machine.split(/\r?\n/);
    if (lines.length !== batch.length) {
      // Batch alignment failed: retry every entry in this batch individually.
      for (const entry of batch) {
        if (quotaHit) break;
        try {
          machine = await translate(entry.line, target);
        } catch (error) {
          if (error instanceof QuotaExceededError) {
            quotaHit = true;
            break;
          }
          throw error;
        }
        const score = similarity(entry.mine, machine);
        totalScore += score;
        checkedCount += 1;
        if (score >= 0.95) exact += 1;
        if (score >= 0.8) high += 1;
        if (score < THRESHOLD) flagged.push({ key: entry.key, score, mine: entry.mine, machine });
        await sleep(100);
      }
      continue;
    }
    batch.forEach((entry, index) => {
      const score = similarity(entry.mine, lines[index]);
      totalScore += score;
      checkedCount += 1;
      if (score >= 0.95) exact += 1;
      if (score >= 0.8) high += 1;
      if (score < THRESHOLD) flagged.push({ key: entry.key, score, mine: entry.mine, machine: lines[index] });
    });
    await sleep(120);
  }

  report.results[locale] = {
    target,
    checked: checkedCount,
    average: totalScore / Math.max(1, checkedCount),
    exactCount: exact,
    highCount: high,
    flaggedCount: flagged.length,
    flagged,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(
    `== ${locale} | avg ${(totalScore / Math.max(1, entries.length)).toFixed(2)} | flagged ${flagged.length}/${entries.length}`,
  );
  if (flagged.length > 0) {
    console.log(`   lowest 3:`);
    [...flagged]
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .forEach(({ key, score, mine, machine }) => {
        console.log(`   [${score.toFixed(2)}] ${key}\n     mine   : ${mine}\n     machine: ${machine}`);
      });
  }
}

writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
console.log(`\nReport written to ${REPORT_PATH}`);
if (quotaHit) {
  console.log('NOTE: MyMemory daily quota was exhausted before completion; rerun remaining targets later.');
  process.exitCode = 2;
}
