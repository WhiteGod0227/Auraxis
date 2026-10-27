import { Route, Routes } from 'react-router-dom'

import { AppLayout } from '@/layouts/AppLayout'
import { AlertsPage } from '@/pages/AlertsPage'
import { BacktestPage } from '@/pages/BacktestPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { DashboardOverviewPage } from '@/pages/DashboardOverviewPage'
import { DataHealthPage } from '@/pages/DataHealthPage'
import { LandingPage } from '@/pages/LandingPage'
import { LoginPage } from '@/pages/LoginPage'
import { MethodologyPage } from '@/pages/MethodologyPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { RelativeValuePage } from '@/pages/RelativeValuePage'
import { TermStructurePage } from '@/pages/TermStructurePage'
import { ResearchPage } from '@/pages/ResearchPage'
import { ProfilePage } from '@/pages/ProfilePage'
import WorkspaceBoundary from '@/components/WorkspaceBoundary'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app" element={<AppLayout />}>
        <Route index element={<DashboardOverviewPage />} />
        <Route
          path="relative-value"
          element={
            <WorkspaceBoundary>
              <RelativeValuePage />
            </WorkspaceBoundary>
          }
        />
        <Route
          path="term-structure"
          element={
            <WorkspaceBoundary>
              <TermStructurePage />
            </WorkspaceBoundary>
          }
        />
        <Route
          path="backtest"
          element={
            <WorkspaceBoundary>
              <BacktestPage />
            </WorkspaceBoundary>
          }
        />
        <Route path="research" element={<ResearchPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="data-health" element={<DataHealthPage />} />
        <Route path="methodology" element={<MethodologyPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
