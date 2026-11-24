package httpapi

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"forest/internal/store"
)

// exportTypeLabel: activity types as a spreadsheet reader would name them.
var exportTypeLabel = map[string]string{
	"watering":    "Watering",
	"sowing":      "Sowing",
	"planting":    "Planting",
	"fertilizing": "Fertilizing",
	"other":       "Other",
}

// exportUnitLabel: units as the app shows them (holes are "covas" in the field).
var exportUnitLabel = map[string]string{
	"holes":  "covas",
	"seeds":  "seeds",
	"trees":  "trees",
	"litres": "litres",
	"kg":     "kg",
}

// exportUnitOrder keeps several units in one cell in a stable order.
var exportUnitOrder = []string{"holes", "seeds", "trees", "litres", "kg"}

// listSep joins several zones, plots or species in one cell.
const listSep = "; "

// GET /api/export/activities.csv — the whole activity log, oldest first, for a
// spreadsheet. UTF-8 with a BOM, so Excel shows accents right. Names only: no ids,
// no shapes, no coordinates.
func (h *handlers) exportActivitiesCSV(w http.ResponseWriter, r *http.Request) {
	list, today, err := h.store.ExportActivities(r.Context())
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	var buf bytes.Buffer
	buf.WriteString("\uFEFF")
	cw := csv.NewWriter(&buf)
	cw.UseCRLF = true // what spreadsheets expect
	_ = cw.Write([]string{"Date", "Type", "Zones", "Plots", "Species", "Quantity", "Notes"})
	for _, a := range list {
		notes := ""
		if a.Notes != nil {
			notes = *a.Notes
		}
		_ = cw.Write(safeCells(
			a.PerformedOn,
			exportTypeLabel[a.Type],
			strings.Join(exportZoneNames(a.Zones), listSep),
			strings.Join(exportPlotNames(a.Zones), listSep),
			strings.Join(exportSpecies(a.Species), listSep),
			exportQuantity(a),
			notes,
		))
	}
	cw.Flush()
	if err := cw.Error(); err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="forest-activities-%s.csv"`, today))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

// safeCells keeps a spreadsheet from running a cell as a formula: text that starts
// like one ("=…", "+…", "-…", "@…") gets a leading apostrophe.
func safeCells(cells ...string) []string {
	for i, c := range cells {
		if c != "" && strings.ContainsRune("=+-@\t\r", rune(c[0])) {
			cells[i] = "'" + c
		}
	}
	return cells
}

// exportZoneName mirrors the app's zoneName: the label, or what the zone is.
func exportZoneName(z store.ExportZone) string {
	if z.Label != nil {
		return *z.Label
	}
	switch z.Kind {
	case "path":
		return "Path"
	case "other":
		return "Unnamed area"
	}
	return "Unnamed zone"
}

func exportZoneNames(zones []store.ExportZone) []string {
	names := make([]string, len(zones))
	for i, z := range zones {
		names[i] = exportZoneName(z)
	}
	return names
}

// exportPlotNames: each plot once, in the zones' order (they come sorted by plot).
func exportPlotNames(zones []store.ExportZone) []string {
	var names []string
	for _, z := range zones {
		if len(names) == 0 || names[len(names)-1] != z.Plot {
			names = append(names, z.Plot)
		}
	}
	return names
}

// exportSpecies: "Quercus suber (sobreiro): 20 trees" — common name and quantity when known.
func exportSpecies(list []store.ExportSpecies) []string {
	out := make([]string, len(list))
	for i, s := range list {
		t := s.ScientificName
		if s.CommonName != nil {
			t += " (" + *s.CommonName + ")"
		}
		if s.Quantity != nil && s.Unit != nil {
			t += ": " + quantityText(*s.Quantity, *s.Unit)
		}
		out[i] = t
	}
	return out
}

func quantityText(n int, unit string) string {
	return strconv.Itoa(n) + " " + exportUnitLabel[unit]
}

// exportQuantity: the activity's total, added up per unit over its zones
// ("120 litres", "300 covas; 40 seeds"). With no quantity per zone, the species'
// quantities are added up instead (a planting counted by species).
func exportQuantity(a store.ExportActivity) string {
	totals := map[string]int{}
	for _, z := range a.Zones {
		if z.Quantity != nil && z.Unit != nil {
			totals[*z.Unit] += *z.Quantity
		}
	}
	if len(totals) == 0 {
		for _, s := range a.Species {
			if s.Quantity != nil && s.Unit != nil {
				totals[*s.Unit] += *s.Quantity
			}
		}
	}
	var parts []string
	for _, u := range exportUnitOrder {
		if n, ok := totals[u]; ok {
			parts = append(parts, quantityText(n, u))
		}
	}
	return strings.Join(parts, listSep)
}
