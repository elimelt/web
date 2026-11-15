// Beam search replayed over next-token log-probabilities recorded from a real
// translation model (the OpenNMT-py Transformer-base English-German model) on
// one newstest2021 sentence. figure_data.py in the note's experiments
// directory stores, for every prefix the search expands at widths 1 to kmax,
// the 2*kmax most probable next tokens and the end-of-sentence log-probability;
// that is enough to replay the search exactly at any of those widths.

/** Vocabulary id 0 is the end-of-sentence token in the recorded data. */
export const EOS = 0;

export interface NodeData {
  parent: number;
  token: number;
  eos: number;
  next: [number, number][];
}

export interface Data {
  source: string;
  reference: string;
  line: number;
  kmax: number;
  max_len: number;
  vocab: string[];
  nodes: NodeData[];
}

/** A hypothesis: target tokens so far (vocabulary ids, without the start token) and its summed log-probability. */
export interface Hyp {
  tokens: number[];
  score: number;
}

export interface Step {
  /** The beam after this step's pruning. */
  kept: Hyp[];
  /** Candidates among the 2k best that were dropped (tokens include the dropped token, EOS included). */
  pruned: Hyp[];
  /** Hypotheses that ended at this step (tokens exclude EOS; the score includes it). */
  finished: Hyp[];
}

export interface Run {
  k: number;
  steps: Step[];
  finished: Hyp[];
}

export type Scoring = "raw" | "norm";

export interface Prepared {
  data: Data;
  /** Map from a comma-joined token prefix to its node. */
  byPrefix: Map<string, NodeData>;
}

export function prepare(data: Data): Prepared {
  const keys: string[] = [];
  data.nodes.forEach((n, i) => {
    keys[i] = n.parent < 0 ? "" : keys[n.parent] === "" ? String(n.token) : `${keys[n.parent]},${n.token}`;
  });
  const byPrefix = new Map<string, NodeData>();
  data.nodes.forEach((n, i) => byPrefix.set(keys[i], n));
  return { data, byPrefix };
}

/**
 * fairseq-style beam search. At each step every hypothesis in the beam is
 * extended by every stored token; the 2k best candidates are ranked by summed
 * log-probability. An end-of-sentence candidate among the k best finishes its
 * hypothesis; the k best other candidates form the next beam. The search stops
 * once k hypotheses have finished, or at the length limit, where every
 * hypothesis is closed with end-of-sentence. Ties go to the earlier beam
 * position, then to end-of-sentence, then to the more probable token.
 */
export function search(p: Prepared, k: number): Run {
  if (!(k >= 1 && k <= p.data.kmax)) throw new Error(`beam width ${k} outside 1..${p.data.kmax}`);
  let beam: Hyp[] = [{ tokens: [], score: 0 }];
  const steps: Step[] = [];
  const finished: Hyp[] = [];
  for (let t = 0; t < p.data.max_len; t++) {
    const ranked: { b: number; pos: number; tok: number; score: number }[] = [];
    beam.forEach((h, b) => {
      const node = p.byPrefix.get(h.tokens.join(","));
      if (!node) throw new Error(`no recorded distribution after [${h.tokens.join(",")}]`);
      ranked.push({ b, pos: 0, tok: EOS, score: h.score + node.eos });
      node.next.forEach(([tok, lp], i) => ranked.push({ b, pos: i + 1, tok, score: h.score + lp }));
    });
    ranked.sort((x, y) => y.score - x.score || x.b - y.b || x.pos - y.pos);
    if (t === p.data.max_len - 1) {
      const done = ranked.filter((c) => c.tok === EOS).map((c) => ({ tokens: beam[c.b].tokens, score: c.score }));
      finished.push(...done);
      steps.push({ kept: [], pruned: [], finished: done });
      break;
    }
    const step: Step = { kept: [], pruned: [], finished: [] };
    ranked.slice(0, 2 * k).forEach((c, rank) => {
      const h = beam[c.b];
      if (c.tok === EOS) {
        if (rank < k) step.finished.push({ tokens: h.tokens, score: c.score });
        else step.pruned.push({ tokens: [...h.tokens, EOS], score: c.score });
      } else if (step.kept.length < k) step.kept.push({ tokens: [...h.tokens, c.tok], score: c.score });
      else step.pruned.push({ tokens: [...h.tokens, c.tok], score: c.score });
    });
    finished.push(...step.finished);
    steps.push(step);
    if (finished.length >= k) break;
    beam = step.kept;
  }
  return { k, steps, finished };
}

/** Length counts the end-of-sentence token, so the empty translation has length 1. */
export const length = (h: Hyp): number => h.tokens.length + 1;

export const value = (h: Hyp, s: Scoring): number => (s === "raw" ? h.score : h.score / length(h));

/** Index of the best finished hypothesis under a scoring rule; ties go to the one that finished first. */
export function best(finished: Hyp[], s: Scoring): number {
  let bi = -1;
  finished.forEach((h, i) => {
    if (bi < 0 || value(h, s) > value(finished[bi], s)) bi = i;
  });
  return bi;
}

/** Sentencepiece pieces to text: pieces starting with U+2581 begin a new word. */
export function detok(vocab: string[], tokens: number[]): string {
  return tokens
    .map((t) => (t === EOS ? "</s>" : vocab[t]))
    .join("")
    .replace(/▁/g, " ")
    .replace(/<\/s>/g, " </s>")
    .trim();
}
