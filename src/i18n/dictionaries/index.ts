import ar from './ar.ts';
import bgBG from './bg-BG.ts';
import deDE from './de-DE.ts';
import enUS from './en-US.ts';
import esES from './es-ES.ts';
import faIR from './fa-IR.ts';
import frFR from './fr-FR.ts';
import itIT from './it-IT.ts';
import jaJP from './ja-JP.ts';
import koKR from './ko-KR.ts';
import nlNL from './nl-NL.ts';
import plPL from './pl-PL.ts';
import ptBR from './pt-BR.ts';
import ruRU from './ru-RU.ts';
import trTR from './tr-TR.ts';
import viVN from './vi-VN.ts';
import zhCN from './zh-CN.ts';
import zhTW from './zh-TW.ts';

const dictionaries = {
  ar,
  'bg-BG': bgBG,
  'de-DE': deDE,
  'en-US': enUS,
  'es-ES': esES,
  'fa-IR': faIR,
  'fr-FR': frFR,
  'it-IT': itIT,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'nl-NL': nlNL,
  'pl-PL': plPL,
  'pt-BR': ptBR,
  'ru-RU': ruRU,
  'tr-TR': trTR,
  'vi-VN': viVN,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
} as const;

export type DictionaryKey = keyof typeof enUS;

export const getDictionary = (locale: string): Record<string, string> => {
  const partial = (dictionaries as Record<string, Record<string, string>>)[locale];
  return { ...enUS, ...(partial ?? {}) };
};
