import { ServerStatus } from './components/ServerStatus'

export default function App() {
  return (
    <>
      <header className="topbar">
        <span className="topbar__brand">
          <span aria-hidden="true">🌳</span> Forest
        </span>
        <span className="spacer" />
        <ServerStatus />
      </header>
      <main className="page">
        <h1>Your field</h1>
        <p className="muted">
          The map, quick log and tasks arrive here step by step. See <code>docs/mockups</code> for where this is going.
        </p>
      </main>
    </>
  )
}
