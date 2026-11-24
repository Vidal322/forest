import { addDays, daysBetween, formatDay } from '../domain/dates'

const daysAgo = (n: number) => (n === 1 ? 'yesterday' : `${n} days ago`)

/** How far back the slider reaches; the date box goes further. */
export const AS_OF_SLIDER_DAYS = 60

/**
 * "Show state as of": pick a past day to recolour the zones as they were then.
 * `asOf` null = today. A date box (any day) and a slider over the last 60 days
 * (drag left to go back, right end = today).
 */
export function AsOfControl({
  asOf,
  today,
  onChange,
}: {
  asOf: string | null
  today: string
  onChange: (day: string | null) => void
}) {
  const day = asOf ?? today
  const back = daysBetween(day, today)
  const pick = (d: string) => onChange(!d || d >= today ? null : d)
  return (
    <fieldset className="asof">
      <legend>Show state as of</legend>
      <input
        type="date"
        className="asof__date"
        aria-label="Date"
        value={day}
        max={today}
        onChange={(e) => pick(e.target.value)}
      />
      <input
        type="range"
        className="asof__slider"
        aria-label="Days back"
        aria-valuetext={back === 0 ? 'Today' : `${formatDay(day, today)}, ${daysAgo(back)}`}
        min={0}
        max={AS_OF_SLIDER_DAYS}
        step={1}
        value={AS_OF_SLIDER_DAYS - Math.min(back, AS_OF_SLIDER_DAYS)}
        onChange={(e) => pick(addDays(today, Number(e.target.value) - AS_OF_SLIDER_DAYS))}
      />
      <p className="muted asof__hint">
        {back === 0 ? 'Today. Drag left to see the field earlier.' : `Colours as on ${formatDay(day, today)}, from what was logged up to then.`}
      </p>
    </fieldset>
  )
}

/** On top of the map while it shows a past day: which day, and one tap back to today. */
export function AsOfBanner({
  asOf,
  today,
  loading,
  failed,
  onToday,
}: {
  asOf: string
  today: string
  loading: boolean
  /** the past day couldn't be loaded (no signal): the colours are today's */
  failed: string | null
  onToday: () => void
}) {
  return (
    <output className={`asof-banner${failed ? ' asof-banner--warn' : ''}`}>
      <span className="asof-banner__text">
        <strong>Viewing {formatDay(asOf, today)}</strong>
        <span className="muted asof-banner__ago">
          {daysAgo(daysBetween(asOf, today))}
          {loading && !failed && ' · loading…'}
        </span>
        {failed && <span className="asof-banner__error">{failed}</span>}
      </span>
      <button type="button" className="btn asof-banner__today" onClick={onToday}>
        Back to today
      </button>
    </output>
  )
}
