import type { CoverageDay } from '@/lib/types'
import {
  calendarCells,
  coverageDayLabel,
  moveCoverageDate,
} from '@/lib/coverage'

export default function CoverageCalendar({
  days,
  selected,
  onSelect,
}: {
  days: CoverageDay[]
  selected?: string
  onSelect: (date: string) => void
}) {
  return (
    <div
      className="coverage-calendar"
      role="region"
      aria-label="Observed data calendar"
    >
      <p id="coverage-keyboard">
        Use arrow keys to move dates, Home/End for the week, and Tab to leave
        the calendar. Selecting a date displays its details below.
      </p>
      <div className="coverage-weekdays" aria-hidden="true">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div
        className="coverage-grid"
        role="group"
        aria-label="Select observation date"
        aria-describedby="coverage-keyboard"
      >
        {calendarCells(days).map((day, i) =>
          !day ? (
            <span key={`pad-${i}`} aria-hidden="true" />
          ) : (
            <button
              type="button"
              key={day.date}
              data-coverage-date={day.date}
              className={`coverage-day ${day.observation_count ? 'has-observations' : ''}`}
              aria-pressed={selected === day.date}
              aria-label={coverageDayLabel(day)}
              title={coverageDayLabel(day)}
              tabIndex={selected === day.date ? 0 : -1}
              onClick={() => onSelect(day.date)}
              onKeyDown={(event) => {
                const next = moveCoverageDate(
                  day.date,
                  event.key,
                  days[0].date,
                  days.at(-1)!.date,
                )
                if (!next) return
                event.preventDefault()
                onSelect(next)
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLButtonElement>(
                      `[data-coverage-date="${next}"]`,
                    )
                    ?.focus(),
                )
              }}
            >
              <time dateTime={day.date}>{Number(day.date.slice(-2))}</time>
              <span>
                {day.observation_count
                  ? `${day.observation_count} rows`
                  : 'Not loaded'}
              </span>
              {!!(
                day.no_trade_count ||
                day.zero_volume_count ||
                day.thin_volume_count ||
                day.invalid_close_count
              ) && <span className="coverage-flag">Quality flags</span>}
              {!!day.ingestion_count && (
                <span>
                  {day.ingestion_count} file record
                  {day.ingestion_count === 1 ? '' : 's'}
                </span>
              )}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
