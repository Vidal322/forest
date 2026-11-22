// Package dbtest gives tests a real database transaction that is rolled back
// afterwards, so tests never leave data behind and can run against the dev DB.
//
// Each statement runs in its own savepoint: a statement that fails (a duplicate,
// a CHECK) is undone on its own, and the test can carry on using the transaction,
// just like separate requests against the real pool would.
//
// Tests share the dev database with the running app: use unique names
// (see Name) so they never collide with real data or with each other.
package dbtest

import (
	"context"
	"log/slog"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"forest/internal/db"
)

var (
	once    sync.Once
	pool    *pgxpool.Pool
	openErr error
)

// Tx returns a transaction on DATABASE_URL (migrated to the latest schema),
// rolled back when the test ends. Without DATABASE_URL the test is skipped,
// unless FOREST_REQUIRE_DB is set (then it fails, so CI can't skip silently).
func Tx(t testing.TB) pgx.Tx {
	return savepointTx{rawTx(t)}
}

// Name returns prefix plus a random suffix, e.g. "Test Quercus 3f2a9c1e".
func Name(prefix string) string {
	return prefix + " " + uuid.NewString()[:8]
}

func rawTx(t testing.TB) pgx.Tx {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		if os.Getenv("FOREST_REQUIRE_DB") != "" {
			t.Fatal("DATABASE_URL is not set")
		}
		t.Skip("DATABASE_URL not set (cp .env.example .env && make db-up)")
	}
	once.Do(func() {
		ctx := context.Background()
		pool, openErr = db.Open(ctx, url)
		if openErr == nil {
			openErr = db.Migrate(ctx, pool, slog.New(slog.DiscardHandler))
		}
	})
	if openErr != nil {
		t.Fatalf("test database: %v", openErr)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	return tx
}

// savepointTx wraps every statement in a savepoint (pgx: Begin on a Tx).
type savepointTx struct{ pgx.Tx }

func (t savepointTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	sp, err := t.Begin(ctx)
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	tag, err := sp.Exec(ctx, sql, args...)
	return tag, finish(ctx, sp, err)
}

func (t savepointTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	sp, err := t.Begin(ctx)
	if err != nil {
		return errRow{err}
	}
	return spRow{sp: sp, row: sp.QueryRow(ctx, sql, args...), ctx: ctx}
}

func (t savepointTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	sp, err := t.Begin(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := sp.Query(ctx, sql, args...)
	if err != nil {
		return nil, finish(ctx, sp, err)
	}
	return &spRows{Rows: rows, sp: sp, ctx: ctx}, nil
}

// finish releases the savepoint, or rolls back to it if the statement failed.
func finish(ctx context.Context, sp pgx.Tx, err error) error {
	if err != nil {
		_ = sp.Rollback(ctx)
		return err
	}
	return sp.Commit(ctx)
}

type spRow struct {
	sp  pgx.Tx
	row pgx.Row
	ctx context.Context //nolint:containedctx // only lives until Scan
}

func (r spRow) Scan(dest ...any) error {
	err := r.row.Scan(dest...)
	if ferr := finish(r.ctx, r.sp, err); err == nil {
		return ferr
	}
	return err
}

type errRow struct{ err error }

func (r errRow) Scan(...any) error { return r.err }

type spRows struct {
	pgx.Rows
	sp   pgx.Tx
	ctx  context.Context //nolint:containedctx // only lives until Close
	done bool
}

func (r *spRows) Close() {
	r.Rows.Close()
	if !r.done {
		r.done = true
		_ = finish(r.ctx, r.sp, r.Err())
	}
}
