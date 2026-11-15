---
name: enhance-note
description: Improve one note on notes.elimelt.com by fact-checking it, running real experiments, adding one interactive figure that computes what it shows, rewriting the prose, and shipping it as a pull request with a preview.
---

# Enhance a note on notes.elimelt.com

This guide is for any agent or person working from a local checkout of this
repository. It needs only git, Node 22 or later, Python 3, and the GitHub CLI
(`gh`) for the pull request. Paths are relative to the repository root.

The notes site is a Quartz site under `notes/`. Notes live in
`notes/content/**` as `.md`, or as `.mdx` when they hold interactive figures.
Every pull request gets a preview: a bot comment links
`https://pr-N.elimelt-notes.pages.dev`, where N is the PR number.

The goal is a note a newcomer can learn from and an expert can use as a
reference: current, specific, and backed by sources or real measurements.

Read `notes/AGENTS.md` and `notes/README.md` first; they hold the authoring
rules this guide builds on. For figures, read
`notes/quartz-site/plugins/mdx/README.md`.

## 1. Read and fact-check first

- Read the note and the related notes it should link to.
- Check every existing claim against primary sources (papers, RFCs, standards,
  official docs, kernel or library source) before drafting anything.
- Expect wrong numbers, invented figures, and claims that only hold by
  accident (a tie, a special case, one input). Fix or remove each, and keep a
  list for the PR description.

## 2. Plan before building

Write a short plan covering:

- what is missing or out of date, and what deserves a collapsed deep dive or a
  separate linked note;
- which claims need an experiment, and a runtime budget for each, so nothing
  stalls the work at the end;
- one figure, the one idea it teaches that prose can't, and the paragraphs it
  will sit beside. Prefer stepping through a real algorithm or data structure,
  or simulating a real system the reader can poke at. No toy data and no
  decorative charts.

## 3. Run experiments, slowest first

- Start the longest experiment first and write while it runs.
- Use real data and real systems: real traces, datasets, kernels, models.
- Use several seeds or runs and report the spread or error bars.
- Commit the harness beside the note under `notes/content/` with exact run
  commands, and record method, hardware and versions in a collapsed section of
  the note (`> [!note]- How this was measured`).
- Before finishing, check every sentence that cites a number against the
  actual output. Never fill in a number you didn't measure.

## 4. Build the figure

Rename the note to `.mdx` if it isn't one, and add a component under
`notes/quartz-site/plugins/mdx/src/components/<name>/`. The plugin README
describes the files. In short: `component.ts` declares the tag, `render.ts`
returns the whole figure at build time, `client.ts` makes it interactive,
`model.ts` holds the logic, `style.scss` holds the styles. Nothing else needs
registering.

- **One idea per figure, simple to digest.** Give it only the controls that
  idea needs. A reader should see what it shows at a glance and need no
  instructions to use it. When the note makes several points with the same
  mechanism, place several small copies of the figure, each beside the
  paragraph it illustrates and opened on a preset scenario that matches that
  paragraph (pass the preset as an attribute, such as
  `<MyFigure preset="heavy-tail" />`), rather than one panel with every
  control and mode.
- **It computes what it shows.** Run the real algorithm or model in the
  browser, or replay recorded real data. Label simulations as simulations.
  Never fake behavior.
- **It is tested against an independent reference:** a closed form, a
  separate implementation (a Python script works well), the source model's
  outputs, or randomized property checks. Tests go in
  `notes/quartz-site/plugins/mdx/test/<name>.test.mjs`.
- **Reuse the shared toolkit** instead of writing your own frame, buttons,
  sliders, colors, scheduler, escaping or random generator. It is listed in the
  plugin README.
- **Design at two widths from the start:** the on-page width (about 630px) and
  phone width (360 to 400px). Use `@include fig-phone { ... }` for the phone
  layout. Text in a scaled SVG shrinks on a phone, so set its size again
  there.
- **Follow the theme.** Use the `--fig-*` series colors and the site's
  variables, never fixed colors for ink or backgrounds, and check light and
  dark.
- **Render the finished figure at build time** with its controls `disabled`,
  so nothing moves when the script arrives and the page works without it.
- **Watch the site's global styles.** Quartz wraps tables in the page's markup
  in `div.table-container`, so a table the script redraws looks different
  unless you use `fig-table`. Article checkboxes are styled as task-list items;
  use `fig-native-check`.
- **Make two copies on one page work.** Radio names and ids are page-global
  unless the radios sit inside a `<form>`; wrap them in a `<form>` per figure
  or use `instancePrefix`. Test a page with the figure twice.
- **MDX syntax.** A literal `<` followed by a letter in prose, such as `<SYN>`,
  is read as a tag and fails the build; write `&lt;SYN&gt;` or put it in code.
  A literal `{` needs `\{`. Attribute values must be literals.
- Keep any data file the page loads small, and load it only when the figure
  scrolls near the viewport.

## 5. Rewrite the prose

- Lead with intuition, then the precise definition and formulas.
- Keep it concrete. Cut generic filler, repetition, and phrasing that sounds
  machine-written.
- Use progressive disclosure: collapsed callouts (`> [!note]- Deep dive: ...`)
  for deep dives, and a separate linked note when an aside outgrows the page.
- Put sources inline, at the claim they support. Link related notes on the site
  where a concept branches, and cover recent work where it matters.
- Optionally, end the note with a collapsed section of ideas that came up
  while you researched it, such as an open question a paper raised or a
  variant the experiments hinted at but didn't test:

  ```md
  > [!note]- Potentially interesting ideas
  > - An idea, with a sentence on why it might be worth exploring and a link to
  >   whatever raised it.
  ```

  Write only ideas that actually came up during the work. Don't go looking for
  discoveries to fill the section. Phrase each one as an idea, not a result,
  and say what is unknown about it. Leave the section out when nothing came
  up.
- Keep the frontmatter to the rules in `notes/AGENTS.md` and
  `notes/.notes/frontmatter.yml`, including the `authors` rule.

## 6. Check locally

From the repository root:

```sh
# The figure's tests (after any change under the plugin's src/ or test/)
(cd notes/quartz-site/plugins/mdx && npm install && npm run build && npm test)

# The note's frontmatter and structure, then the full site
(cd notes && npm run validate:notes && npm run build)

# Serve the built site and open the page
(cd notes && npm run dev)
```

Open the page at desktop width and at phone width (a browser's device toolbar,
or a headless browser such as Playwright). Check that:

- the page has no horizontal scroll at phone width;
- the console shows no errors;
- every control does what its label says, in light and dark theme;
- the build-time figure and the hydrated figure look the same.

## 7. Ship it as a pull request

- Branch from the latest `main`
  (`git fetch origin main && git switch -c <branch> origin/main`).
- Touch only the note, its harness, its component and its test, plus any new
  notes. Generated files (`dist/`, `quartz-site/static/mdx/`) are built during
  the site build and are not committed.
- Never edit `.github/workflows`.
- Push and open the PR with `gh pr create`. In the description, open with a
  "Before:" paragraph and an "After:" paragraph, then list the facts you fixed
  and the measured results.
- Wait for CI to pass and for the preview comment, then confirm the preview
  serves the new page (`gh pr checks <N> --watch`, `gh pr view <N> --comments`).
  If your environment can't reach pages.dev, test the same build locally as in
  step 6 and say so.
- Don't merge unless the owner says to.

## Report

Keep it short:

- the PR link and the note's preview link;
- three to five bullets of what changed, with the real numbers;
- the facts that were fixed;
- what you'd do differently next time.
