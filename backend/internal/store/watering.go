package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// WateringRule says how often zones need water in a range of months (may wrap past December).
type WateringRule struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	FromMonth    int       `json:"from_month"`
	ToMonth      int       `json:"to_month"`
	IntervalDays int       `json:"interval_days"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	// Other rules sharing a month with this one (the narrowest range wins there).
	OverlapsWith []uuid.UUID `json:"overlaps_with"`
}

// months a rule covers; ranges may wrap past December (Nov–Feb)
func (r WateringRule) months() map[int]bool {
	out := map[int]bool{}
	for m := r.FromMonth; ; m = m%12 + 1 {
		out[m] = true
		if m == r.ToMonth {
			return out
		}
	}
}

// markOverlaps fills OverlapsWith for every rule.
func markOverlaps(rules []WateringRule) {
	for i := range rules {
		rules[i].OverlapsWith = []uuid.UUID{}
		mi := rules[i].months()
		for j := range rules {
			if i == j {
				continue
			}
			for m := range rules[j].months() {
				if mi[m] {
					rules[i].OverlapsWith = append(rules[i].OverlapsWith, rules[j].ID)
					break
				}
			}
		}
	}
}

// WateringRuleInput is what the owner sets on a rule.
type WateringRuleInput struct {
	Name         string `json:"name"`
	FromMonth    int    `json:"from_month"`
	ToMonth      int    `json:"to_month"`
	IntervalDays int    `json:"interval_days"`
}

func (in WateringRuleInput) normalize() (WateringRuleInput, error) {
	var err error
	if in.Name, err = requiredText("name", in.Name, 60); err != nil {
		return in, err
	}
	if in.FromMonth < 1 || in.FromMonth > 12 {
		return in, invalid("from_month", "tem de ser um mês de 1 a 12")
	}
	if in.ToMonth < 1 || in.ToMonth > 12 {
		return in, invalid("to_month", "tem de ser um mês de 1 a 12")
	}
	if in.IntervalDays < 1 || in.IntervalDays > 365 {
		return in, invalid("interval_days", "tem de ser entre 1 e 365 dias")
	}
	return in, nil
}

const ruleCols = `id, name, from_month, to_month, interval_days, created_at, updated_at`

func scanRule(row pgx.Row) (WateringRule, error) {
	var r WateringRule
	err := row.Scan(&r.ID, &r.Name, &r.FromMonth, &r.ToMonth, &r.IntervalDays, &r.CreatedAt, &r.UpdatedAt)
	return r, err
}

// ListWateringRules returns the field's live rules, by starting month.
func (s *Store) ListWateringRules(ctx context.Context) ([]WateringRule, error) {
	rows, err := s.db.Query(ctx, `SELECT `+ruleCols+` FROM watering_rule r
		WHERE r.deleted_at IS NULL AND r.field_id = (SELECT id FROM field WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1)
		ORDER BY from_month, created_at, id`)
	if err != nil {
		return nil, err
	}
	rules, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (WateringRule, error) { return scanRule(r) })
	if err != nil {
		return nil, err
	}
	markOverlaps(rules)
	return rules, nil
}

// PutWateringRule creates or replaces a rule by client id.
func (s *Store) PutWateringRule(ctx context.Context, id uuid.UUID, in WateringRuleInput) (r WateringRule, created bool, err error) {
	if in, err = in.normalize(); err != nil {
		return r, false, err
	}
	err = s.inTx(ctx, func(tx *Store) error {
		fieldID, err := tx.fieldID(ctx)
		if err != nil {
			return err
		}
		err = tx.db.QueryRow(ctx, `
			INSERT INTO watering_rule (id, field_id, name, from_month, to_month, interval_days) VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, from_month = EXCLUDED.from_month,
			       to_month = EXCLUDED.to_month, interval_days = EXCLUDED.interval_days
			 WHERE watering_rule.deleted_at IS NULL
			RETURNING (xmax = 0)`, id, fieldID, in.Name, in.FromMonth, in.ToMonth, in.IntervalDays).Scan(&created)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrDeleted
		}
		if err != nil {
			return err
		}
		all, err := tx.ListWateringRules(ctx)
		if err != nil {
			return err
		}
		for _, x := range all {
			if x.ID == id {
				r = x
			}
		}
		return nil
	})
	return r, created, err
}

// DeleteWateringRule soft-deletes a rule. Idempotent.
func (s *Store) DeleteWateringRule(ctx context.Context, id uuid.UUID) error {
	var existed bool
	err := s.db.QueryRow(ctx, `
		WITH upd AS (UPDATE watering_rule SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id)
		SELECT EXISTS (SELECT 1 FROM upd) OR EXISTS (SELECT 1 FROM watering_rule WHERE id = $1)`, id).Scan(&existed)
	if err != nil {
		return err
	}
	if !existed {
		return ErrNotFound
	}
	return nil
}
