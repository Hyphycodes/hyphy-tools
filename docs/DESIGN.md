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

## Motion

One ease (`cubic-bezier(.16,1,.3,1)`), 150–400ms. Panels rise in with a small stagger, sheets
slide, the Create plus rotates to a close. Nothing loops. `prefers-reduced-motion` removes motion.

## Voice

Plain and specific: People, Spaces, Projects, Files, Tools, Needs attention, "Who can access
this?". Never tenant, RBAC, schema or workflow. Demo content is fictional and labeled; the
preview says so where it matters ("In this preview, Hyphy keeps a file's details, not the file").
