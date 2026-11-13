// The build's entry for the low-rank image figure: the shared markup plus the
// photo's singular values from svd_experiments.py, for the static spectrum.

import fixture from "../../../../../../content/math/linear-algebra/svd/astronaut_256_singular_values.json";
import { render as renderWith } from "./render";

export const render = (props: { src?: string }): string => renderWith(props, fixture.singular_values);
