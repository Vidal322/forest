const NUMBER = new Intl.NumberFormat('pt-PT')

/** A number as written in Portugal: decimal comma ("0,5"); 4-digit numbers aren't grouped ("1200", "12 000"). */
export function formatNumber(v: number): string {
  return NUMBER.format(v)
}
