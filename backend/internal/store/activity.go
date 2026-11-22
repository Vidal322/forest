package store

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ActivityTypes, in the order the app offers them.
var ActivityTypes = []string{"watering", "sowing", "planting", "fertilizing", "other"}

// QuantityUnits for activity_zone / activity_species quantities.
var QuantityUnits = []string{"holes", "seeds", "trees", "litres", "kg"}

// zoneUnits: what a quantity per zone can be counted in, by activity type. Totals
// (covas sown, litres watered) add these up, so a mismatched unit is refused
// instead of silently dropping out of the numbers.
var zoneUnits = map[string][]string{
	"sowing":      {"holes", "seeds"},
	"planting":    {"trees"},
	"watering":    {"litres"},
	"fertilizing": {"kg", "litres"},
	"other":       QuantityUnits,
}

// ActivityZone is one zone an activity applied to, with what was done there.
type ActivityZone struct {
	ZoneID   uuid.UUID `json:"zone_id"`
	Quantity *int      `json:"quantity"`
	Unit     *string   `json:"unit"`
}

// ActivitySpecies is one species of a sowing's seed mix or a planting's trees.
type ActivitySpecies struct {
	SpeciesID uuid.UUID `json:"species_id"`
	Quantity  *int      `json:"quantity"`
	Unit      *string   `json:"unit"`
	Notes     *string   `json:"notes"`
}

// Activity is one real-world event (e.g. "watered three zones today").
type Activity struct {
	ID          uuid.UUID         `json:"id"`
	Type        string            `json:"type"`
	PerformedOn string            `json:"performed_on"` // YYYY-MM-DD, the field's day
	Notes       *string           `json:"notes"`
	Zones       []ActivityZone    `json:"zones"`
	Species     []ActivitySpecies `json:"species"`
	Version     int               `json:"version"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

// ActivityInput is a whole activity as the client sends it.
//
// BaseVersion is the version the client's edit started from: nil for a new entry.
// The same content again is always a no-op (a retried request); different content
// for an existing activity needs BaseVersion to match, or it's a version conflict.
type ActivityInput struct {
	Type        string            `json:"type"`
	PerformedOn string            `json:"performed_on"`
	Notes       *string           `json:"notes"`
	Zones       []ActivityZone    `json:"zones"`
	Species     []ActivitySpecies `json:"species"`
	BaseVersion *int              `json:"base_version"`
}

const maxQuantity = 1_000_000

func checkQuantity(field string, q *int, unit *string) error {
	if (q == nil) != (unit == nil) {
		return invalid(field, "needs both a number and a unit, or neither")
	}
	if q != nil && (*q < 1 || *q > maxQuantity) {
		return invalid(field, "must be a whole number from 1 to %d", maxQuantity)
	}
	if unit != nil && !slices.Contains(QuantityUnits, *unit) {
		return invalid(field, "has an unknown unit")
	}
	return nil
}

func (in ActivityInput) normalize(today string) (ActivityInput, error) {
	if !slices.Contains(ActivityTypes, in.Type) {
		return in, invalid("type", "must be watering, sowing, planting, fertilizing or other")
	}
	d, err := time.Parse(time.DateOnly, in.PerformedOn)
	if err != nil {
		return in, invalid("performed_on", "must be a date (YYYY-MM-DD)")
	}
	t, _ := time.Parse(time.DateOnly, today)
	if d.After(t.AddDate(0, 0, 1)) { // a day of slack for clocks and timezones
		return in, invalid("performed_on", "is in the future")
	}
	if d.Before(t.AddDate(-30, 0, 0)) {
		return in, invalid("performed_on", "is too far in the past")
	}
	if in.Notes, err = optionalText("notes", in.Notes, 2000); err != nil {
		return in, err
	}
	if len(in.Zones) == 0 {
		return in, invalid("zones", "pick at least one zone")
	}
	if len(in.Zones) > 500 {
		return in, invalid("zones", "too many zones")
	}
	seen := map[uuid.UUID]bool{}
	for _, z := range in.Zones {
		if seen[z.ZoneID] {
			return in, invalid("zones", "has the same zone twice")
		}
		seen[z.ZoneID] = true
		if err := checkQuantity("zones", z.Quantity, z.Unit); err != nil {
			return in, err
		}
		if z.Unit != nil && !slices.Contains(zoneUnits[in.Type], *z.Unit) {
			return in, invalid("zones", "%s are not counted for %s", *z.Unit, in.Type)
		}
	}
	if len(in.Species) > 0 && in.Type != "sowing" && in.Type != "planting" {
		return in, invalid("species", "only sowings and plantings have species")
	}
	seen = map[uuid.UUID]bool{}
	for i, s := range in.Species {
		if seen[s.SpeciesID] {
			return in, invalid("species", "has the same species twice")
		}
		seen[s.SpeciesID] = true
		if err := checkQuantity("species", s.Quantity, s.Unit); err != nil {
			return in, err
		}
		if in.Species[i].Notes, err = optionalText("species", s.Notes, 500); err != nil {
			return in, err
		}
	}
	if in.Zones == nil {
		in.Zones = []ActivityZone{}
	}
	if in.Species == nil {
		in.Species = []ActivitySpecies{}
	}
	// canonical order, so "same content" doesn't depend on the order things were tapped
	slices.SortFunc(in.Zones, func(a, b ActivityZone) int { return compareUUID(a.ZoneID, b.ZoneID) })
	slices.SortFunc(in.Species, func(a, b ActivitySpecies) int { return compareUUID(a.SpeciesID, b.SpeciesID) })
	return in, nil
}

func compareUUID(a, b uuid.UUID) int {
	for i := range a {
		if a[i] != b[i] {
			return int(a[i]) - int(b[i])
		}
	}
	return 0
}

// sameContent: would saving `in` change nothing?
func (a Activity) sameContent(in ActivityInput) bool {
	return a.Type == in.Type && a.PerformedOn == in.PerformedOn && ptrEq(a.Notes, in.Notes) &&
		slices.EqualFunc(a.Zones, in.Zones, func(x, y ActivityZone) bool {
			return x.ZoneID == y.ZoneID && ptrEq(x.Quantity, y.Quantity) && ptrEq(x.Unit, y.Unit)
		}) &&
		slices.EqualFunc(a.Species, in.Species, func(x, y ActivitySpecies) bool {
			return x.SpeciesID == y.SpeciesID && ptrEq(x.Quantity, y.Quantity) && ptrEq(x.Unit, y.Unit) && ptrEq(x.Notes, y.Notes)
		})
}

func ptrEq[T comparable](a, b *T) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// ActivityFilter narrows ListActivities.
type ActivityFilter struct {
	ZoneID *uuid.UUID // only activities touching this zone
	Since  *string    // performed on or after this day (YYYY-MM-DD)
	Limit  int        // newest first; 0 = default (500)
}

// ListActivities returns live activities, newest first, each with its zones and species.
func (s *Store) ListActivities(ctx context.Context, f ActivityFilter) ([]Activity, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 500
	}
	limit = min(limit, 5000)
	rows, err := s.db.Query(ctx, `
		SELECT a.id, a.type::text, to_char(a.performed_on, 'YYYY-MM-DD'), a.notes, a.version, a.created_at, a.updated_at,
		       COALESCE((SELECT json_agg(json_build_object('zone_id', az.zone_id, 'quantity', az.quantity, 'unit', az.unit)
		                                 ORDER BY az.zone_id)
		                   FROM activity_zone az WHERE az.activity_id = a.id), '[]'),
		       COALESCE((SELECT json_agg(json_build_object('species_id', asp.species_id, 'quantity', asp.quantity,
		                                                   'unit', asp.unit, 'notes', asp.notes) ORDER BY asp.species_id)
		                   FROM activity_species asp WHERE asp.activity_id = a.id), '[]')
		  FROM activity a
		 WHERE a.deleted_at IS NULL
		   AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM activity_zone az WHERE az.activity_id = a.id AND az.zone_id = $1))
		   AND ($2::date IS NULL OR a.performed_on >= $2::date)
		 ORDER BY a.performed_on DESC, a.created_at DESC, a.id
		 LIMIT $3`, f.ZoneID, f.Since, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Activity, error) { return scanActivity(r) })
}

func scanActivity(row pgx.Row) (Activity, error) {
	var a Activity
	err := row.Scan(&a.ID, &a.Type, &a.PerformedOn, &a.Notes, &a.Version, &a.CreatedAt, &a.UpdatedAt,
		geomJSON[[]ActivityZone]{&a.Zones}, geomJSON[[]ActivitySpecies]{&a.Species})
	return a, err
}

func (s *Store) listOne(ctx context.Context, id uuid.UUID) (Activity, error) {
	row := s.db.QueryRow(ctx, `
		SELECT a.id, a.type::text, to_char(a.performed_on, 'YYYY-MM-DD'), a.notes, a.version, a.created_at, a.updated_at,
		       COALESCE((SELECT json_agg(json_build_object('zone_id', az.zone_id, 'quantity', az.quantity, 'unit', az.unit)
		                                 ORDER BY az.zone_id)
		                   FROM activity_zone az WHERE az.activity_id = a.id), '[]'),
		       COALESCE((SELECT json_agg(json_build_object('species_id', asp.species_id, 'quantity', asp.quantity,
		                                                   'unit', asp.unit, 'notes', asp.notes) ORDER BY asp.species_id)
		                   FROM activity_species asp WHERE asp.activity_id = a.id), '[]')
		  FROM activity a WHERE a.id = $1 AND a.deleted_at IS NULL`, id)
	a, err := scanActivity(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, ErrNotFound
	}
	return a, err
}

// VersionConflictError carries the server's current copy, so the app can show both.
type VersionConflictError struct{ Current Activity }

func (e *VersionConflictError) Error() string { return "version conflict" }
func (e *VersionConflictError) Unwrap() error { return ErrVersionConflict }

// PutActivity creates or updates the activity with this client-chosen id, together
// with its zones and species, in one transaction.
func (s *Store) PutActivity(ctx context.Context, id uuid.UUID, in ActivityInput) (a Activity, created bool, err error) {
	err = s.inTx(ctx, func(tx *Store) error {
		var today string
		if err := tx.db.QueryRow(ctx, `SELECT to_char(field_today(), 'YYYY-MM-DD')`).Scan(&today); err != nil {
			return err
		}
		if in, err = in.normalize(today); err != nil {
			return err
		}
		fieldID, err := tx.fieldID(ctx)
		if err != nil {
			return err
		}

		// Concurrent syncs of the same entry (two tabs, a retry racing the original)
		// queue up here, also when the row doesn't exist yet and FOR UPDATE can't lock it.
		if _, err := tx.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, id); err != nil {
			return err
		}
		var version int
		var deleted bool
		err = tx.db.QueryRow(ctx, `SELECT version, deleted_at IS NOT NULL FROM activity WHERE id = $1 FOR UPDATE`, id).Scan(&version, &deleted)
		exists := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if deleted {
			return ErrDeleted
		}
		if !exists && in.BaseVersion != nil {
			// an edit of something the server doesn't have: it was deleted (and purged)
			return ErrDeleted
		}
		if exists {
			current, err := tx.listOne(ctx, id)
			if err != nil {
				return err
			}
			if current.sameContent(in) {
				a = current // a retry of a request that already went through
				return nil
			}
			if in.BaseVersion == nil || *in.BaseVersion != version {
				return &VersionConflictError{Current: current}
			}
		}

		if err := tx.checkReferences(ctx, in); err != nil {
			return err
		}

		if exists {
			// Touching updated_at makes the version trigger fire even if only zones or species changed.
			_, err = tx.db.Exec(ctx, `UPDATE activity SET type = $2::activity_type, performed_on = $3::date, notes = $4,
				updated_at = clock_timestamp() WHERE id = $1`, id, in.Type, in.PerformedOn, in.Notes)
		} else {
			_, err = tx.db.Exec(ctx, `INSERT INTO activity (id, field_id, type, performed_on, notes)
				VALUES ($1, $2, $3::activity_type, $4::date, $5)`, id, fieldID, in.Type, in.PerformedOn, in.Notes)
		}
		if err != nil {
			return err
		}
		if _, err := tx.db.Exec(ctx, `DELETE FROM activity_zone WHERE activity_id = $1`, id); err != nil {
			return err
		}
		if _, err := tx.db.Exec(ctx, `DELETE FROM activity_species WHERE activity_id = $1`, id); err != nil {
			return err
		}
		for _, z := range in.Zones {
			if _, err := tx.db.Exec(ctx, `INSERT INTO activity_zone (activity_id, zone_id, quantity, unit)
				VALUES ($1, $2, $3, $4::quantity_unit)`, id, z.ZoneID, z.Quantity, z.Unit); err != nil {
				return err
			}
		}
		for _, sp := range in.Species {
			if _, err := tx.db.Exec(ctx, `INSERT INTO activity_species (activity_id, species_id, quantity, unit, notes)
				VALUES ($1, $2, $3, $4::quantity_unit, $5)`, id, sp.SpeciesID, sp.Quantity, sp.Unit, sp.Notes); err != nil {
				return err
			}
		}
		created = !exists
		a, err = tx.listOne(ctx, id)
		return err
	})
	return a, created, err
}

// checkReferences: every zone and species must exist and be live (FOR SHARE keeps
// them from being deleted until this transaction ends).
func (s *Store) checkReferences(ctx context.Context, in ActivityInput) error {
	zoneIDs := make([]uuid.UUID, len(in.Zones))
	for i, z := range in.Zones {
		zoneIDs[i] = z.ZoneID
	}
	var missing int
	if err := s.db.QueryRow(ctx, `
		SELECT $2::int - count(*) FROM (
			SELECT z.id FROM zone z JOIN plot p ON p.id = z.plot_id AND p.deleted_at IS NULL
			 WHERE z.id = ANY($1) AND z.deleted_at IS NULL FOR SHARE OF z) live`,
		zoneIDs, len(zoneIDs)).Scan(&missing); err != nil {
		return err
	}
	if missing > 0 {
		return invalid("zones", "%s deleted or unknown: pick the zones again", plural(missing, "a zone was", "%d zones were"))
	}
	speciesIDs := make([]uuid.UUID, len(in.Species))
	for i, sp := range in.Species {
		speciesIDs[i] = sp.SpeciesID
	}
	if err := s.db.QueryRow(ctx, `
		SELECT $2::int - count(*) FROM (
			SELECT id FROM species WHERE id = ANY($1) AND deleted_at IS NULL FOR SHARE) live`,
		speciesIDs, len(speciesIDs)).Scan(&missing); err != nil {
		return err
	}
	if missing > 0 {
		return invalid("species", "%s deleted or unknown", plural(missing, "a species was", "%d species were"))
	}
	return nil
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return fmt.Sprintf(many, n)
}

// DeleteActivity soft-deletes an activity (a tombstone, so a late offline edit
// can't bring it back). Idempotent.
func (s *Store) DeleteActivity(ctx context.Context, id uuid.UUID) error {
	var existed bool
	err := s.db.QueryRow(ctx, `
		WITH upd AS (UPDATE activity SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id)
		SELECT EXISTS (SELECT 1 FROM upd) OR EXISTS (SELECT 1 FROM activity WHERE id = $1)`, id).Scan(&existed)
	if err != nil {
		return err
	}
	if !existed {
		return ErrNotFound
	}
	return nil
}
