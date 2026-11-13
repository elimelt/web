// Components an .mdx note can use. Each one renders its full markup at build
// time; `module` names the browser script built from its client.ts, which the
// page loads only when the component is on it.

import { render as renderBenchmarkNoise } from "./benchmark-noise/render";
import { render as renderCnnExplorer } from "./cnn-explorer/server";
import { render as renderClockDiagram } from "./clock-diagram/render";
import { render as renderSvdGeometry } from "./svd-geometry/render";
import { render as renderSvdImage } from "./svd-image/server";
import { render as renderSvdPinv } from "./svd-pinv/render";
import { render as renderQueueLab } from "./queue-lab/render";
import { render as renderPageReplacement } from "./page-replacement/render";
import { render as renderCommitSim } from "./commit-sim/render";
import { render as renderIntervalGreedy } from "./interval-greedy/render";
import { render as renderWindowSim } from "./window-sim/render";

export interface Component {
  render: (props: Record<string, unknown>) => string;
  module: string;
}

export const components: Record<string, Component> = {
  BenchmarkNoise: { render: renderBenchmarkNoise, module: "benchmark-noise" },
  CnnExplorer: { render: renderCnnExplorer, module: "cnn-explorer" },
  ClockDiagram: { render: renderClockDiagram, module: "clock-diagram" },
  SvdGeometry: { render: renderSvdGeometry, module: "svd-geometry" },
  SvdImage: { render: renderSvdImage, module: "svd-image" },
  SvdLeastSquares: { render: renderSvdPinv, module: "svd-pinv" },
  QueueLab: { render: renderQueueLab, module: "queue-lab" },
  PageReplacement: { render: renderPageReplacement, module: "page-replacement" },
  CommitSim: { render: renderCommitSim, module: "commit-sim" },
  IntervalGreedy: { render: renderIntervalGreedy, module: "interval-greedy" },
  WindowSim: { render: renderWindowSim, module: "window-sim" },
};
