package httpapi

import (
	"encoding/csv"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"forest/internal/dbtest"
)

func TestExportActivitiesCSV(t *testing.T) {
	h := newFieldRouter(t)
	// no field yet: just the header
	rec := send(t, h, http.MethodGet, "/api/export/activities.csv", "")
	if rec.Code != 200 || !strings.HasPrefix(rec.Body.String(), "\uFEFFDate,Type,Zones,Plots,Species,Quantity,Notes\r\n") {
		t.Fatalf("empty export: %d %q", rec.Code, rec.Body)
	}

	if rec := upload(t, h, "Quinta", pngBytes(t, 300, 200)); rec.Code != 201 {
		t.Fatalf("setup: %d", rec.Code)
	}
	encosta, vale := uuid.NewString(), uuid.NewString()
	send(t, h, http.MethodPut, "/api/plots/"+vale, `{"name":"Vale","geom":`+squareJSON+`}`)
	send(t, h, http.MethodPut, "/api/plots/"+encosta, `{"name":"Encosta","geom":`+squareJSON+`}`)
	zone := func(plot, fields string) string {
		id := uuid.NewString()
		rec := send(t, h, http.MethodPut, "/api/zones/"+id, `{"plot_id":"`+plot+`",`+fields+
			`"geom":{"type":"Polygon","coordinates":[[[10,10],[30,10],[30,30],[10,30]]]}}`)
		if rec.Code != 201 {
			t.Fatalf("zone: %d %s", rec.Code, rec.Body)
		}
		return id
	}
	path := zone(vale, `"kind":"path",`)
	b := zone(encosta, `"label":"B",`)
	a1 := zone(encosta, `"label":"Á1",`)
	spName := dbtest.Name("Test Export Quercus")
	spID := uuid.NewString()
	send(t, h, http.MethodPut, "/api/species/"+spID, `{"scientific_name":"`+spName+`","common_name":"sobreiro"}`)

	loc, _ := time.LoadLocation("Europe/Lisbon")
	today := time.Now().In(loc).Format(time.DateOnly)
	yesterday := time.Now().In(loc).AddDate(0, 0, -1).Format(time.DateOnly)
	earlier := time.Now().In(loc).AddDate(0, 0, -2).Format(time.DateOnly)
	put := func(body string) string {
		id := uuid.NewString()
		if rec := send(t, h, http.MethodPut, "/api/activities/"+id, body); rec.Code != 201 {
			t.Fatalf("activity: %d %s", rec.Code, rec.Body)
		}
		return id
	}
	put(`{"type":"watering","performed_on":"` + today + `","notes":"=1+1","zones":[{"zone_id":"` + a1 + `","quantity":50,"unit":"litres"}]}`)
	put(`{"type":"sowing","performed_on":"` + yesterday + `","notes":"Ninhos, \"bem\" regados\ncom água",
		"zones":[{"zone_id":"` + path + `","quantity":100,"unit":"holes"},{"zone_id":"` + b + `","quantity":40,"unit":"seeds"},
		         {"zone_id":"` + a1 + `","quantity":20,"unit":"holes"}],
		"species":[{"species_id":"` + spID + `","quantity":300,"unit":"seeds"}]}`)
	put(`{"type":"planting","performed_on":"` + earlier + `","zones":[{"zone_id":"` + b + `"}],
		"species":[{"species_id":"` + spID + `","quantity":12,"unit":"trees"}]}`)
	gone := put(`{"type":"other","performed_on":"` + today + `","notes":"deleted","zones":[{"zone_id":"` + b + `"}]}`)
	send(t, h, http.MethodDelete, "/api/activities/"+gone, "")
	// a zone deleted since keeps its name in the log
	send(t, h, http.MethodDelete, "/api/zones/"+path, "")

	rec = send(t, h, http.MethodGet, "/api/export/activities.csv", "")
	if rec.Code != 200 {
		t.Fatalf("export: %d %s", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/csv; charset=utf-8" {
		t.Errorf("content type %q", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd != `attachment; filename="forest-activities-`+today+`.csv"` {
		t.Errorf("content disposition %q", cd)
	}
	body, ok := strings.CutPrefix(rec.Body.String(), "\uFEFF")
	if !ok {
		t.Fatal("no UTF-8 BOM")
	}
	rows, err := csv.NewReader(strings.NewReader(body)).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	want := [][]string{
		{"Date", "Type", "Zones", "Plots", "Species", "Quantity", "Notes"},
		{earlier, "Planting", "B", "Encosta", spName + " (sobreiro): 12 trees", "12 trees", ""},
		{yesterday, "Sowing", "Á1; B; Path", "Encosta; Vale", spName + " (sobreiro): 300 seeds", "120 covas; 40 seeds",
			"Ninhos, \"bem\" regados\ncom água"},
		{today, "Watering", "Á1", "Encosta", "", "50 litres", "'=1+1"},
	}
	if !slices.EqualFunc(rows, want, slices.Equal) {
		t.Fatalf("rows:\n got %q\nwant %q", rows, want)
	}
	if strings.Contains(body, "coordinates") || strings.Contains(body, a1) {
		t.Error("export leaks shapes or ids")
	}
}
