// The build-time entry for the CNN explorer: the shared markup plus the
// node:zlib PNG encoder.

import { encodeMask } from "./png";
import { render as renderWith, type Props } from "./render";

export const tag = "CnnExplorer";
export const render = (props: Props): string => renderWith(props, encodeMask);
