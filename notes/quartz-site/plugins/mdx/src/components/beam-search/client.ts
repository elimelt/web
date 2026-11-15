// Browser side of the beam search figure. It fetches the recorded
// log-probabilities once the figure nears the viewport, then replays the
// search for whichever beam width and final score the reader picks.

import { enableControls, lookup } from "../../shared/dom";
import { prepare, type Data, type Prepared, type Scoring } from "./model";
import { beamTable, finishedTable, makeState, narration, stepLabel, type State } from "./view";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.bs");
  if (!figure) return () => {};
  const { part, output } = lookup(figure);
  const src = figure.dataset.src ?? "";
  let p: Prepared | undefined;
  let s: State | undefined;
  let k = Number(figure.dataset.k ?? 3);
  let scoring: Scoring = figure.dataset.scoring === "norm" ? "norm" : "raw";
  let alive = true;

  const press = (name: string, v: string) => {
    for (const b of figure.querySelectorAll<HTMLButtonElement>(`button[name="${name}"]`)) b.setAttribute("aria-pressed", String(b.value === v));
  };
  const draw = () => {
    if (!p || !s) return;
    part("narration").innerHTML = narration(p, s);
    part("beam").innerHTML = beamTable(p, s);
    part("finished").innerHTML = finishedTable(p, s);
    output("step").value = stepLabel(s);
    const n = s.run.steps.length;
    for (const name of ["first", "prev"]) figure.querySelector<HTMLButtonElement>(`button[name="${name}"]`)!.disabled = s.step === 0;
    for (const name of ["next", "last"]) figure.querySelector<HTMLButtonElement>(`button[name="${name}"]`)!.disabled = s.step === n;
  };

  const onClick = (e: Event) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!b || b.disabled || !figure.contains(b) || !p || !s) return;
    const n = s.run.steps.length;
    if (b.name === "k") {
      k = Number(b.value);
      s = makeState(p, k, scoring);
      press("k", b.value);
    } else if (b.name === "scoring") {
      scoring = b.value === "norm" ? "norm" : "raw";
      s.scoring = scoring;
      press("scoring", scoring);
    } else if (b.name === "first") s.step = 0;
    else if (b.name === "prev") s.step = Math.max(0, s.step - 1);
    else if (b.name === "next") s.step = Math.min(n, s.step + 1);
    else if (b.name === "last") s.step = n;
    else return;
    draw();
  };

  const start = async () => {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${src}: ${res.status}`);
      const data = (await res.json()) as Data;
      if (!alive) return;
      p = prepare(data);
      s = makeState(p, k, scoring);
      figure.addEventListener("click", onClick);
      enableControls(figure);
      draw();
    } catch (e) {
      part("narration").textContent = `Couldn't load the recorded log-probabilities (${String(e)}).`;
    }
  };

  // Fetch the data only once the figure is close to the viewport.
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((x) => x.isIntersecting)) {
        observer.disconnect();
        void start();
      }
    },
    { rootMargin: "400px" },
  );
  observer.observe(figure);

  return () => {
    alive = false;
    observer.disconnect();
    figure.removeEventListener("click", onClick);
  };
}
