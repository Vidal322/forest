// Package store reads and writes the Forest database. Handlers talk to it,
// never to SQL directly. Every method takes the caller's context.
package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DB is what the store needs from a connection: *pgxpool.Pool in the app,
// a pgx.Tx in tests (rolled back afterwards). Begin on a Tx makes a savepoint.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Store is the data access layer.
type Store struct{ db DB }

// New returns a Store backed by db.
func New(db DB) *Store { return &Store{db: db} }

// Ping checks the database answers (readiness probe).
func (s *Store) Ping(ctx context.Context) error {
	var one int
	return s.db.QueryRow(ctx, "SELECT 1").Scan(&one)
}

var (
	// ErrNotFound: no live row with that id.
	ErrNotFound = errors.New("not found")
	// ErrDeleted: the id belongs to a deleted row (a tombstone). Writes to it are
	// refused so a late offline edit can't bring a deleted entry back.
	ErrDeleted = errors.New("deleted")
	// ErrVersionConflict: the row changed since the version the client edited.
	ErrVersionConflict = errors.New("version conflict")
)

// ValidationError says which input field is wrong and why (shown next to that field).
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Message }

// ConflictError: the value clashes with another live row (e.g. a duplicate name).
type ConflictError struct {
	Field   string
	Message string
}

func (e *ConflictError) Error() string { return e.Field + ": " + e.Message }

func invalid(field, format string, args ...any) error {
	return &ValidationError{Field: field, Message: fmt.Sprintf(format, args...)}
}

// isUniqueViolation reports whether err is a unique-index violation on constraint.
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}

// requiredText trims s and checks it is non-empty and at most max characters.
func requiredText(field, s string, maxLen int) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", invalid(field, "is required")
	}
	if !validText(s) {
		return "", invalid(field, "contains characters that can't be stored")
	}
	if utf8.RuneCountInString(s) > maxLen {
		return "", invalid(field, "must be at most %d characters", maxLen)
	}
	return s, nil
}

// optionalText trims s; blank becomes nil (NULL).
func optionalText(field string, s *string, maxLen int) (*string, error) {
	if s == nil {
		return nil, nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil, nil
	}
	if !validText(t) {
		return nil, invalid(field, "contains characters that can't be stored")
	}
	if utf8.RuneCountInString(t) > maxLen {
		return nil, invalid(field, "must be at most %d characters", maxLen)
	}
	return &t, nil
}

// validText: valid UTF-8 without NUL bytes (PostgreSQL text can't hold either).
func validText(s string) bool {
	return utf8.ValidString(s) && !strings.ContainsRune(s, 0)
}
