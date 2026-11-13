// Components an .mdx note can use. Each one renders its full markup at build
// time; `module` names the browser script built from its client.ts, which the
// page loads only when the component is on it.

import { render as renderBenchmarkNoise } from "./benchmark-noise/render";
import { render as renderCnnExplorer } from "./cnn-explorer/server";
import { render as renderIntervalGreedy } from "./interval-greedy/render";

export interface Component {
  render: (props: Record<string, unknown>) => string;
  module: string;
}

export const components: Record<string, Component> = {
  BenchmarkNoise: { render: renderBenchmarkNoise, module: "benchmark-noise" },
  CnnExplorer: { render: renderCnnExplorer, module: "cnn-explorer" },
  IntervalGreedy: { render: renderIntervalGreedy, module: "interval-greedy" },
};
