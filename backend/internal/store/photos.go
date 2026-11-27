package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"forest/internal/photo"
)

// PhotoInfo is one photo of the field in the photo history.
type PhotoInfo struct {
	Photo
	AlignmentPoints []photo.PointPair `json:"alignment_points"`
	ResidualPx      *float64          `json:"residual_px"`
	IsCurrent       bool              `json:"is_current"`
}

// NewPhoto is an uploaded, cleaned photo with its alignment to the frame.
type NewPhoto struct {
	Key        string
	Width      int
	Height     int
	Affine     photo.Affine
	Points     []photo.PointPair
	Residual   float64
	CapturedOn *string // YYYY-MM-DD, optional
}

const maxAlignmentPoints = 50

// AlignmentInput is the landmarks as sent: both points of every pair are required.
type AlignmentInput []struct {
	Photo *[2]float64 `json:"photo"`
	Frame *[2]float64 `json:"frame"`
}

// CheckAlignment validates landmarks before the photo is decoded: count, both
// points present, sane frame coordinates.
func CheckAlignment(in AlignmentInput) ([]photo.PointPair, error) {
	if len(in) < 3 {
		return nil, invalid("alignment", "têm de ser pelo menos 3, marcados nas duas fotografias")
	}
	if len(in) > maxAlignmentPoints {
		return nil, invalid("alignment", "são demasiados (máximo %d)", maxAlignmentPoints)
	}
	out := make([]photo.PointPair, len(in))
	for i, p := range in {
		if p.Photo == nil || p.Frame == nil {
			return nil, invalid("alignment", "precisam todos de um ponto em cada fotografia")
		}
		if !validCoord(p.Frame[0]) || !validCoord(p.Frame[1]) || !validCoord(p.Photo[0]) || !validCoord(p.Photo[1]) {
			return nil, invalid("alignment", "têm uma coordenada inválida")
		}
		out[i] = photo.PointPair{Photo: *p.Photo, Frame: *p.Frame}
	}
	return out, nil
}

// CheckLandmarksOnPhoto: the photo points must lie on the (cleaned, upright) photo.
func CheckLandmarksOnPhoto(pairs []photo.PointPair, width, height int) error {
	for _, p := range pairs {
		if p.Photo[0] < 0 || p.Photo[1] < 0 || p.Photo[0] > float64(width) || p.Photo[1] > float64(height) {
			return invalid("alignment", "têm de ficar dentro da fotografia: há um fora dela")
		}
	}
	return nil
}

// lockField locks the field row: photo changes (one current photo) run one at a time.
func (s *Store) lockField(ctx context.Context) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.db.QueryRow(ctx, `SELECT id FROM field WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE`).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return id, ErrNoField
	}
	return id, err
}

// CheckCapturedOn validates the optional "photo taken on" date.
func CheckCapturedOn(day *string) error {
	if day == nil {
		return nil
	}
	d, err := time.Parse(time.DateOnly, *day)
	if err != nil || d.Year() < 1990 || d.After(time.Now().AddDate(0, 0, 2)) {
		return invalid("captured_on", "tem de ser uma data (AAAA-MM-DD), sem ser no futuro")
	}
	return nil
}

func scanPhotoInfo(row pgx.Row) (PhotoInfo, error) {
	var p PhotoInfo
	var affine []float64
	var points []byte
	err := row.Scan(&p.ID, &p.Key, &p.Width, &p.Height, &affine, &points, &p.ResidualPx, &p.CapturedOn, &p.IsCurrent, &p.CreatedAt)
	if err != nil {
		return p, err
	}
	copy(p.AffineToFrame[:], affine)
	p.AlignmentPoints = []photo.PointPair{}
	if err := json.Unmarshal(points, &p.AlignmentPoints); err != nil {
		return p, err
	}
	return p, nil
}

const photoInfoSelect = `
	SELECT i.id, i.image_key, i.width_px, i.height_px, i.affine_to_frame, i.alignment_points,
	       i.residual_px::float8, to_char(i.captured_on, 'YYYY-MM-DD'), i.is_current, i.created_at
	  FROM field_image i
	 WHERE i.deleted_at IS NULL
	   AND i.field_id = (SELECT id FROM field WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1)`

// ListPhotos returns the field's photos, newest first.
func (s *Store) ListPhotos(ctx context.Context) ([]PhotoInfo, error) {
	rows, err := s.db.Query(ctx, photoInfoSelect+` ORDER BY i.captured_on DESC NULLS LAST, i.created_at DESC`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PhotoInfo, error) { return scanPhotoInfo(r) })
}

// AddPhoto stores a newer photo aligned to the frame and makes it the current one.
// Drawings stay in frame units, so nothing else changes.
func (s *Store) AddPhoto(ctx context.Context, p NewPhoto) (PhotoInfo, error) {
	if err := CheckCapturedOn(p.CapturedOn); err != nil {
		return PhotoInfo{}, err
	}
	points, err := json.Marshal(p.Points)
	if err != nil {
		return PhotoInfo{}, err
	}
	var out PhotoInfo
	err = s.inTx(ctx, func(tx *Store) error {
		fieldID, err := tx.lockField(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.db.Exec(ctx, `UPDATE field_image SET is_current = false WHERE field_id = $1 AND is_current`, fieldID); err != nil {
			return err
		}
		var id uuid.UUID
		err = tx.db.QueryRow(ctx, `
			INSERT INTO field_image (field_id, image_key, width_px, height_px, affine_to_frame, alignment_points, residual_px, captured_on, is_current)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, true) RETURNING id`,
			fieldID, p.Key, p.Width, p.Height, p.Affine[:], points, p.Residual, p.CapturedOn).Scan(&id)
		if err != nil {
			return err
		}
		out, err = scanPhotoInfo(tx.db.QueryRow(ctx, photoInfoSelect+` AND i.id = $1`, id))
		return err
	})
	return out, err
}

// SetCurrentPhoto shows another (older or newer) photo under the drawings.
func (s *Store) SetCurrentPhoto(ctx context.Context, id uuid.UUID) (PhotoInfo, error) {
	var out PhotoInfo
	err := s.inTx(ctx, func(tx *Store) error {
		fieldID, err := tx.lockField(ctx)
		if err != nil {
			return err
		}
		var exists bool
		if err := tx.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM field_image WHERE id = $1 AND field_id = $2 AND deleted_at IS NULL)`,
			id, fieldID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		// clear first, then set: the one-current index never sees two
		if _, err := tx.db.Exec(ctx, `UPDATE field_image SET is_current = false WHERE field_id = $1 AND is_current AND id <> $2`, fieldID, id); err != nil {
			return err
		}
		if _, err := tx.db.Exec(ctx, `UPDATE field_image SET is_current = true WHERE id = $1`, id); err != nil {
			return err
		}
		out, err = scanPhotoInfo(tx.db.QueryRow(ctx, photoInfoSelect+` AND i.id = $1`, id))
		return err
	})
	return out, err
}
