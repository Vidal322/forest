package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"forest/internal/dbtest"
)

// The app shows validation and conflict messages after the field's name ("O nome" +
// "é obrigatório"), so they are in Portuguese; codes and statuses stay as they were.
func TestErrorMessagesInPortuguese(t *testing.T) {
	h := newDBRouter(t)
	zone := uuid.NewString()
	dup := dbtest.Name("Test Msg quercus")
	send(t, h, http.MethodPut, "/api/species/"+uuid.NewString(), `{"scientific_name":"`+dup+`"}`)
	cases := []struct {
		name, method, path, body string
		status                   int
		code, field, message     string
	}{
		{"required", http.MethodPut, "/api/species/" + uuid.NewString(), `{"scientific_name":"  "}`,
			422, "invalid", "scientific_name", "é obrigatório"},
		{"duplicate", http.MethodPut, "/api/species/" + uuid.NewString(), `{"scientific_name":"` + dup + `"}`,
			409, "duplicate", "scientific_name", "já existe uma espécie com este nome"},
		{"plural field", http.MethodPut, "/api/plots/" + uuid.NewString(),
			`{"name":"P","geom":` + squareJSON + `,"notes":"` + strings.Repeat("a", 2001) + `"}`,
			422, "invalid", "notes", "podem ter no máximo 2000 caracteres"},
		{"no zone", http.MethodPut, "/api/activities/" + uuid.NewString(),
			`{"type":"watering","performed_on":"2026-01-01","zones":[]}`,
			422, "invalid", "zones", "escolhe pelo menos uma zona"},
		{"unit", http.MethodPut, "/api/activities/" + uuid.NewString(),
			`{"type":"watering","performed_on":"2026-01-01","zones":[{"zone_id":"` + zone + `","quantity":3,"unit":"holes"}]}`,
			422, "invalid", "zones", "covas não se contam numa rega"},
		{"species note", http.MethodPut, "/api/activities/" + uuid.NewString(),
			`{"type":"sowing","performed_on":"2026-01-01","zones":[{"zone_id":"` + zone + `"}],
			  "species":[{"species_id":"` + uuid.NewString() + `","notes":"x\u0000"}]}`,
			422, "invalid", "species", "a nota tem caracteres que não se podem guardar"},
		{"bad id", http.MethodPut, "/api/species/nope", `{"scientific_name":"X"}`,
			400, "bad_id", "", "o id tem de ser um UUID"},
		{"unknown route", http.MethodGet, "/api/nope", ``,
			404, "not_found", "", "este endereço não existe"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := send(t, h, c.method, c.path, c.body)
			var b errorBody
			if err := json.NewDecoder(rec.Body).Decode(&b); err != nil {
				t.Fatalf("not the JSON error shape: %v", err)
			}
			if rec.Code != c.status || b.Error.Code != c.code || b.Error.Field != c.field || b.Error.Message != c.message {
				t.Fatalf("got %d %q %q %q, want %d %q %q %q", rec.Code, b.Error.Code, b.Error.Field, b.Error.Message,
					c.status, c.code, c.field, c.message)
			}
		})
	}
}
