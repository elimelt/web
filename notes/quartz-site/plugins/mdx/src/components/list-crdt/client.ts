// Browser side of the replicated-text figure. The page already holds the
// figure for its starting scenario; this enables the controls, runs the chosen
// list CRDT on every keystroke and redraws from the render functions.

import { enableControls, lookup } from "../../shared/dom";
import { act, edit, replay, scenarioSim, summary, type Algo, type ReplicaId, type Sim } from "./model";
import { flight, outbox, sequence, startAlgo, startScenario } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.lc");
  if (!figure) return () => {};
  const { part, input, button } = lookup(figure);
  const form = figure.querySelector<HTMLFormElement>("form.lc-controls")!;
  const algoSelect = form.querySelector<HTMLSelectElement>('select[name="algo"]')!;
  const scenarioSelect = form.querySelector<HTMLSelectElement>('select[name="scenario"]')!;
  const online = input("online");
  const ids = input("ids");
  const text = { A: input("textA"), B: input("textB") };

  // Back and forward navigation can restore earlier control values, so start
  // from what the controls say.
  const fresh = (): Sim => {
    const s = scenarioSim(startAlgo(algoSelect.value), startScenario(scenarioSelect.value));
    if (online.checked) {
      s.online = true;
      act(s, { sync: true });
    }
    return s;
  };
  let sim = fresh();

  const draw = () => {
    for (const r of ["A", "B"] as ReplicaId[]) {
      const value = sim.docs[r].text();
      // Leave the box being typed in alone, so the caret stays put.
      if (text[r].value !== value) text[r].value = value;
      part(`seq${r}`).innerHTML = sequence(sim, r);
      part(`out${r}`).textContent = outbox(sim, r);
    }
    part("flight").textContent = flight(sim);
    const sum = summary(sim);
    part("summary").textContent = sum.text;
    part("summary").dataset.tone = sum.tone;
    button("sync").disabled = sim.online || flight(sim) === "in sync";
    figure.classList.toggle("lc-show", ids.checked);
    figure.dataset.algo = sim.algo;
  };

  const onInput = (event: Event) => {
    const t = event.target as HTMLInputElement;
    const r = t === text.A ? "A" : t === text.B ? "B" : null;
    if (!r) return;
    edit(sim, r, t.value);
    // The CRDT may not hold exactly what the box shows (say, a paste over a
    // selection); the box follows the replica.
    draw();
  };

  const onChange = (event: Event) => {
    const t = event.target;
    if (t === algoSelect) sim = replay(algoSelect.value as Algo, sim.log, online.checked);
    else if (t === scenarioSelect) sim = fresh();
    else if (t === online) {
      sim.online = online.checked;
      if (online.checked) act(sim, { sync: true });
    }
    draw();
  };

  const onClick = (event: Event) => {
    const b = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.name === "sync") act(sim, { sync: true });
    else if (b.name === "reset") sim = fresh();
    draw();
  };
  const onSubmit = (event: Event) => event.preventDefault();

  figure.addEventListener("input", onInput);
  figure.addEventListener("change", onChange);
  figure.addEventListener("click", onClick);
  form.addEventListener("submit", onSubmit);
  enableControls(figure);
  draw();

  return () => {
    figure.removeEventListener("input", onInput);
    figure.removeEventListener("change", onChange);
    figure.removeEventListener("click", onClick);
    form.removeEventListener("submit", onSubmit);
  };
}
