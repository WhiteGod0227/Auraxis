const labels: Record<string, string> = {
  unmatched_maturity: 'Different contract maturities',
  interpolated_maturity: 'Interpolated maturity comparison',
  missing_observation: 'Missing observation',
  expired_contract: 'Contract has expired',
  no_next_expiry: 'No later expiry available',
  no_bracket: 'No maturity interpolation bracket',
  zero_volume: 'No trading volume',
  no_trade: 'No recorded trade',
  leg_no_trade: 'A component has no recorded trade',
  thin_oi: 'Low open interest',
  missing_price: 'Missing price',
  invalid_price: 'Invalid price',
  missing_brackets: 'Missing maturity brackets',
  missing_component: 'Missing component observation',
  thin_volume: 'Low trading volume',
  stale_expired: 'Stale mark from an expired contract',
  unresolved_expiry: 'Expired position with unresolved outcome',
  no_completed_trades: 'No completed trades',
  z_exit: 'Spread returned to the exit threshold',
  max_hold: 'Maximum holding period reached',
  max_hold_sessions: 'Maximum holding period reached',
  expiry_buffer: 'Approaching expiry',
}

export function diagnosticText(code: string) {
  return labels[code] ?? code.replaceAll('_', ' ')
}

// Unknown diagnostics remain readable; the raw code is available on hover.
export default function DiagnosticLabel({ code }: { code: string }) {
  if (!code) return null
  return (
    <span className="diagnostic-label" title={code}>
      {diagnosticText(code)}
    </span>
  )
}
