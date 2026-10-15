import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import StarBackground from './components/StarBackground'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StarBackground />
      <div className="auraxis-content">
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </div>
    </BrowserRouter>
  </StrictMode>,
)
