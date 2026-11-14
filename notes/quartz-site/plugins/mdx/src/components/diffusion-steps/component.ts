// The build-time entry for the diffusion figure: the shared markup plus the
// held-out data points that diffusion2d.py exported, so the forward process
// can be drawn at build time without the network.

import eight from "../../../../../../content/ml/deep-learning/diffusion-2d/points-eight.json";
import moons from "../../../../../../content/ml/deep-learning/diffusion-2d/points-moons.json";
import spiral from "../../../../../../content/ml/deep-learning/diffusion-2d/points-spiral.json";
import { render as renderWith, type Props } from "./render";

export const tag = "DiffusionSteps";
const points: Record<string, number[][]> = { moons: moons.points, eight: eight.points, spiral: spiral.points };
export const render = (props: Props): string => renderWith(props, points);
