import { NavLink } from 'react-router-dom'
import AccountMenu from './AccountMenu'
import './LandingHeaderNav.css'

export default function LandingHeaderNav() {
  return (
    <div className="header-navigation">
      <nav className="primary-nav" aria-label="Primary navigation">
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/app">Dashboard</NavLink>
      </nav>
      <AccountMenu />
    </div>
  )
}
