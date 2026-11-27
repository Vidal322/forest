package store

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Point is a position in frame units: pixels of the first photo, origin top-left, y down.
type Point [2]float64

// Field is the photographed area and its coordinate frame. There is one per install for now.
type Field struct {
	ID                       uuid.UUID   `json:"id"`
	Name                     string      `json:"name"`
	FrameWidth               int         `json:"frame_width"`
	FrameHeight              int         `json:"frame_height"`
	CalibrationLine          *LineString `json:"calibration_line"` // a line of known length (2 points)
	CalibrationLengthM       *float64    `json:"calibration_length_m"`
	MetresPerUnit            *float64    `json:"metres_per_unit"` // nil until calibrated
	DefaultWaterIntervalDays int         `json:"default_water_interval_days"`
	Photo                    *Photo      `json:"photo"` // the current photo
	UpdatedAt                time.Time   `json:"updated_at"`
}

// Photo is one stored picture of the field, aligned to the frame by AffineToFrame
// (x' = a·x + b·y + c, y' = d·x + e·y + f; identity for the first photo).
type Photo struct {
	ID            uuid.UUID  `json:"id"`
	Key           string     `json:"key"`
	Width         int        `json:"width"`
	Height        int        `json:"height"`
	AffineToFrame [6]float64 `json:"affine_to_frame"`
	CapturedOn    *string    `json:"captured_on"`
	CreatedAt     time.Time  `json:"created_at"`
}

// FieldInput is what the owner can change on the field. PUT replaces all of it:
// leaving calibration_line out clears the calibration.
type FieldInput struct {
	Name                     string      `json:"name"`
	CalibrationLine          *LineString `json:"calibration_line"`
	CalibrationLengthM       *float64    `json:"calibration_length_m"`
	DefaultWaterIntervalDays int         `json:"default_water_interval_days"`
}

// coordLimit bounds frame coordinates: generous (photos are < 12000 px, newer photos
// may map slightly outside), but rejects NaN-like garbage and absurd values.
const coordLimit = 1_000_000

func validCoord(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && math.Abs(v) < coordLimit
}

func (in FieldInput) normalize() (FieldInput, error) {
	var err error
	if in.Name, err = requiredText("name", in.Name, 100); err != nil {
		return in, err
	}
	if (in.CalibrationLine == nil) != (in.CalibrationLengthM == nil) {
		return in, invalid("calibration_length_m", "e a linha da escala vão juntas: indica as duas ou nenhuma")
	}
	if in.CalibrationLine != nil {
		if err := in.CalibrationLine.validate("calibration_line", 2); err != nil {
			return in, err
		}
		a, b := in.CalibrationLine.Coordinates[0], in.CalibrationLine.Coordinates[1]
		if math.Hypot(b[0]-a[0], b[1]-a[1]) < 1 {
			return in, invalid("calibration_line", "é curta demais: afasta as duas pontas")
		}
		if l := *in.CalibrationLengthM; math.IsNaN(l) || l <= 0 || l >= 100_000 {
			return in, invalid("calibration_length_m", "tem de ser um número de metros acima de 0")
		}
	}
	if in.DefaultWaterIntervalDays < 1 || in.DefaultWaterIntervalDays > 365 {
		return in, invalid("default_water_interval_days", "tem de ser entre 1 e 365 dias")
	}
	return in, nil
}

const fieldSelect = `
	SELECT f.id, f.name, f.frame_width, f.frame_height,
	       ST_AsGeoJSON(f.calibration_line),
	       f.calibration_length_m::float8, f.metres_per_unit::float8, f.default_water_interval_days, f.updated_at,
	       i.id, i.image_key, i.width_px, i.height_px, i.affine_to_frame, to_char(i.captured_on, 'YYYY-MM-DD'), i.created_at
	  FROM field f
	  LEFT JOIN field_image i ON i.field_id = f.id AND i.is_current AND i.deleted_at IS NULL
	 WHERE f.deleted_at IS NULL`

func scanField(row pgx.Row) (Field, error) {
	var (
		f            Field
		line         LineString
		photoID      *uuid.UUID
		key          *string
		pw, ph       *int
		affine       []float64
		capturedOn   *string
		photoCreated *time.Time
	)
	err := row.Scan(&f.ID, &f.Name, &f.FrameWidth, &f.FrameHeight, geomJSON[LineString]{&line},
		&f.CalibrationLengthM, &f.MetresPerUnit, &f.DefaultWaterIntervalDays, &f.UpdatedAt,
		&photoID, &key, &pw, &ph, &affine, &capturedOn, &photoCreated)
	if err != nil {
		return f, err
	}
	if line.Type != "" {
		f.CalibrationLine = &line
	}
	if photoID != nil {
		p := &Photo{ID: *photoID, Key: *key, Width: *pw, Height: *ph, CapturedOn: capturedOn, CreatedAt: *photoCreated}
		copy(p.AffineToFrame[:], affine)
		f.Photo = p
	}
	return f, nil
}

// GetField returns the field, or ErrNotFound before the first photo is uploaded.
func (s *Store) GetField(ctx context.Context) (Field, error) {
	f, err := scanField(s.db.QueryRow(ctx, fieldSelect+` ORDER BY f.created_at LIMIT 1`))
	if errors.Is(err, pgx.ErrNoRows) {
		return f, ErrNotFound
	}
	return f, err
}

// ErrFieldExists: a field was already set up (one field per install for now).
var ErrFieldExists = errors.New("field already exists")

// CreateField sets up the field from its first photo: the photo's size becomes the frame.
func (s *Store) CreateField(ctx context.Context, name, photoKey string, width, height int) (Field, error) {
	name, err := requiredText("name", name, 100)
	if err != nil {
		return Field{}, err
	}
	var f Field
	err = s.inTx(ctx, func(tx *Store) error {
		// serialise concurrent setups so only one field is ever created
		if _, err := tx.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('forest.field.create'))`); err != nil {
			return err
		}
		var exists bool
		if err := tx.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM field WHERE deleted_at IS NULL)`).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return ErrFieldExists
		}
		var id uuid.UUID
		if err := tx.db.QueryRow(ctx, `INSERT INTO field (name, frame_width, frame_height) VALUES ($1, $2, $3) RETURNING id`,
			name, width, height).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.db.Exec(ctx, `INSERT INTO field_image (field_id, image_key, width_px, height_px, is_current)
			VALUES ($1, $2, $3, $4, true)`, id, photoKey, width, height); err != nil {
			return err
		}
		f, err = tx.GetField(ctx)
		return err
	})
	return f, err
}

// UpdateField changes the name, calibration and default watering interval.
func (s *Store) UpdateField(ctx context.Context, in FieldInput) (Field, error) {
	in, err := in.normalize()
	if err != nil {
		return Field{}, err
	}
	var line *string
	if in.CalibrationLine != nil {
		b, _ := json.Marshal(in.CalibrationLine)
		l := string(b)
		line = &l
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE field
		   SET name = $1,
		       calibration_line = ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($2)), 0),
		       calibration_length_m = $3,
		       default_water_interval_days = $4
		 WHERE id = (SELECT id FROM field WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1)`,
		in.Name, line, in.CalibrationLengthM, in.DefaultWaterIntervalDays)
	if err != nil {
		return Field{}, err
	}
	if tag.RowsAffected() == 0 {
		return Field{}, ErrNotFound
	}
	return s.GetField(ctx)
}
