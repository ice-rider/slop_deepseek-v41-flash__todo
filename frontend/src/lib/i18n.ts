/**
 * Locale used for dates and relative times.
 *
 * Derived from the document language so the interface copy and its dates always
 * agree (the app ships English copy today, and a translated build only needs to
 * change `<html lang>`).
 */
export const LOCALE: string =
  (typeof document !== 'undefined' && document.documentElement.lang) || 'en'

/** Format a date with the app locale. */
export function formatDate(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(LOCALE, options)
}

/** Format a date and time with the app locale. */
export function formatDateTimeLocale(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(LOCALE, options)
}
