package store

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TaskKinds and TaskStatuses mirror the database enums.
var (
	TaskKinds    = []string{"sow", "plant", "water", "fertilize", "add_nests", "improve_path", "other"}
	TaskStatuses = []string{"open", "in_progress", "done", "cancelled"}
)

// Task is pending work on a plot or on a zone ("Falta semear", "Melhorar caminho").
type Task struct {
	ID                   uuid.UUID  `json:"id"`
	PlotID               *uuid.UUID `json:"plot_id"`
	ZoneID               *uuid.UUID `json:"zone_id"`
	Title                string     `json:"title"`
	Description          *string    `json:"description"`
	Kind                 string     `json:"kind"`
	Status               string     `json:"status"`
	DueOn                *string    `json:"due_on"`
	CompletedAt          *time.Time `json:"completed_at"`
	ResolvedByActivityID *uuid.UUID `json:"resolved_by_activity_id"`
	Version              int        `json:"version"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

// TaskInput is a whole task as the client sends it (see ActivityInput for base_version).
type TaskInput struct {
	PlotID               *uuid.UUID `json:"plot_id"`
	ZoneID               *uuid.UUID `json:"zone_id"`
	Title                string     `json:"title"`
	Description          *string    `json:"description"`
	Kind                 string     `json:"kind"`
	Status               string     `json:"status"`
	DueOn                *string    `json:"due_on"`
	ResolvedByActivityID *uuid.UUID `json:"resolved_by_activity_id"`
	BaseVersion          *int       `json:"base_version"`
}

func (in TaskInput) normalize() (TaskInput, error) {
	var err error
	if (in.PlotID == nil) == (in.ZoneID == nil) {
		return in, invalid("zone_id", "tem de ser uma zona ou uma parcela, não as duas")
	}
	if in.Title, err = requiredText("title", in.Title, 200); err != nil {
		return in, err
	}
	if in.Description, err = optionalText("description", in.Description, 4000); err != nil {
		return in, err
	}
	if in.Kind == "" {
		in.Kind = "other"
	}
	if !slices.Contains(TaskKinds, in.Kind) {
		return in, invalid("kind", "não é um tipo de tarefa conhecido")
	}
	if in.Status == "" {
		in.Status = "open"
	}
	if !slices.Contains(TaskStatuses, in.Status) {
		return in, invalid("status", "tem de ser por fazer, em curso, feita ou cancelada")
	}
	if in.DueOn != nil {
		if _, err := time.Parse(time.DateOnly, *in.DueOn); err != nil {
			return in, invalid("due_on", "tem de ser uma data (AAAA-MM-DD)")
		}
	}
	return in, nil
}

func (t Task) sameContent(in TaskInput) bool {
	return ptrEq(t.PlotID, in.PlotID) && ptrEq(t.ZoneID, in.ZoneID) && t.Title == in.Title &&
		ptrEq(t.Description, in.Description) && t.Kind == in.Kind && t.Status == in.Status &&
		ptrEq(t.DueOn, in.DueOn) && ptrEq(t.ResolvedByActivityID, in.ResolvedByActivityID)
}

const taskCols = `t.id, t.plot_id, t.zone_id, t.title, t.description, t.kind::text, t.status::text,
	to_char(t.due_on, 'YYYY-MM-DD'), t.completed_at, t.resolved_by_activity_id, t.version, t.created_at, t.updated_at`

func scanTask(row pgx.Row) (Task, error) {
	var t Task
	err := row.Scan(&t.ID, &t.PlotID, &t.ZoneID, &t.Title, &t.Description, &t.Kind, &t.Status,
		&t.DueOn, &t.CompletedAt, &t.ResolvedByActivityID, &t.Version, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

// TaskFilter narrows ListTasks.
type TaskFilter struct {
	OpenOnly bool       // open and in progress only
	ZoneID   *uuid.UUID // tasks on this zone
	PlotID   *uuid.UUID // tasks on this plot or on its zones
}

// ListTasks returns live tasks on live plots/zones: open ones first by due date
// (undated last), then the rest, most recently closed first.
func (s *Store) ListTasks(ctx context.Context, f TaskFilter) ([]Task, error) {
	rows, err := s.db.Query(ctx, `
		SELECT `+taskCols+`
		  FROM task t
		  LEFT JOIN zone z ON z.id = t.zone_id
		  JOIN plot p ON p.id = COALESCE(t.plot_id, z.plot_id) AND p.deleted_at IS NULL
		 WHERE t.deleted_at IS NULL AND (t.zone_id IS NULL OR z.deleted_at IS NULL)
		   AND (NOT $1 OR t.status IN ('open', 'in_progress'))
		   AND ($2::uuid IS NULL OR t.zone_id = $2)
		   AND ($3::uuid IS NULL OR p.id = $3)
		 ORDER BY t.status IN ('done', 'cancelled'),
		          CASE WHEN t.status IN ('open', 'in_progress') THEN t.due_on END NULLS LAST,
		          t.completed_at DESC NULLS LAST, t.created_at, t.id
		 LIMIT 2000`, f.OpenOnly, f.ZoneID, f.PlotID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Task, error) { return scanTask(r) })
}

func (s *Store) getTask(ctx context.Context, id uuid.UUID) (Task, error) {
	t, err := scanTask(s.db.QueryRow(ctx, `SELECT `+taskCols+` FROM task t WHERE t.id = $1 AND t.deleted_at IS NULL`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return t, ErrNotFound
	}
	return t, err
}

// TaskConflictError carries the server's current copy of a task edited elsewhere.
type TaskConflictError struct{ Current Task }

func (e *TaskConflictError) Error() string { return "version conflict" }
func (e *TaskConflictError) Unwrap() error { return ErrVersionConflict }

// PutTask creates or updates a task by client id, with the same rules as activities:
// same content is a no-op, edits need the version they started from.
func (s *Store) PutTask(ctx context.Context, id uuid.UUID, in TaskInput) (t Task, created bool, err error) {
	if in, err = in.normalize(); err != nil {
		return t, false, err
	}
	err = s.inTx(ctx, func(tx *Store) error {
		if _, err := tx.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, id); err != nil {
			return err
		}
		// The plot/zone first, then the task row: the same order DeleteZone/DeletePlot
		// take them in, so the two can't deadlock. FOR SHARE keeps the target alive.
		var targetDeleted *bool
		if in.ZoneID != nil {
			// two statements, plot then zone: one locking both could take the zone first and
			// deadlock with PutZone, which holds the plot (FOR NO KEY UPDATE) and then writes the zone
			var plotDeleted, zoneDeleted bool
			err := tx.db.QueryRow(ctx, `SELECT deleted_at IS NOT NULL FROM plot
				WHERE id = (SELECT plot_id FROM zone WHERE id = $1) FOR SHARE`, in.ZoneID).Scan(&plotDeleted)
			if err == nil {
				err = tx.db.QueryRow(ctx, `SELECT deleted_at IS NOT NULL FROM zone WHERE id = $1 FOR SHARE`, in.ZoneID).Scan(&zoneDeleted)
			}
			if err == nil {
				targetDeleted = new(plotDeleted || zoneDeleted)
			}
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		} else {
			err := tx.db.QueryRow(ctx, `SELECT deleted_at IS NOT NULL FROM plot WHERE id = $1 FOR SHARE`, in.PlotID).Scan(&targetDeleted)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		if targetDeleted == nil {
			return invalid("zone_id", "não é uma zona nem uma parcela conhecida")
		}
		if *targetDeleted {
			return ErrDeleted // its zone or plot was deleted meanwhile: the task went with it
		}

		var version int
		var deleted bool
		err := tx.db.QueryRow(ctx, `SELECT version, deleted_at IS NOT NULL FROM task WHERE id = $1 FOR UPDATE`, id).Scan(&version, &deleted)
		exists := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if deleted || (!exists && in.BaseVersion != nil) {
			return ErrDeleted
		}
		var current Task
		if exists {
			if current, err = tx.getTask(ctx, id); err != nil {
				return err
			}
			if current.sameContent(in) {
				t = current
				return nil
			}
			if in.BaseVersion == nil || *in.BaseVersion != version {
				return &TaskConflictError{Current: current}
			}
		}

		// checked only when it changes: an old link to a since-deleted activity
		// mustn't block unrelated edits of the task
		if in.ResolvedByActivityID != nil && !ptrEq(in.ResolvedByActivityID, current.ResolvedByActivityID) {
			var live bool
			if err := tx.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM activity WHERE id = $1 AND deleted_at IS NULL)`,
				in.ResolvedByActivityID).Scan(&live); err != nil {
				return err
			}
			if !live {
				return invalid("resolved_by_activity_id", "não existe ou foi apagada")
			}
		}

		if exists {
			// completed_at: kept while closed, set when closing, cleared when reopened
			_, err = tx.db.Exec(ctx, `
				UPDATE task SET plot_id = $2, zone_id = $3, title = $4, description = $5, kind = $6::task_kind,
				       status = $7::task_status, due_on = $8::date, resolved_by_activity_id = $9,
				       completed_at = CASE WHEN $7 IN ('done', 'cancelled') THEN COALESCE(completed_at, clock_timestamp()) END
				 WHERE id = $1`,
				id, in.PlotID, in.ZoneID, in.Title, in.Description, in.Kind, in.Status, in.DueOn, in.ResolvedByActivityID)
		} else {
			_, err = tx.db.Exec(ctx, `
				INSERT INTO task (id, plot_id, zone_id, title, description, kind, status, due_on, resolved_by_activity_id, completed_at)
				VALUES ($1, $2, $3, $4, $5, $6::task_kind, $7::task_status, $8::date, $9,
				        CASE WHEN $7 IN ('done', 'cancelled') THEN clock_timestamp() END)`,
				id, in.PlotID, in.ZoneID, in.Title, in.Description, in.Kind, in.Status, in.DueOn, in.ResolvedByActivityID)
		}
		if err != nil {
			return err
		}
		created = !exists
		t, err = tx.getTask(ctx, id)
		return err
	})
	return t, created, err
}

// DeleteTask soft-deletes a task. Idempotent.
func (s *Store) DeleteTask(ctx context.Context, id uuid.UUID) error {
	var existed bool
	err := s.db.QueryRow(ctx, `
		WITH upd AS (UPDATE task SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id)
		SELECT EXISTS (SELECT 1 FROM upd) OR EXISTS (SELECT 1 FROM task WHERE id = $1)`, id).Scan(&existed)
	if err != nil {
		return err
	}
	if !existed {
		return ErrNotFound
	}
	return nil
}
