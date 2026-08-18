export const SUPPORTED_LOCALES = [
  'ar',
  'bg-BG',
  'de-DE',
  'en-US',
  'es-ES',
  'fa-IR',
  'fr-FR',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'nl-NL',
  'pl-PL',
  'pt-BR',
  'ru-RU',
  'tr-TR',
  'vi-VN',
  'zh-CN',
  'zh-TW',
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  ar: 'العربية',
  'bg-BG': 'Български',
  'de-DE': 'Deutsch',
  'en-US': 'English',
  'es-ES': 'Español',
  'fa-IR': 'فارسی',
  'fr-FR': 'Français',
  'it-IT': 'Italiano',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'nl-NL': 'Nederlands',
  'pl-PL': 'Polski',
  'pt-BR': 'Português',
  'ru-RU': 'Русский',
  'tr-TR': 'Türkçe',
  'vi-VN': 'Tiếng Việt',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
};

export const isSupportedLocale = (locale: string): locale is Locale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(locale);

export const normalizeLocale = (locale: string | undefined): Locale => {
  if (!locale) return 'en-US';
  if (isSupportedLocale(locale)) return locale;
  const base = locale.toLowerCase();
  const match = (SUPPORTED_LOCALES as readonly string[]).find(
    (candidate) => candidate.toLowerCase() === base || candidate.toLowerCase().startsWith(base.split('-')[0]),
  );
  return (match as Locale | undefined) ?? 'en-US';
};
