package photo

import (
	"encoding/binary"
	"image"
	"image/draw"
)

// jpegOrientation returns the EXIF Orientation (1–8) of a JPEG, or 1 if there is none.
// Phones store pixels as the sensor saw them and only *tag* the rotation; since the
// re-encode drops all metadata, the rotation must be applied to the pixels first —
// otherwise the field's frame would be sideways forever.
func jpegOrientation(data []byte) int {
	if len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		return 1
	}
	for i := 2; i+4 <= len(data); {
		if data[i] != 0xFF {
			return 1
		}
		marker := data[i+1]
		if marker == 0xD9 || marker == 0xDA { // end of image / start of scan: no more metadata
			return 1
		}
		size := int(binary.BigEndian.Uint16(data[i+2:]))
		if size < 2 || i+2+size > len(data) {
			return 1
		}
		seg := data[i+4 : i+2+size]
		if marker == 0xE1 && len(seg) > 6 && string(seg[:6]) == "Exif\x00\x00" {
			return tiffOrientation(seg[6:])
		}
		i += 2 + size
	}
	return 1
}

func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 1
	}
	var bo binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 1
	}
	ifd := int(bo.Uint32(t[4:]))
	if ifd < 8 || ifd+2 > len(t) {
		return 1
	}
	n := int(bo.Uint16(t[ifd:]))
	for k := range n {
		e := ifd + 2 + k*12
		if e+12 > len(t) {
			return 1
		}
		if bo.Uint16(t[e:]) == 0x0112 { // Orientation, SHORT
			if v := int(bo.Uint16(t[e+8:])); v >= 1 && v <= 8 {
				return v
			}
			return 1
		}
	}
	return 1
}

// orient returns img turned upright for an EXIF orientation, on an opaque white
// background (JPEG has no transparency; transparent pixels would turn black).
func orient(img image.Image, o int) *image.RGBA {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if o >= 5 { // 5–8 swap the axes
		w, h = h, w
	}
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(out, out.Bounds(), image.White, image.Point{}, draw.Src)
	if o <= 1 {
		draw.Draw(out, out.Bounds(), img, b.Min, draw.Over)
		return out
	}
	src := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(src, src.Bounds(), image.White, image.Point{}, draw.Src)
	draw.Draw(src, src.Bounds(), img, b.Min, draw.Over)
	sw, sh := b.Dx(), b.Dy()
	for y := range sh {
		for x := range sw {
			var dx, dy int
			switch o {
			case 2: // mirrored horizontally
				dx, dy = sw-1-x, y
			case 3: // rotated 180°
				dx, dy = sw-1-x, sh-1-y
			case 4: // mirrored vertically
				dx, dy = x, sh-1-y
			case 5: // transposed
				dx, dy = y, x
			case 6: // rotated 90° clockwise to display
				dx, dy = sh-1-y, x
			case 7: // transverse
				dx, dy = sh-1-y, sw-1-x
			case 8: // rotated 90° counter-clockwise to display
				dx, dy = y, sw-1-x
			}
			i, j := src.PixOffset(x, y), out.PixOffset(dx, dy)
			copy(out.Pix[j:j+4], src.Pix[i:i+4])
		}
	}
	return out
}
