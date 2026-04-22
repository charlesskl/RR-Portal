/**
 * Normalizes a string for comparison purposes:
 * - Converts full-width characters (digits, letters) to ASCII via NFKC normalization
 * - Replaces non-breaking spaces (\u00A0) with regular spaces
 * - Trims leading and trailing whitespace
 * - Returns empty string for null/undefined input
 */
export function normalize(value: string | null | undefined): string {
  if (value == null) return ''
  return value
    .normalize('NFKC')          // full-width → ASCII (e.g., １２３ → 123,　 → space)
    .replace(/\u00A0/g, ' ')   // non-breaking space → regular space
    .trim()
}
