// Browser side of the overload-lab figure: enables the controls, reruns the
// simulations when they change (the curve in slices, so the page stays
// responsive) and redraws the parts render() drew at build time.

import { enableControls, lookup } from "../../shared/dom";
import { simulate } from "./model";
import { CURVE_RATES, curveChart, detailRun, params, RATES, readout, timeChart, type State } from "./render";
import type { Result } from "./model";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.ovl");
  if (!figure) return () => {};
  const { part, input, output } = lookup(figure);
  const select = (name: string) => figure.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  const state: State = JSON.parse(figure.dataset.state ?? "{}");
  let curve: Result[] = [];
  let token = 0;
  const timers = new Set<number>();
  const later = (fn: () => void, ms = 0) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  const drawDetail = () => {
    const run = detailRun(state);
    part("time").innerHTML = timeChart(state, run);
    part("readout").innerHTML = readout(state, run);
  };

  const runCurve = (my: number) => {
    const snap = { ...state };
    const fresh: Result[] = [];
    const step = (i: number) => {
      if (my !== token) return;
      if (i === CURVE_RATES.length) return;
      fresh.push(simulate(params(snap, CURVE_RATES[i], 8), 1));
      curve = fresh;
      part("curve").innerHTML = curveChart(state, curve);
      later(() => step(i + 1));
    };
    step(0);
  };

  const onChange = (event: Event) => {
    const t = event.target as HTMLInputElement | HTMLSelectElement;
    if (!figure.contains(t)) return;
    if (t.name === "rate") {
      state.rate = RATES[Number(t.value)];
      output("rate-out").value = `${state.rate.toLocaleString("en-US")} req/s`;
      part("curve").innerHTML = curveChart(state, curve);
      const my = ++token;
      later(() => {
        if (my === token) drawDetail();
        // A rate change keeps the curve, which does not depend on the rate.
        if (my === token && curve.length < CURVE_RATES.length) runCurve(my);
      }, 60);
      return;
    }
    if (t.name === "policy") state.policy = t.value as State["policy"];
    else if (t.name === "retries") state.retries = Number(t.value);
    else if (t.name === "spike") {
      state.spike = t.value === "1";
      const my = ++token;
      later(() => {
        if (my !== token) return;
        drawDetail();
        // The spike does not change the curve, but this change may have
        // cancelled a curve run that a policy or retries change started.
        if (curve.length < CURVE_RATES.length) runCurve(my);
      }, 30);
      return;
    }
    else return;
    const my = ++token;
    curve = [];
    later(() => {
      if (my !== token) return;
      drawDetail();
      runCurve(my);
    }, 30);
  };

  // Keep the controls in step with the state if the browser restored old form values.
  select("policy").value = state.policy;
  select("retries").value = String(state.retries);
  select("spike").value = state.spike ? "1" : "0";
  input("rate").value = String(RATES.indexOf(state.rate));
  enableControls(figure);
  runCurve(++token);
  figure.addEventListener("input", onChange);
  figure.addEventListener("change", onChange);
  return () => {
    token++;
    for (const id of timers) window.clearTimeout(id);
    figure.removeEventListener("input", onChange);
    figure.removeEventListener("change", onChange);
  };
}
