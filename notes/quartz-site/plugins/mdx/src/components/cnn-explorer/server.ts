// The build's entry for the CNN explorer: the shared markup plus the
// node:zlib PNG encoder.

import { encodeMask } from "./png";
import { render as renderWith, type Props } from "./render";

export const render = (props: Props): string => renderWith(props, encodeMask);
