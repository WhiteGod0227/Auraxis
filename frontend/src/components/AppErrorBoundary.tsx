import { Component } from 'react'
import type { ReactNode } from 'react'

export default class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <main>
          <section className="panel" role="alert">
            <h1>Auraxis could not display this page</h1>
            <p>
              A page component failed to load or render. Reload to load the
              current build.
            </p>
            <button className="button" onClick={() => window.location.reload()}>
              Reload dashboard
            </button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}
