import { useOutletContext } from 'react-router-dom'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { historicalMetadata } from '@/lib/dataHealth'
import { formatDate } from '@/lib/format'
import type { DashboardContext } from '@/layouts/AppLayout'
const loadSpreads = (signal: AbortSignal) =>
  api.spreads({ pair: 'GOLDTEN-GOLDPETAL' }, signal)
const loadBacktest = (signal: AbortSignal) =>
  api.backtest({ pair: 'GOLDTEN-GOLDPETAL' }, signal)
const sections = [
  ['purpose', 'Purpose and data'],
  ['normalization', 'Normalization'],
  ['statistics', 'Spreads and historical statistics'],
  ['maturity', 'Maturity comparisons'],
  ['term-structure', 'Term structure and roll-down'],
  ['execution', 'Simulation execution'],
  ['sizing', 'Sizing and costs'],
  ['reporting', 'Reporting and cost sensitivity'],
  ['offline', 'Offline mode'],
  ['limitations', 'Limitations'],
] as const
export function MethodologyPage() {
  const { meta } = useOutletContext<DashboardContext>()
  const spreads = useResource(loadSpreads)
  const backtest = useResource(loadBacktest)
  const catalog = useResource(api.snapshotCatalog)
  const historical = historicalMetadata(meta.response?.data)
  const normalization = meta.response?.data.normalization
  const spreadCfg = spreads.response?.data.configuration
  const simulationCfg = backtest.response?.data.configuration
  const snapshot = catalog.response?.data
  return (
    <div className="overview-page methodology-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">IMPLEMENTED METHODS & LIMITATIONS</p>
          <h1>Methodology</h1>
          <p className="page-description">
            How Auraxis compares historical gold contracts, and what its
            diagnostics and settlement-based simulations can establish.
          </p>
        </div>
      </div>
      <nav
        className="panel method-navigation"
        aria-label="Methodology sections"
      >
        {sections.map(([id, title]) => (
          <a key={id} href={`#method-${id}`}>
            {title}
          </a>
        ))}
      </nav>
      <section className="panel" id="method-purpose" tabIndex={-1}>
        <h2>Purpose and data</h2>
        <p>
          Compare gold contracts after accounting for quote units, assumed
          purity, maturity and observation quality. The source is historical
          daily Bhavcopy CSV data, not live quotes. A short prototype window
          does not establish profitability.
        </p>
        {meta.response && (
          <span
            className={`source-badge ${meta.response.source === 'Offline snapshot' ? 'offline' : ''}`}
          >
            {meta.response.source}
          </span>
        )}
        {meta.loading && <p role="status">Loading current metadata...</p>}
        {meta.error && (
          <div className="error-notice" role="alert">
            <p>Current metadata unavailable: {meta.error}</p>
            <button className="button" onClick={meta.retry}>
              Retry metadata
            </button>
          </div>
        )}
        {historical ? (
          <p className="method-current-window">
            Current historical window: {formatDate(historical.first)} to{' '}
            {formatDate(historical.last)}. Data as of{' '}
            {formatDate(historical.asOf)}; {historical.sessions} stored trading
            sessions. Purity verification: {historical.purity}.
          </p>
        ) : (
          <p className="method-current-window">
            Current historical window, data_as_of, session count and purity
            metadata: unavailable. The established methods below remain
            readable.
          </p>
        )}
      </section>
      <section className="panel" id="method-normalization" tabIndex={-1}>
        <h2>Normalization</h2>
        <p>
          Original prices and observation flags are retained. Raw normalized
          prices convert quote size; purity-adjusted prices additionally apply
          the assumed purity ratio. Missing prices stay missing. Unknown
          products raise an error rather than receiving guessed specifications.
        </p>
        <details className="method-formula">
          <summary>View calculation details</summary>
          <code>price_p10_raw = price * base_grams / quote_grams</code>
          <code>
            price_p10_999 = price_p10_raw * base_purity / assumed_purity
          </code>
        </details>
        <p>
          With purity adjustment disabled, *_p10_999 equals *_p10_raw despite
          its column name. Signals may use adjusted prices; held-contract
          simulation P&amp;L uses raw normalized prices.
        </p>
        {normalization ? (
          <>
            <p>
              Current base: {normalization.base_grams} g; base purity{' '}
              {normalization.base_purity}; unit {normalization.unit}. Default
              purity adjustment:{' '}
              {String(normalization.default_purity_adjustment)}. Verification:{' '}
              <strong>{normalization.purity_verification_status}</strong>.
            </p>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Configured quote and purity assumptions"
            >
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Quote grams</th>
                    <th>Assumed purity</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(normalization.quote_grams).map((product) => (
                    <tr key={product}>
                      <td>{product}</td>
                      <td>{normalization.quote_grams[product]}</td>
                      <td>
                        {normalization.purity_assumptions[product] ??
                          'Unavailable'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>
            Configured base, product quote sizes and purity values: unavailable.
          </p>
        )}
        <p>
          These purity assumptions come from the problem statement and remain
          provisional as a cross-contract price conversion. Official MCX
          specifications confirm the configured quotation units, trading lots
          and delivery qualities; delivery purity alone does not establish that
          quoted prices should be multiplied by 999/995. GOLDPETAL is quoted
          ex-Mumbai while GOLDM, GOLDTEN and GOLDGUINEA are ex-Ahmedabad.
          Location and delivery basis differences remain; normalized gaps are
          diagnostics, not proof of equivalent executable prices.
        </p>
      </section>
      <section className="panel" id="method-statistics" tabIndex={-1}>
        <h2>Spreads and historical statistics</h2>
        <p>
          Historical windows include preceding finite spread observations even
          when liquidity fails. Undefined spreads do not count. This preserved
          diagnostic policy can affect z-scores; liquidity failure never permits
          a simulated fill.
        </p>
        <details className="method-formula">
          <summary>View calculation details</summary>
          <code>spread_abs = A - B</code>
          <code>spread_pct = 100 * (A / B - 1)</code>
          <code>z = (current_spread_pct - preceding_mean) / preceding_std</code>
          <code>
            percentile = 100 * (count(past &lt; current) + 0.5 * count(past =
            current)) / count(past)
          </code>
        </details>
        <p>
          Positive spread means A exceeds B after normalization. Positive z
          means the spread is above its own preceding mean; these are different
          statements.
        </p>
        <p>
          Histories are separate by fixed A expiry. The rolling window contains
          the last configured number of earlier finite spread observations,
          excluding the current day. Missing/non-finite spreads do not enter
          history; finite non-tradable spreads do. Standard deviation uses
          ddof=1 (sample standard deviation). Statistics require the configured
          minimum periods; z is unavailable for insufficient history or
          zero/undefined standard deviation. The percentile is an empirical
          0-100 scale with half credit for ties.
        </p>
        <p>
          The mean +/- two standard-deviation band is descriptive in percentage
          points, not a confidence interval. Reference crossings do not
          establish convergence, executable opportunities or profitability.
        </p>
        {spreads.response && (
          <span
            className={`source-badge ${spreads.response.source === 'Offline snapshot' ? 'offline' : ''}`}
          >
            {spreads.response.source}
          </span>
        )}
        {spreadCfg ? (
          <p className="method-spread-defaults">
            Returned endpoint defaults for {spreadCfg.pair}: window{' '}
            {spreadCfg.window}; min_periods {spreadCfg.min_periods}; volume{' '}
            {spreadCfg.min_volume_grams} g; open interest{' '}
            {spreadCfg.min_oi_grams} g; purity{' '}
            {String(spreadCfg.use_purity_adjustment)}; carry{' '}
            {String(spreadCfg.carry_adjusted)}.
          </p>
        ) : (
          <p>
            Current spread endpoint defaults:{' '}
            {spreads.loading ? 'loading' : 'unavailable'}.
          </p>
        )}
        {spreads.error && (
          <div className="error-notice">
            <p>{spreads.error}</p>
            <button className="button" onClick={spreads.retry}>
              Retry spread metadata
            </button>
          </div>
        )}
      </section>
      <section className="panel" id="method-maturity" tabIndex={-1}>
        <h2>Maturity comparisons</h2>
        <p>
          Same-expiry products are compared at the same fixed expiry, without
          stitching a continuous near-month series. GOLDM normally has a
          different maturity schedule, so its comparisons remain analytics only.
        </p>
        <p>
          Maturity matching on uses the same date's nearest lower and upper B expiries
          bracketing A. A linear calendar-day weight interpolates B between
          them. An exact shared expiry uses that one B observation. If either
          bracket is absent, there is no extrapolation; the comparison is
          unavailable. An untraded required B bracket also makes the
          interpolated comparison unavailable.
        </p>
        <details className="method-formula">
          <summary>View calculation details</summary>
          <code>
            weight = (expiry_A - expiry_B_lower) / (expiry_B_upper -
            expiry_B_lower)
          </code>
          <code>B_comparison = B_lower + weight * (B_upper - B_lower)</code>
        </details>
        <p>
          Maturity matching off chooses the B expiry with the smallest absolute calendar-day
          distance; a tie chooses the earlier expiry. Maturity differences are
          signed B expiry minus A expiry. Adjustment can widen, shrink or
          reverse the measured gap. Synthetic prices are not executable fills,
          and passing liquidity screening does not override analytics-only
          status. Same-expiry structural eligibility is also not a fill
          guarantee.
        </p>
      </section>
      <section className="panel" id="method-term-structure" tabIndex={-1}>
        <h2>Term structure and roll-down</h2>
        <p>
          The curve uses numeric calendar days from its actual observation date
          to expiry. Expired contracts are excluded; expiry-day observations are
          included. Untraded/missing points break the traded line and remain in
          the supporting table.
        </p>
        <p>
          Roll-down compares consecutive available product observation dates for
          a fixed expiry. At the previous observation it uses this contract and
          the immediate later unexpired contract, including an immediate
          neighbour that is untraded or missing a usable price rather than
          skipping to a better one.
        </p>
        <details className="method-formula">
          <summary>View calculation details</summary>
          <code>
            previous_slope_per_day = (next_price_previous -
            contract_price_previous) / (next_expiry - contract_expiry)
          </code>
          <code>
            estimated_roll_down = -previous_slope_per_day *
            elapsed_calendar_days
          </code>
          <code>
            raw_change = contract_price_current - contract_price_previous
          </code>
          <code>residual_change = raw_change - estimated_roll_down</code>
        </details>
        <p>
          This is a local linear, constant-shape approximation in
          time-to-expiry, using previous-curve inputs only. Weekend gaps use
          calendar days. Residual is not proven mispricing or causal
          attribution; roll-down is not a cash payment.
        </p>
        <p>
          Invalid-reason precedence is: missing_observation; expired_contract;
          no_trade; invalid_price for the held contract; no_next_expiry;
          next_expiry_no_trade; invalid_price for the next contract. A
          calculable raw change can remain available even when decomposition is
          invalid. Estimated roll-down and residual remain unavailable; the
          latest invalid row is not replaced with an older valid one.
        </p>
      </section>
      <section className="panel" id="method-execution" tabIndex={-1}>
        <h2>Simulation execution</h2>
        <ol>
          <li>
            A signal is formed at close of t. An entry at or below the negative
            entry threshold is long A/short B; at or above the positive
            threshold it is short A/long B.
          </li>
          <li>
            A pending order is considered at the next available database session
            close. The calendar uses available Bhavcopy dates across all
            products, not an invented weekday calendar.
          </li>
          <li>
            Entry eligibility is checked again. An entry is cancelled if the
            expiry buffer or required
            observation/price/trade/volume/open-interest conditions fail. Entry
            orders also require eligibility when generated. Execution does not
            re-check the original z threshold; execution-date z is recorded
            separately.
          </li>
          <li>
            A pending exit executes only while expiry permits and both legs are
            eligible. Otherwise it stays pending and blocked attempts are
            recorded; repeated attempts are not additional positions.
          </li>
          <li>
            After execution, remaining positions are marked. An unclosed
            position becomes unresolved_expiry on or after expiry. Exit reasons
            are considered in precedence order: expiry buffer, maximum holding,
            then absolute z within the exit threshold.
          </li>
          <li>
            An entry cannot exit at its own close. An exit can generate a fresh
            entry order at that close, but the new entry must wait for a later
            available session.
          </li>
        </ol>
        <p>
          Holding sessions equal current database session index minus entry
          index; entry day is zero. A maximum-hold or z-exit condition generates
          an order for a later close, and blocked exits can extend holding.
          Entry buffer comparisons include the boundary (days to expiry &lt;=
          buffer). There is no artificial final-date liquidation. Outstanding
          positions remain open; expired unresolved positions have unknown final
          outcomes.
        </p>
      </section>
      <section className="panel" id="method-sizing" tabIndex={-1}>
        <h2>Sizing and costs</h2>
        <details className="method-formula">
          <summary>View calculation details</summary>
          <code>
            signed_quantity_10g = leg_sign * notional_per_leg /
            entry_raw_normalized_price
          </code>
          <code>
            leg_cost_per_side = abs(quantity_10g * raw_normalized_price) *
            cost_bps / 10000
          </code>
          <code>gross_notional_reference_capital = 2 * notional_per_leg</code>
        </details>
        <p>
          Quantities remain fixed at entry. Fractional mode uses idealized
          fractional 10g units; integer mode rounds each leg down to exchange
          lots and reports residual exposure. Costs apply to each leg at entry
          and exit; configured bps are illustrative assumptions, not verified
          actual fees. Signals use the selected purity basis while quantity,
          costs and held-contract P&amp;L use raw normalized prices. Both leg
          notionals define a gross-notional reference denominator, not margin
          capital or actual cash invested.
        </p>
        {backtest.response && (
          <span
            className={`source-badge ${backtest.response.source === 'Offline snapshot' ? 'offline' : ''}`}
          >
            {backtest.response.source}
          </span>
        )}
        {simulationCfg ? (
          <div className="method-simulation-defaults">
            <p>
              Returned simulation endpoint defaults for {simulationCfg.pair}:
              entry z {simulationCfg.z_entry}; exit z {simulationCfg.z_exit};
              max hold {simulationCfg.max_hold_sessions} sessions; expiry buffer{' '}
              {simulationCfg.expiry_buffer_calendar_days} calendar days.
            </p>
            <p>
              window {simulationCfg.window}; min_periods{' '}
              {simulationCfg.min_periods}; notional per leg{' '}
              {simulationCfg.notional_per_leg} Rs; cost{' '}
              {simulationCfg.cost_bps_per_leg_per_side} bps per leg per side;
              volume {simulationCfg.min_volume_grams} g; OI{' '}
              {simulationCfg.min_oi_grams} g; purity{' '}
              {String(simulationCfg.use_purity_adjustment)}.
            </p>
          </div>
        ) : (
          <p>
            Current simulation endpoint defaults:{' '}
            {backtest.loading ? 'loading' : 'unavailable'}.
          </p>
        )}
        {backtest.error && (
          <div className="error-notice">
            <p>{backtest.error}</p>
            <button className="button" onClick={backtest.retry}>
              Retry simulation metadata
            </button>
          </div>
        )}
      </section>
      <section className="panel" id="method-reporting" tabIndex={-1}>
        <h2>Reporting and cost sensitivity</h2>
        <p>
          Realized net P&amp;L is completed gross P&amp;L less closed-trade
          costs. Open and unresolved-expiry marked gross P&amp;L and entry costs
          are separate categories. Total marked net P&amp;L combines those
          returned categories; marked outcomes are not final economic outcomes.
          Closed-trade net win rate is the fraction of completed trades with
          strictly positive net P&amp;L. With zero completed trades, win rate
          and average completed holding are unavailable.
        </p>
        <p>
          Marks can use the last observed finite positive pre-expiry/expiry
          settlement, including an untraded settlement. Missing later
          observations expose stale marks and ages; post-expiry quotes do not
          update unresolved marks. Stale marks never permit fills. Unavailable
          valuations create P&amp;L gaps. Drawdown is a nonnegative rupee
          decline from the running gross-notional reference-equity peak,
          including the initial zero-P&amp;L baseline. An unavailable valuation
          makes subsequent drawdown and the full-window maximum unavailable;
          stale marks carry a valuation caveat.
        </p>
        <p>
          Closed-trade cost sensitivity holds recorded completed trade dates and
          quantities fixed, repricing entry and exit transactions at integer
          costs from 0 through 50 bps per leg per side. Open and unresolved
          positions are excluded. Tolerance is the highest tested integer cost
          with strictly positive completed net P&amp;L. No completed trades
          makes it unavailable; nonpositive completed gross P&amp;L means no
          profitable tested cost, even zero. Still positive at 50 bps means the
          tested range is capped, not true whole-strategy break-even.
        </p>
        <p>
          Expiry reports are independent, with no portfolio aggregation or
          shared capital. The 40-session/10-completed-trade sample cutoffs are
          reporting heuristics, not significance tests. No gold-factor
          attribution, Sharpe ratio or annualized return is implemented.
        </p>
        <details>
          <summary>Response-backed simulation/report assumptions</summary>
          {backtest.response ? (
            <ul>
              {[
                ...new Set([
                  ...backtest.response.data.assumptions,
                  ...(backtest.response.data.reports[0]?.assumptions ?? []),
                ]),
              ].map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : (
            <p>
              Dynamic response assumptions unavailable; established
              implementation explanations remain above.
            </p>
          )}
        </details>
      </section>
      <section className="panel" id="method-offline" tabIndex={-1}>
        <h2>Offline mode</h2>
        <p>
          The versioned manifest enumerates exact endpoint/parameter
          configurations. Omitted parameters are filled with their canonical
          defaults, boolean values remain booleans, absent optional date filters
          are null, and dates use ISO YYYY-MM-DD. Numeric equivalents match
          semantically; custom settings never receive default results under
          custom labels.
        </p>
        <p>
          Network failure or timeout may use an exact checksum-verified
          snapshot. HTTP 422/500 and malformed API responses remain errors. API
          source does not mean live data. Historical data_as_of is separate from
          the UTC export timestamp. Latest curve requests omit the date filter;
          an explicit historical date requires its own exact snapshot, including
          when it equals the saved latest date. Expiry groups are retained and
          selected locally.
        </p>
        {catalog.loading && (
          <CrowLoader label="Loading saved configurations…" />
        )}
        {catalog.error && (
          <div className="error-notice">
            <p>Snapshot metadata unavailable: {catalog.error}</p>
            <button className="button" onClick={catalog.retry}>
              Retry snapshot metadata
            </button>
          </div>
        )}
        {snapshot && (
          <>
            <span className="source-badge offline">Snapshot manifest</span>
            <p>
              Schema {snapshot.snapshot_schema_version}; generated UTC{' '}
              {snapshot.generated_at_utc}; historical data_as_of{' '}
              {formatDate(snapshot.data_as_of)}. Saved window:{' '}
              {formatDate(snapshot.data_window.first_trade_date)} to{' '}
              {formatDate(snapshot.data_window.last_trade_date)}.{' '}
              {snapshot.files.length} exact supported configurations. Purity
              verification: {snapshot.purity_verification_status}.
            </p>
            <details>
              <summary>
                Exact supported offline configurations ({snapshot.files.length})
              </summary>
              <div
                className="table-scroll method-catalog"
                tabIndex={0}
                role="region"
                aria-label="Exact snapshot configurations"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Endpoint</th>
                      <th>Canonical applied parameters</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.files.map((entry) => (
                      <tr key={entry.request_key}>
                        <td>{entry.endpoint}</td>
                        <td>
                          <code>{JSON.stringify(entry.parameters)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <ul>
              {snapshot.limitations.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="panel" id="method-limitations" tabIndex={-1}>
        <h2>Limitations</h2>
        <p>
          The sample is short; purity assumptions are unverified. Daily
          settlement prices and synthetic interpolation do not establish
          executable fills. Fractional sizing omits actual lot constraints.
          Volume screening is not depth or fill assurance. Stale prices and
          unavailable marks limit valuations. Error notes, structured volume
          mismatches and row-level validation are incomplete or unavailable.
          Unresolved expiry outcomes prevent final conclusions. Roll-down is a
          simplified local model, not causal attribution. None of these tools
          establishes profitability or complete problem-statement compliance.
        </p>
      </section>
    </div>
  )
}
import CrowLoader from '@/components/CrowLoader'
