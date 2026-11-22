package store

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// inTx runs fn in a transaction (a savepoint when s already runs inside one),
// committing if fn returns nil and rolling back otherwise.
func (s *Store) inTx(ctx context.Context, fn func(tx *Store) error) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error { return fn(&Store{db: tx}) })
}
