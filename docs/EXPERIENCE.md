# The Hyphy Tool Experience System

Hyphy Tools should feel like little digital objects that are genuinely enjoyable to use, not
technical utilities in one dark template. The architecture is shared; the experience isn't.

## The six things every tool defines

`src/components/marketplace/worlds.ts` gives every tool a world:

| What          | Field                                                   | Example (Split)                  |
| ------------- | ------------------------------------------------------- | -------------------------------- |
| 1. World      | `surface`, `canvas`, `paper`, `ink`, `glow`, `third`, `pattern` | light · cream · receipt paper    |
| 2. Object     | `object`                                                | `receipt`                        |
| 3. Action     | `action`                                                | “Split a check”                  |
| 4. Controls   | the tool's own, from the kit                            | avatars, tap-to-assign, tip chips |
| 5. Motion     | `motion`: `paper` · `snappy` · `soft` · `springy`       | `paper` (settles)                |
| 6. Payoff     | `payoff`: `resolve` · `stamp` · `count` · `emerge` · `flip` · `pair` · `share` | `resolve` (receipt → totals) |

The tool page (`src/app/(public)/tools/[slug]/page.tsx`) is `.tool-world` with the world's
colors as variables and `data-surface`, `data-motion`, `data-object`, `data-payoff`.
`src/app/(public)/world.css` turns those into the product's tokens: `bg-surface`, `bg-canvas`,
`text-ink`, `text-muted`, `border-line`… are the tool's paper, room and ink. A tool written
against tokens takes on its world with no per-tool CSS.

### Variables available inside a tool

- `--accent` — the tool's fill color (buttons, highlights). Text on it: `--on-accent`.
- `--accent-ink` — the accent dark enough to read as text on the world (links, selected labels).
  Use this, never `--accent`, for colored text on a light world.
- `--glow`, `--third` — the world's second and third colors (people, secondary details).
- `--w-canvas`, `--w-paper`, `--w-ink` — the raw world colors.
- `--motion-dur`, `--motion-ease` — the tool's motion personality.

### Color rules

- Never hard-code night colors inside a tool: no `bg-white/[.06]`, `rgb(255 255 255 / …)`
  edges, `#12110d` text on surfaces, `#0b0b0a`. Use `bg-ink/[.06]`, `var(--color-line)`,
  `text-ink`, `text-[var(--on-accent)]`. The same code then works in a light world, a night
  world and inside a light Space.
- White is fine on top of photos and on the tool's object when the object really is white.
- Tools may set `--accent`/`--glow` on their `.tool-world` at runtime when the content should
  light the room (Palette does, from the picture's colors).

## The kit (`src/components/tools/kit.tsx`)

Guided parts: `StartPanel`, `Choices`, `ChoiceCards`, `ActionButton`, `ActionBar`,
`MoreOptions`, `SampleButton`, `Journey`, `FileDrop`, `Stat`, `Note`, `IconButton`, `CopyButton`,
`useCopy`.

Experience parts:

- `Stage` — the stage for the one object: `material="table" | "paper" | "light"`.
- `DropObject` — the way in, shaped like the object (`shape="receipt" | "photo" | "pages" |
  "files" | "plain"`), with a picture inside (`art`), a big title (“Drop your receipt”), one
  button, and children underneath (sample, “type it in instead”). Catches files dropped
  anywhere on the page.
- `PresetCards` — outcomes instead of settings (“WEB · ~640 KB”), the recommended one first.
- `Swatches` — colors tapped, with the system picker as the last swatch.
- `Advanced` — the technical settings, closed.
- `Payoff` — the result, big: `headline` (“✓ 4 PDFs merged”), `value` (huge), `caption`,
  children (the result itself), one `action`, `secondary`, `onReset`.
- `CountUp` — numbers that count to their value. `BeforeAfter` — “7.1 MB → 640 KB”.
  `PillButton` — quiet secondary actions. `useReducedMotion`.

Motion classes (world.css), all in the tool's personality and off with reduced motion:
`fx-pop`, `fx-rise` (stagger with `--i`), `fx-emerge` (out of a picture), `fx-flip` (old → new),
`fx-settle` (pages landing), `fx-pair-l`/`fx-pair-r` (matching things drawn together),
`fx-stamp` (a result landing), `fx-ping` (a tap that took), `fx-move` (transitions).

## Principles

1. **The tool is the hero.** The page opens into the tool; information lives in the info drawer
   (“Stays on your device ⓘ”) and a quiet line below the workspace.
2. **A text field is the last option.** Tap, drag, slide, pick a swatch or a preset first.
3. **Smart defaults.** Make 80% of the decision: recommend, preselect, infer.
4. **One main object.** The receipt, the calendar, the code, the photo, the pages.
5. **Advanced is closed.** Pixels, percentages, encodings and metadata wait behind it.
6. **The payoff beats the setup.** Big, obvious, satisfying; never a toast.
7. **Short, human words.** “Drop your receipt”, “Who had this?”, “Looks right”.
8. **Phones first.** Thumb reach, 44px targets, bottom actions, the camera, minimal typing.
9. **Motion with a job.** 150–300ms, transforms and opacity, nothing loops.

## Adding a tool

Add its world to `worlds.ts` (TypeScript asks), build its interface from the kit around its one
object, give it a payoff, and give it a mini version for the marketplace
(`src/components/marketplace/minis.tsx`).
