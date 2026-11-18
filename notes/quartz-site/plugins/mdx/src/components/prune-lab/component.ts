// The build-time entry for the pruning figure: one real T5 layer pruned live
// by magnitude or by Wanda's activation-weighted score.

export const tag = "PruneLab";
export { render } from "./render";
