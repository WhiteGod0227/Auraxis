import { useOutletContext } from 'react-router-dom'
import type { DashboardContext } from '@/layouts/AppLayout'

/**
 * Sessions needed before a gap can be ranked against its own history: the
 * z-score uses at least 5 *preceding* sessions (backend `spread_min_periods`),
 * so the first ranked day is the 6th.
 */
export const MIN_SESSIONS = 6
/** Sessions for a full comparison window. */
export const FULL_SESSIONS = 10

/** Number of trading sessions loaded, or null while unknown. */
export function useSessionCount(): number | null {
  const context = useOutletContext<DashboardContext | undefined>()
  const count = context?.meta.response?.data.trading_session_count
  return typeof count === 'number' ? count : null
}

/** True when there is too little history for rankings and backtests. */
export function useBuildingHistory(need = MIN_SESSIONS) {
  const sessions = useSessionCount()
  return { sessions, building: sessions !== null && sessions < need }
}
