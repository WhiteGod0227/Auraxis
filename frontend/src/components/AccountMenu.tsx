import { Link } from 'react-router-dom'
import { useAccount } from '@/lib/useAccount'
import SignOutButton from './SignOutButton'

export default function AccountMenu() {
  const { user, checked } = useAccount()
  return (
    <div className="account-menu">
      {!checked ? (
        <span role="status">Checking account…</span>
      ) : user ? (
        <>
          <Link to="/app/profile">My Profile</Link>
          <Link to="/app/research">My Research</Link>
          <SignOutButton />
        </>
      ) : (
        <Link to="/login">Log in</Link>
      )}
    </div>
  )
}
