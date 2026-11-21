import { useEffect, useState } from 'react'
import {
  chainName,
  connectWallet,
  hasWallet,
  shortWallet,
  walletApi,
} from '@/lib/wallet'
import type { LinkedWallet } from '@/lib/wallet'
import '@/styles/wallet.css'

/** Profile card: optionally link an Ethereum wallet (Sign-In with Ethereum). */
export default function WalletCard() {
  const [wallet, setWallet] = useState<LinkedWallet | null | undefined>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{
    tone: 'ok' | 'error'
    text: string
  }>()
  // Wallets inject window.ethereum before the app loads.
  const [available] = useState(hasWallet)

  useEffect(() => {
    let active = true
    walletApi
      .get()
      .then((value) => active && setWallet(value.wallet))
      .catch(() => active && setWallet(null))
    return () => {
      active = false
    }
  }, [])

  const connect = async () => {
    setBusy(true)
    setMessage(undefined)
    try {
      const linked = await connectWallet()
      setWallet(linked)
      setMessage({ tone: 'ok', text: 'Wallet linked.' })
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Linking failed.',
      })
    } finally {
      setBusy(false)
    }
  }
  const unlink = async () => {
    setBusy(true)
    setMessage(undefined)
    try {
      await walletApi.unlink()
      setWallet(null)
      setMessage({ tone: 'ok', text: 'Wallet unlinked.' })
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unlinking failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel wallet-card" aria-labelledby="wallet-title">
      <h2 id="wallet-title">Web3 wallet (optional)</h2>
      <p className="wallet-lead">
        Link an Ethereum wallet to your account by signing a standard Sign-In
        with Ethereum message. Signing is free: no transaction, no gas and no
        access to your funds. Nothing in Auraxis requires a wallet.
      </p>
      {wallet === undefined ? (
        <p className="ui-muted-note">Checking…</p>
      ) : wallet ? (
        <div className="wallet-linked">
          <span className="wallet-dot" aria-hidden="true" />
          <div>
            <strong title={wallet.address}>
              {shortWallet(wallet.address)}
            </strong>
            <small>
              {chainName(wallet.chain_id)} · linked{' '}
              {new Date(wallet.linked_at).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </small>
          </div>
          <a
            className="button"
            href={wallet.explorer_url}
            target="_blank"
            rel="noreferrer noopener"
          >
            View on Etherscan ↗
          </a>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void unlink()}
          >
            Unlink
          </button>
        </div>
      ) : available ? (
        <button
          type="button"
          className="ui-button primary"
          disabled={busy}
          onClick={() => void connect()}
        >
          {busy ? 'Check your wallet…' : 'Connect wallet'}
        </button>
      ) : (
        <p className="ui-muted-note">
          No Ethereum wallet was found in this browser. Install{' '}
          <a
            href="https://metamask.io"
            target="_blank"
            rel="noreferrer noopener"
          >
            MetaMask
          </a>{' '}
          (or another wallet) to link one — or simply skip this.
        </p>
      )}
      {message && (
        <p
          className={`wallet-message is-${message.tone}`}
          role={message.tone === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </section>
  )
}
