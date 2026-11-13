# MDX components

This Quartz plugin lets a note written as `.mdx` place interactive figures
between ordinary Markdown. A tag such as `<QueueLab />` on its own lines is
replaced at build time with the figure's full markup, and the page loads that
figure's script only when the figure is on the page.

## Layout

```
build.mjs                     bundles everything below; run by scripts/quartz.sh
src/index.ts                  the Quartz transformer and the page loader
src/shared/                   the toolkit every figure can use (see below)
src/components/<name>/
  component.ts                export const tag = "MyFigure"; export { render } ...
  render.ts                   render(props) -> the figure's HTML at build time
  client.ts                   mount(root) -> makes it interactive, returns cleanup
  model.ts                    the algorithm or simulation, free of the DOM
  style.scss                  the figure's styles, scoped under its own class
test/<name>.test.mjs          checks against an independent reference
test/load.mjs                 bundles a src/ module for a test
```

Generated files are not committed. `scripts/quartz.sh` runs `build.mjs` before
every site build, which writes:

- `dist/index.js`, the plugin with a generated registry of every component;
- `quartz-site/static/mdx/<name>.js`, one browser module per component, loaded
  with a content hash so a changed figure is never served stale;
- `dist/components.scss`, `src/shared/figure.scss` followed by every
  component's `style.scss`; the site build copies it next to `custom.scss`,
  which loads it last.

## Adding a component

1. Make `src/components/<name>/` with `component.ts`, `render.ts` and
   `client.ts`. There is no registry to edit: `build.mjs` finds the directory,
   reads the tag from the line `export const tag = "MyFigure";` and fails the
   build if two components claim the same tag.
2. Put the logic in `model.ts` with no DOM access, so the tests and
   `render.ts` can run it in Node.
3. `render(props)` returns the whole figure, including controls marked
   `disabled`, so the page shows a finished figure before the script runs and
   nothing moves when it arrives. Props are literal attributes from the note
   (`seed={7}`, `label="x"`).
4. `mount(root)` receives the `.mdx-component` wrapper, finds the figure inside
   it, enables the controls and returns a cleanup function. Quartz's SPA
   navigation calls the cleanup when the reader leaves the page.
5. Style it in `style.scss`, under the figure's class (`figure.xy`) and a short
   class prefix (`.xy-`).
6. Test it: `test/<name>.test.mjs`, using `load("components/<name>/model.ts")`.
7. Place `<MyFigure />` in a `.mdx` note and build.

```sh
cd notes/quartz-site/plugins/mdx
npm install          # once
npm run build        # writes dist/ and static/mdx/
npm test
```

## The shared toolkit

Use these instead of writing your own; each one is already used by several
figures.

**Styles** (`src/shared/figure.scss`, available in every `style.scss` without
an import):

- `fig-frame($padding)`: the bordered box a figure sits in.
- `fig-button($padding, $font-size, $radius)`, `fig-button-hover`,
  `fig-pressed`: quiet buttons and selects, hover, and the chosen option.
- `fig-slider($gap)`: a labelled range input with its `<output>`.
- `fig-chart`: an SVG that scales with the figure.
- `fig-caption($font-size, $margin-top)`.
- `fig-table`: a table that looks the same whether Quartz wrapped it in
  `.table-container` (build-time markup) or the script redrew it (no wrapper).
- `fig-native-check`: a plain checkbox or radio, undoing the site's task-list
  styling.
- `fig-phone($width: 600px) { ... }`: the phone layout switch.
- Colors: `--fig-blue`, `--fig-orange`, `--fig-red`, `--fig-green` and
  `--fig-purple` for data series, each with a dark-theme value. Use the site's
  `--secondary` for interaction and `--gray`, `--lightgray`, `--darkgray`,
  `--highlight` for ink, rules and fills, so the figure follows the theme.

**Browser helpers** (`src/shared/dom.ts`):

- `lookup(figure)` returns `part(name)`, `input(name)`, `output(name)` and
  `button(name)`, which find `[data-part]`, `input[name]`, `output[name]` and
  `button[name]` inside the figure and throw if one is missing.
- `frameScheduler(draw)` returns `{ schedule, cancel }`; many input events
  become one redraw per frame.
- `enableControls(figure)` enables the inputs, buttons and selects that the
  build rendered disabled.
- `svgPoint(svg, event)` converts a pointer event to SVG coordinates.
- `instancePrefix(base)` gives ids, radio names and clip-path ids that stay
  unique when the figure appears twice on a page.
- `whenVisible(figure, onChange)` runs only while the figure is on screen and
  returns a cleanup.
- `prefersReducedMotion()`.

**Formatting and randomness** (`src/shared/format.ts`, `src/shared/random.ts`):

- `esc(text)` escapes text for HTML.
- `num(value, digits)` formats with a true minus sign.
- `mulberry32(seed)` is a small seeded generator, so a figure shows the same
  run on every page load and in its tests.
