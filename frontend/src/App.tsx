import { FieldMap, type FieldPhoto } from './components/FieldMap'
import { ServerStatus } from './components/ServerStatus'

// Stand-in photo (same terrain as docs/mockups) until fields and photo upload exist.
const PLACEHOLDER_PHOTO: FieldPhoto = { url: '/placeholder-field.svg', width: 1000, height: 700 }

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
      <main className="fieldmap-page">
        <h1 className="visually-hidden">Your field</h1>
        <FieldMap key={`${PLACEHOLDER_PHOTO.width}x${PLACEHOLDER_PHOTO.height}`} photo={PLACEHOLDER_PHOTO} />
      </main>
    </>
  )
}
