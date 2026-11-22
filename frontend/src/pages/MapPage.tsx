import { FieldMap, type FieldPhoto } from '../components/FieldMap'

// Stand-in photo (same terrain as docs/mockups) until fields and photo upload exist.
const PLACEHOLDER_PHOTO: FieldPhoto = { url: '/placeholder-field.svg', width: 1000, height: 700 }

export function MapPage() {
  return (
    <div className="fieldmap-page">
      <h1 className="visually-hidden">Field map</h1>
      <FieldMap key={`${PLACEHOLDER_PHOTO.width}x${PLACEHOLDER_PHOTO.height}`} photo={PLACEHOLDER_PHOTO} />
    </div>
  )
}
