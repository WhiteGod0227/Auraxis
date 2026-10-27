import type { Resource } from '@/lib/useResource'
import type { SpreadsResponse, SpreadRow, SpreadPriceSource } from '@/lib/types'
import { explainComparison } from '@/lib/comparisonExplanation'
import { maturityMatchingChange } from '@/lib/relativeValue'
import { currency, formatDate, number } from '@/lib/format'

const reading = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? number.format(value)
    : 'Unavailable'
const percent = (value: number | null) =>
  value === null ? 'Unavailable' : `${reading(value)}% of B`

function SourceObservation({
  side,
  input,
}: {
  side: string
  input: SpreadPriceSource
}) {
  return (
    <tr>
      <th scope="row">
        {side}: {input.symbol}
      </th>
      <td>{formatDate(input.trade_date)}</td>
      <td>{formatDate(input.expiry_date)}</td>
      <td>{reading(input.close)}</td>
      <td>{input.quote_grams} g</td>
      <td>{reading(input.unit_factor)}</td>
      <td>{reading(input.close_p10_raw)}</td>
      <td>{reading(input.purity_factor)}</td>
      <td>{reading(input.close_p10_adjusted)}</td>
      <td>{input.has_trade ? 'Recorded trade' : 'No recorded trade'}</td>
      <td>{reading(input.volume_grams)}</td>
      <td>{reading(input.open_interest_grams)}</td>
    </tr>
  )
}

export default function ComparisonExplanation({
  resource,
  row,
  counterpart,
  counterpartRow,
}: {
  resource: Resource<SpreadsResponse>
  row?: SpreadRow
  counterpart: Resource<SpreadsResponse | null>
  counterpartRow?: SpreadRow
}) {
  const response = resource.response
  const data = response?.data
  const other = counterpart.response
  const comparable =
    !!response &&
    !!other?.data &&
    response.source === other.source &&
    data?.data_as_of === other.data.data_as_of &&
    (response.source !== 'Offline snapshot' ||
      response.generatedAt === other.generatedAt)
  const matchingChange =
    row && comparable && data
      ? maturityMatchingChange(
          row,
          counterpartRow,
          data.configuration.carry_adjusted,
        )
      : null
  const unavailable = resource.loading
    ? 'Loading this comparison…'
    : resource.error
      ? `Explanation unavailable: ${resource.error}`
      : !row || !data
        ? 'Explanation unavailable: no observation exists for the selected expiry.'
        : null
  const trace = row?.calculation
  return (
    <section
      className="comparison-explanation"
      aria-label="Comparison explanation and calculation"
    >
      <details>
        <summary>Explain this comparison</summary>
        {unavailable ? (
          <p role={resource.error ? 'alert' : 'status'}>{unavailable}</p>
        ) : (
          data &&
          row &&
          response && (
            <>
              <p className="section-description">
                {response.source} · Historical data as of{' '}
                {formatDate(data.data_as_of)}. Observation{' '}
                {formatDate(row.trade_date)}.
              </p>
              {response.generatedAt && (
                <p>Snapshot generated: {response.generatedAt}.</p>
              )}
              <p>
                Applied pair {data.configuration.pair}; expiry A{' '}
                {formatDate(row.expiry_a)}; window {data.configuration.window};
                minimum observations {data.configuration.min_periods}.
              </p>
              {explainComparison(data, row).map((sentence) => (
                <p key={sentence}>{sentence}</p>
              ))}
              {row.analytics_only && (
                <div aria-live="polite">
                  <p>
                    Maturity matching effect (on minus off):{' '}
                    {counterpart.loading
                      ? 'Loading comparison…'
                      : matchingChange === null
                        ? 'Unavailable for this exact observation and source'
                        : `${currency.format(matchingChange)} per ${data.normalization.base_grams} g`}
                    .
                  </p>
                  {other && <p>Counterpart source: {other.source}.</p>}
                  {counterpart.error && (
                    <p role="alert">
                      {counterpart.error}{' '}
                      <button className="button" onClick={counterpart.retry}>
                        Retry comparison
                      </button>
                    </p>
                  )}
                </div>
              )}
              <details>
                <summary>Technical diagnostics</summary>
                <pre>
                  {JSON.stringify(
                    {
                      reason: row.reason || null,
                      liquidity_reason: row.liquidity_reason || null,
                      source_tradable: row.source_tradable,
                      executable_pair: row.executable_pair,
                      comparison_type: row.comparison_type,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </>
          )
        )}
      </details>
      <details>
        <summary>View calculation</summary>
        {unavailable ? (
          <p>{unavailable}</p>
        ) : !trace || !row || !data ? (
          <p>
            Calculation inputs are unavailable for this result. The reported
            values remain usable; missing inputs have not been inferred.
          </p>
        ) : (
          <>
            <p>
              Inputs for {data.configuration.pair}, A expiry{' '}
              {formatDate(row.expiry_a)}, observation{' '}
              {formatDate(row.trade_date)}. Display values are rounded;
              calculations retain full precision.
            </p>
            <div
              className="table-scroll"
              role="region"
              aria-label="Calculation source observations"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    {[
                      'Component',
                      'Trade date',
                      'Actual expiry',
                      'Raw settlement (Rs)',
                      'Original quote unit',
                      'Unit factor',
                      'Unit-normalized settlement',
                      'Purity factor',
                      'Applied settlement',
                      'Trade status',
                      'Volume (g)',
                      'Open interest (g)',
                    ].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <SourceObservation side="A" input={trace.a} />
                  {trace.b_components.map((input, i) => (
                    <SourceObservation
                      side={`B${i + 1}`}
                      input={input}
                      key={`${input.symbol}-${input.expiry_date}`}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Unit conversion: raw settlement × {data.normalization.base_grams}{' '}
              / original quote grams. Purity adjustment{' '}
              {data.configuration.use_purity_adjustment
                ? `enabled (experimental): unit-normalized settlement × ${data.normalization.base_purity} / configured contract purity`
                : 'off: applied settlement equals unit-normalized settlement'}
              .
            </p>
            {data.configuration.use_purity_adjustment && (
              <p>
                Configured purities: A {trace.a.purity}; B{' '}
                {trace.b_components
                  .map((b) => `${b.symbol} ${b.purity}`)
                  .join(' / ') || 'Unavailable'}
                . These are experimental comparison assumptions.
              </p>
            )}
            <p>
              Comparison method:{' '}
              {row.comparison_type === 'same_expiry'
                ? 'Same actual expiry'
                : data.configuration.carry_adjusted
                  ? 'Maturity interpolation'
                  : 'Nearest actual expiry; no interpolation'}
              .
            </p>
            <p>
              B expiry minus A expiry (calendar days):{' '}
              {row.days_mismatch.length
                ? row.days_mismatch.join(' / ')
                : 'Unavailable'}
              . B component weights:{' '}
              {trace.b_weights.length
                ? trace.b_weights.map((w) => w.toString()).join(' / ')
                : 'Unavailable; matching was not calculated'}
              .
            </p>
            <p>
              {trace.b_components.length === 2
                ? 'Interpolation: B = lower settlement + upper weight × (upper settlement − lower settlement). Upper weight = (A expiry − lower expiry) / (upper expiry − lower expiry); lower weight = 1 − upper weight. Only same-observation inputs are used; no extrapolation.'
                : 'One selected component uses its own applied settlement directly, when valid.'}
            </p>
            <p>
              Final A = {reading(row.a_p10_999)}; final B ={' '}
              {reading(row.b_p10_999)}. Spread = A − B ={' '}
              {reading(row.spread_abs)}. Percentage = 100 × (A / B − 1) ={' '}
              {percent(row.spread_pct)}.
            </p>
            <p>
              Statistics use preceding finite percentage spreads from this
              A-expiry history, including non-tradable finite diagnostics.
              Window {data.configuration.window}; required minimum{' '}
              {data.configuration.min_periods}; actual preceding count{' '}
              {trace.preceding_finite_count}. Current observation is excluded
              from its own history.
            </p>
            <p>
              Mean = {percent(row.roll_mean)}; sample standard deviation (ddof =
              1) = {reading(row.roll_std)} percentage points. Z = (current
              percentage spread − preceding mean) / sample standard deviation ={' '}
              {reading(row.z)}.
            </p>
            <p>
              Percentile = 100 × (preceding values below current + 0.5 × ties) /
              preceding count = {reading(row.percentile)} out of 100. Missing
              values remain unavailable.
            </p>
            <p>
              Calculation transparency does not verify official contract
              equivalence. Settlements are not executable prices; maturity
              matching remains analytics only.
            </p>
            <details>
              <summary>Full precision and technical diagnostics</summary>
              <pre>
                {JSON.stringify(
                  {
                    ...trace,
                    spread_abs: row.spread_abs,
                    spread_pct: row.spread_pct,
                    roll_mean: row.roll_mean,
                    roll_std: row.roll_std,
                    z: row.z,
                    percentile: row.percentile,
                    reason: row.reason || null,
                    liquidity_reason: row.liquidity_reason || null,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </>
        )}
      </details>
    </section>
  )
}
