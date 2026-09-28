# Design system

Hyphy Tools belongs to the Hyphy family (same typefaces, same signal blue and tool colors as
Hyphy Studio) but it is a product, not a site: calmer, denser and built to be used all day.

## Material

- **Paper and sheets.** The app sits on warm paper (`--color-canvas #f3f1eb`). On desktop the
  content is one white sheet inset beside the sidebar; inside it, content is grouped in white
  panels with a hairline ring (`shadow-card`). On phones the page is paper and panels are white —
  the familiar grouped-list feel.
- **One accent.** Signal blue (`#3240ff`) is reserved for Create, focus rings, selection and the
  inbox count. Primary buttons are ink.
- **Tools bring the color.** Each tool has its own color world (PDF coral, QR mint, Images sun,
  Receipts lime, Mileage sky, Links pink), used for its glyph, header and previews. Business modules
  (Projects, Vehicles, People, Files) are ink. That split is the product's hierarchy: the platform
  is calm; the tools are bright.
- **Spaces have marks.** A rounded square with the Space's color and monogram (Hyphy LLC wears the
  spark); personal Spaces are round.

## Type

- **Mona Sans** for the interface: 14px on desktop, 15px on phones (16px in inputs).
- **Hubot Sans** (`.display`, weight 750, width 108) for page titles and greetings only.
- **Martian Mono** (`.label`) for section eyebrows, table heads and small numbers.
- Headline numbers use Mona Sans semibold with proportional figures; columns use tabular figures.

## Components

`components/ui`: Button / ButtonLink (primary, accent, secondary, ghost, danger; sizes that grow to
44px+ on phones), Panel and PanelHeader, PageHeader and Page, Badge and Count, Avatar and
AvatarStack, SpaceMark, ToolGlyph, Progress (a meter whose track is a tint of its own fill), Tabs
and Chips (links, so every view has a URL), Field / Input / Select / Textarea / Segmented,
EmptyState, Kbd, Sheet (one overlay: bottom sheet on phones, floating drawer on desktop, built on
`<dialog>`), Popover (menu on desktop, sheet on phones), Toast, Icon (Lucide at 1.75 stroke plus
Hyphy's own tool pictograms from Studio).

## Layout and responsiveness

- Desktop: 252px sidebar (Space switcher, search, Create, sections, pinned tools, profile) beside
  the content sheet. Pages cap at 1180px, wide pages at 1400px.
- Phones: a top bar (Space switcher, search, profile) and a bottom tab bar with a raised Create
  button in the middle. Create, menus and forms open as bottom sheets with large targets. Members
  get a 2×2 grid of their four actions on Home.
- Grids never overflow: panels and form fields carry `min-w-0`; every page is checked at 390px.

## Composition

- **Tools look like what they make.** Tool pages start with a slim header in the tool's color and
  go straight to the work: PDFs show their pages, QR codes draw as you type, a link page is edited
  on the phone itself. The Tools library is a bento of those tools with a live line each ("2 saved
  codes") and one next step, never a grid of identical cards.
- **Dashboards answer a question, not show widgets.** A sentence up top says what matters today in
  specifics ("6 submissions are waiting for your approval"), then the page follows that order.
- **Records open in place.** A receipt opens as a sheet (bottom on phones, drawer on desktop) whose
  state lives in the URL, so it can be linked to and closed with Back.
- **Try it without a file.** Tools that need input offer a sample made on the device (a receipt,
  three PDFs or a 7-page packet, a phone-sized photo), so the first use is the real thing.
- **The number is the form.** Where one value matters most (a trip's miles), it is the big input
  itself, with the rest of the form filling in from a trip driven before.
- **Relationships are always visible.** Files, receipts and trips show what they belong to — a
  project, a vehicle, a person, the tool that made them — with that record's icon.

## Motion

One ease (`cubic-bezier(.16,1,.3,1)`), 150–400ms. Panels rise in with a small stagger, sheets
slide, the Create plus rotates to a close, an inbox item you act on tints with its outcome and
slides away. Nothing loops. `prefers-reduced-motion` removes motion.

## Voice

Plain and specific: People, Spaces, Projects, Files, Tools, Needs attention, "Who can access
this?". Never tenant, RBAC, schema or workflow. Demo content is fictional and labeled; the
preview says so where it matters ("In this preview, Hyphy keeps a file's details, not the file").

## The public Tools world

The marketplace is Hyphy at night; every tool page is its own lit room. The Tool Experience
System (docs/EXPERIENCE.md) gives each tool a world — surface, room, paper, ink, pattern, main
object, motion personality and payoff — and re-lights the tokens for it, so Split is cream
receipt paper and lime, When? a sunrise, QR Studio a bright studio, PDF a desk of warm paper.
The notes below describe the night marketplace; tool pages follow EXPERIENCE.md.

## After dark: the marketplace

The marketplace and tool pages (`src/app/(public)`, `world.css`) are Hyphy at night — the same
typefaces and tool colors, re-lit on Hyphy Studio's night surface (`#0b0b0a`).

- **Tokens, re-lit.** `.world-night` redefines the semantic tokens (canvas, surface, subtle, well,
  ink, muted, faint, line, signal, positive, caution, critical, and `on-ink` for text on an ink
  fill). Components written against tokens — every tool — work in both worlds unchanged. Shadows
  become hairline edges and depth.
- **Cinematic, not busy.** Near-black canvas with a whisper of grain, layered charcoal surfaces,
  soft accent light behind artwork, big editorial type (Hubot Sans at up to 248px for “Tools”),
  generous section spacing. No gradients for their own sake, no neon, no glass everywhere.
- **Tools bring the light.** Each tool has an accent and its own artwork
  (`components/marketplace/art.tsx`): a composition of what it makes, on a charcoal stage lit in
  its color. Families rhyme (Gather is warm, Signal electric, Image Lab sunlit, File Lab paper).
- **Every tool is its own world.** `components/marketplace/worlds.ts` gives each tool a second
  light (`--glow`), a backdrop pattern drawn from what it's about (receipt paper for Split, a
  calendar for When?, a picnic cloth for Bring, code modules for QR, crop frames for Social Crop,
  paint for Palette, column rules for Signal, a ledger for Subscriptions), a mood and the few
  words of its path ("Snap the receipt → Who had what → Everyone's total"). On a tool page
  (`.tool-world`) the night surfaces, lines, selection and focus take on a breath of the tool's
  accent, so no two tools feel like the same black screen. Patterns are CSS gradients only.
- **Guided, not forms.** Tools open on a warm start screen (`StartPanel`) with a picture of the
  result, one obvious way in and a sample; choices are tapped (`Choices`, `ChoiceCards`) rather
  than typed; the next action is one big button in the tool's color (`ActionButton`, kept under
  the thumb on phones by `ActionBar`); anything not needed yet waits under `MoreOptions`; tools
  with steps show where you are (`Journey`). All in `components/tools/kit.tsx`.
- **Beauty that reduces friction.** People come to do something; the marketplace should let
  them find it in seconds. Two featured moments, then three shelves with three moods, each in
  its own shape: “Make it look good” as posters wearing each tool's color (a swipeable row on a
  phone), “Plans with people” as wide cards washed in the tool's color, “Everyday helpers” as lit
  tiles; then every tool as a row. No counts, staff picks or stacks of badges.
- **Search is the centerpiece.** “What do you need to do?” with a rotating example, job chips,
  results as you type, the reason a tool matched, and ⌘K everywhere.
- **Plain words first, details second.** A tool page opens into the tool; privacy is one quiet
  line ("Processed on your device") with the details a tap away. Implementation words (hashes,
  links after the #, formats) never lead.
- **Motion with a job, and cheap.** The hero's light drifts slowly, cards lift on hover, pages
  fade in as they open. CSS transforms and opacity only (no blur filters, no view transitions);
  reduced motion turns every bit of it off.
- **Phones first.** The hero, search and filters fit 390px; family rows swipe; tools stack with
  their result first where it matters (QR draws above its controls); touch targets are 44px.
