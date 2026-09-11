/**
 * Single source of truth for turning an i18next language tag into the BCP 47
 * locale passed to Intl / toLocaleString.
 *
 * Before this existed, each call site rolled its own two-way guess — some used
 * `startsWith('zh') ? 'zh-CN' : 'en-US'`, others `=== 'en' ? 'en-US' : 'zh-CN'`
 * — so adding a language changed nothing for date and time rendering, and a
 * Korean user could get Chinese-formatted dates. Adding a language now means
 * adding one entry here.
 *
 * The values match the `common.locale` string in each locale file; keep the two
 * in sync when adding a language.
 */
const LOCALE_BY_LANGUAGE: Record<string, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ko: 'ko-KR',
}

/**
 * Used when the detected language has no mapping. i18next is configured with
 * `fallbackLng: 'zh'`, so an unmapped language renders Chinese text; formatting
 * dates as zh-CN keeps the two consistent.
 */
const FALLBACK_LOCALE = 'zh-CN'

/**
 * Resolves an i18next language tag (`ko`, `ko-KR`, `zh-Hans-CN`, …) to the
 * locale to format dates, times and numbers with.
 */
export function resolveLocale(language?: string | null): string {
  if (!language) return FALLBACK_LOCALE

  const normalized = language.replace(/_/g, '-').toLowerCase()
  const exact = LOCALE_BY_LANGUAGE[normalized]
  if (exact) return exact

  const base = normalized.split('-')[0]
  return LOCALE_BY_LANGUAGE[base] ?? FALLBACK_LOCALE
}

export { FALLBACK_LOCALE, LOCALE_BY_LANGUAGE }
