import { Link } from 'react-router-dom'
export function UnfinishedPage({ title }: { title: string }) {
  return (
    <section className="placeholder-page">
      <p className="eyebrow">OUTSIDE PROTOTYPE SCOPE</p>
      <h1>{title}</h1>
      <div className="panel placeholder-panel">
        <span className="placeholder-symbol" aria-hidden="true">
          ◇
        </span>
        <h2>This page is unavailable in the research prototype.</h2>
        <p>
          {title} is outside the completed product scope. Overview, Relative
          Value, Term Structure, Backtest, Data Health and Methodology are
          available.
        </p>
        <Link to="/app" className="button">
          Return to Overview
        </Link>
      </div>
    </section>
  )
}
