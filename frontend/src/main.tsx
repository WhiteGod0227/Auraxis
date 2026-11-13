import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import { Backdrop, MotionManager } from './components/Motion'
import CrowCursor from './components/CrowCursor'
import Presenter from './components/Presenter'
import './styles/index.css'
import './styles/glass.css'
import './styles/design.css'
import './styles/graphite.css'
import './styles/sidebar.css'
import './styles/history.css'
import './styles/refine.css'
import './styles/theme.css'
import { initTheme } from './lib/theme'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Backdrop />
      <MotionManager />
      <CrowCursor />
      <Presenter />
      <div className="auraxis-content">
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </div>
    </BrowserRouter>
  </StrictMode>,
)
