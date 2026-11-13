// Browser side of the two-phase commit simulator. The page already holds the
// figure for its starting scenario; this enables the controls and redraws the
// parts from the same functions after every event. Back steps through a stack
// of earlier states, so any experiment can be undone.

import { apply, describeNext, linkKey, nextAction, scenarios, summarize, type Action, type NodeId, type PId, type Sim } from "./model";
import { cards, counts, flight, history, startScenario, svg } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.cs");
  if (!figure) return () => {};
  const form = figure.querySelector<HTMLFormElement>("form.cs-controls")!;
  const select = form.querySelector<HTMLSelectElement>('select[name="scenario"]')!;
  const coop = form.querySelector<HTMLInputElement>('input[name="cooperative"]')!;
  const button = (name: string) => figure.querySelector<HTMLButtonElement>(`.cs-bar button[name="${name}"]`)!;
  const part = (name: string) => figure.querySelector<HTMLElement>(`[data-part="${name}"]`)!;

  // Back and forward navigation can restore earlier control values, so start
  // from what the controls say.
  const fresh = (): Sim => {
    const s = scenarios[startScenario(select.value)].build();
    return coop.checked === s.cooperative ? s : apply(s, { type: "cooperative", on: coop.checked });
  };
  let stack: Sim[] = [fresh()];
  const cur = () => stack[stack.length - 1];

  const draw = () => {
    const s = cur();
    // Keep keyboard focus on the same control across a redraw.
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && figure.contains(active) ? focusId(active) : null;

    part("diagram").innerHTML = svg(s);
    part("nodes").innerHTML = cards(s);
    part("flight").innerHTML = flight(s);
    part("history").innerHTML = history(s);
    part("counts").innerHTML = counts(s);
    part("next").textContent = describeNext(s);
    const sum = summarize(s);
    part("headline").textContent = sum.headline;
    part("headline").dataset.tone = sum.tone;
    coop.checked = s.cooperative;

    for (const el of figure.querySelectorAll<HTMLButtonElement | HTMLInputElement>("[data-part] button, [data-part] input")) {
      el.disabled = el.hasAttribute("data-locked");
    }
    button("next").disabled = nextAction(s) === null;
    button("back").disabled = stack.length < 2;
    if (focusKey) {
      const el = figure.querySelector<HTMLElement>(focusKey);
      if (el && !(el as HTMLButtonElement).disabled) el.focus();
      else button("next").disabled ? button("back").focus() : button("next").focus();
    }
  };

  const focusId = (el: HTMLElement): string | null => {
    if (el.dataset.link) return `[data-link="${el.dataset.link}"]`;
    if (el.dataset.node) return `[data-node="${el.dataset.node}"]`;
    if (el.dataset.voteno) return `[data-voteno="${el.dataset.voteno}"]`;
    if (el.dataset.msg) return null; // that message is gone after it acts
    if (el.matches(".cs-bar button")) return `.cs-bar button[name="${(el as HTMLButtonElement).name}"]`;
    return null;
  };

  const act = (a: Action) => {
    const next = apply(cur(), a);
    if (next !== cur()) stack.push(next);
    if (stack.length > 400) stack = stack.slice(-400);
    draw();
  };

  const onClick = (event: Event) => {
    const target = event.target as Element;
    const bar = target.closest<HTMLButtonElement>(".cs-bar button");
    if (bar) {
      if (bar.name === "next") act({ type: "next" });
      else if (bar.name === "back" && stack.length > 1) {
        stack.pop();
        draw();
      } else if (bar.name === "reset") {
        stack = [fresh()];
        draw();
      }
      return;
    }
    const nodeBtn = target.closest<HTMLButtonElement>("button[data-node]");
    if (nodeBtn) {
      act({ type: nodeBtn.dataset.act === "crash" ? "crash" : "recover", node: nodeBtn.dataset.node as NodeId });
      return;
    }
    const msgBtn = target.closest<HTMLButtonElement>("button[data-msg]");
    if (msgBtn) {
      act({ type: msgBtn.dataset.act === "lose" ? "lose" : "deliver", id: Number(msgBtn.dataset.msg) });
      return;
    }
    const link = target.closest<SVGGElement>("[data-link]");
    if (link) toggleLink(link);
  };

  const toggleLink = (link: Element) => {
    const [a, b] = (link.getAttribute("data-link") ?? "").split("-") as NodeId[];
    if (a && b && linkKey(a, b)) act({ type: "cut", a, b });
  };

  const onKey = (event: KeyboardEvent) => {
    const link = (event.target as Element).closest?.("[data-link]");
    if (link && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      toggleLink(link);
    }
  };

  const onChange = (event: Event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target === select) {
      stack = [fresh()];
      draw();
    } else if (target === coop) act({ type: "cooperative", on: coop.checked });
    else if (target instanceof HTMLInputElement && target.dataset.voteno) {
      act({ type: "voteNo", node: target.dataset.voteno as PId, on: target.checked });
    }
  };
  const onSubmit = (event: Event) => event.preventDefault();

  figure.addEventListener("click", onClick);
  figure.addEventListener("keydown", onKey);
  figure.addEventListener("change", onChange);
  form.addEventListener("submit", onSubmit);
  select.disabled = false;
  coop.disabled = false;
  for (const b of figure.querySelectorAll<HTMLButtonElement>(".cs-bar button")) b.disabled = false;
  draw();

  return () => {
    figure.removeEventListener("click", onClick);
    figure.removeEventListener("keydown", onKey);
    figure.removeEventListener("change", onChange);
    form.removeEventListener("submit", onSubmit);
  };
}
