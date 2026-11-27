/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

/**
 * The automatic part of the redesign's anti-AI checklist (docs/backlog.md, "Redesign Pintar"): no emoji as icons, no
 * shadows, gradients or all-caps, no " · " joined strings and no arrows in text. It reads the text a user can get to
 * (JSX text, string and template literals, never comments) in every component and page, and all of styles.css.
 */

// (code points written as numbers: symbols such as U+FE0F are invisible in the source)
const chars = (...ranges: [number, number][]) => ranges.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join('')
// pictographs, the misc symbols and dingbats blocks (check marks, crosses, pencils), U+FE0F and the full-width plus
const EMOJI = new RegExp(`\\p{Extended_Pictographic}|[${chars([0x2600, 0x27bf], [0x2b00, 0x2bff], [0xfe0f, 0xfe0f], [0xff0b, 0xff0b])}]`, 'u')
// the arrow blocks, and the single angle quotes and small triangles used as chevrons
const ARROW = new RegExp(`[${chars([0x2190, 0x21ff], [0x27f0, 0x27ff], [0x2900, 0x297f], [0x2039, 0x2039], [0x203a, 0x203a], [0x25b2, 0x25c5])}]`, 'u')
const RULES: [string, RegExp][] = [
  ['emoji', EMOJI],
  ['arrow', ARROW],
  ['middle dot', /·/],
  ['box-shadow', /box-?shadow/i],
  ['uppercase', /uppercase/i],
  ['gradient', /gradient\(/i],
]

/** What breaks a rule in one piece of text: "arrow: ← Mapa". */
function breaches(text: string): string[] {
  return RULES.filter(([, re]) => re.test(text)).map(([rule]) => `${rule}: ${text.trim().replace(/\s+/g, ' ')}`)
}

/** The texts a .tsx file can show (and its inline styles): JSX text, strings, template parts, style keys. */
function textsOf(file: string, code: string): string[] {
  const { program, errors } = parseSync(file, code)
  if (errors.length > 0) throw new Error(`${file}: ${errors[0]!.message}`)
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; value?: unknown; key?: { name?: string } }
    if (n.type === 'JSXText' && typeof n.value === 'string') out.push(n.value)
    if (n.type === 'Literal' && typeof n.value === 'string') out.push(n.value)
    if (n.type === 'TemplateElement') out.push((n.value as { cooked?: string }).cooked ?? '')
    // style={{ boxShadow: … }}
    if (n.type === 'Property' && n.key?.name) out.push(n.key.name)
    for (const [k, v] of Object.entries(node)) if (k !== 'type') walk(v)
  }
  walk(program)
  return out.filter((t) => t.trim() !== '')
}

function cssBreaches(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return code
    .split('\n')
    .flatMap((line) => breaches(line))
}

// every component and page as text, keyed "src/pages/MapPage.tsx" (tests and test helpers left out)
const SOURCES = Object.fromEntries(
  Object.entries(import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx', '!../test/**'], { query: '?raw', import: 'default', eager: true })).map(
    ([path, code]) => [new URL(path, 'file:///x/src/app/').pathname.slice('/x/'.length), code],
  ),
)

/**
 * Pages not restyled yet (P3–P6 restyle them). Each entry is one text the rules catch today; the item that restyles
 * the page takes its entries out, and the list ends empty with P6. The shell and the shared components have none.
 */
const ALLOWED: Record<string, string[]> = {
  // P3, the map
  'src/components/AsOf.tsx': ['middle dot: · a carregar…'],
  'src/components/NeedsAttention.tsx': ['middle dot: ·'],
  'src/components/ShapeEditor.tsx': ['middle dot: ·'],
  'src/components/ZoneList.tsx': ['middle dot: ·'],
  'src/map/FieldLayers.tsx': ['middle dot: ·'],
  // P4c, the log page goes
  'src/pages/LogPage.tsx': ['middle dot: ① toca nas zonas · ② toca no que fizeste · ③ Guardar', 'middle dot: ·', 'middle dot: · fecha'],
  // P5, the zone page
  'src/pages/ZonePage.tsx': ['middle dot: ·', 'middle dot: · com'],
  // P6, the other screens
  'src/components/PlantedInRange.tsx': ['middle dot: · a atualizar…'],
  'src/pages/FieldSetupPage.tsx': ['middle dot: 1 · O teu terreno e a fotografia', 'middle dot: 2 · Marcar a escala', 'arrow: →'],
  'src/pages/PlotPage.tsx': ['middle dot: ·'],
  'src/pages/SpeciesPage.tsx': ['middle dot: ·'],
  'src/pages/StatsPage.tsx': ['middle dot: · a atualizar…', 'middle dot: ·'],
}

function findings(): Record<string, string[]> {
  const found: Record<string, string[]> = {}
  for (const [file, code] of Object.entries(SOURCES)) {
    const hits = [...new Set(textsOf(file, code).flatMap(breaches))]
    if (hits.length > 0) found[file] = hits
  }
  return found
}

describe('anti-AI checklist, the automatic part', () => {
  it('reads text and strings, never comments', () => {
    const code = `// ← not shown\n/** → nor this · */\nexport const A = () => <p title="a · b">Mapa → <b>{'✕'}</b>{\`x \${1} ←\`}</p>\nconst s = { boxShadow: 'none' }`
    expect(textsOf('a.tsx', code).flatMap(breaches)).toEqual([
      'middle dot: a · b',
      'arrow: Mapa →',
      'emoji: ✕',
      'arrow: ←',
      'box-shadow: boxShadow',
    ])
    expect(cssBreaches('/* box-shadow: none, uppercase */\n.a { color: red; }\n.b { text-transform: uppercase; }')).toEqual([
      'uppercase: .b { text-transform: uppercase; }',
    ])
  })

  it('styles.css has no shadows, gradients, capitals, emoji or arrows', () => {
    const styles = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8') // tests run from frontend/
    expect(styles).toContain(':root')
    expect(cssBreaches(styles)).toEqual([])
  })

  it('reads every component and page', () => {
    expect(Object.keys(SOURCES)).toEqual(expect.arrayContaining(['src/app/Layout.tsx', 'src/components/Icon.tsx', 'src/pages/MapPage.tsx']))
    expect(Object.keys(SOURCES).filter((f) => f.includes('.test.') || f.startsWith('src/test/'))).toEqual([])
  })

  it('components and pages break none of the rules, except the pages not restyled yet', () => {
    const found = findings()
    const unexpected = Object.entries(found).flatMap(([file, hits]) => hits.filter((h) => !ALLOWED[file]?.includes(h)).map((h) => `${file}: ${h}`))
    expect(unexpected).toEqual([])
  })

  it('the allow-list only holds what is still there (take entries out as pages are restyled)', () => {
    const found = findings()
    const stale = Object.entries(ALLOWED).flatMap(([file, hits]) =>
      hits.length === 0 ? [`${file}: empty entry`] : hits.filter((h) => !found[file]?.includes(h)).map((h) => `${file}: ${h}`),
    )
    expect(stale).toEqual([])
  })
})
