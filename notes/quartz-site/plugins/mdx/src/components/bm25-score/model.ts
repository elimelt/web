// BM25 over a recorded slice of the SciFact index: for one query, every
// document that contains at least one of its terms, with that document's
// length and the frequency of each query term in it. Documents that contain
// no query term score 0, so this slice is enough to rank the whole collection
// exactly. Scores use Lucene's BM25 (the form Pyserini and Elasticsearch use):
//   idf(t) = ln(1 + (N - df + 0.5) / (df + 0.5))
//   w(t,d) = idf(t) * tf / (tf + k1 * (1 - b + b * |d| / avgdl))
// summed over query terms (a term repeated in the query counts once per
// occurrence).

export interface Preset {
  /** The claim as written. */
  query: string;
  /** Analyzed query terms (lowercased, Lucene stop words removed, Snowball-stemmed), distinct. */
  terms: string[];
  /** A surface form of each term, for display. */
  words: string[];
  /** Occurrences of each term in the analyzed query. */
  qtf: number[];
  /** Document frequency of each term in the whole collection. */
  df: number[];
  /** Corpus ids of the documents in the slice, in corpus order. */
  ids: number[];
  /** For each document in the slice: [length in analyzed terms, tf of term 0, tf of term 1, ...]. */
  docs: number[][];
  /** Titles, keyed by slice index, for the documents the figure can show. */
  titles: Record<string, string>;
  /** Slice indices of the judged-relevant documents (-1 if a relevant document contains no query term). */
  rel: number[];
  /** Recorded from the dense model (all-MiniLM-L6-v2): rank of the best-ranked relevant document, and its cosine. */
  dense: { rank: number; cos: number };
}

export interface Data {
  N: number;
  avgdl: number;
  presets: Record<string, Preset>;
}

export interface Scored {
  /** Slice index. */
  i: number;
  score: number;
  /** Contribution of each query term. */
  parts: number[];
}

export const idf = (N: number, df: number): number => (df > 0 ? Math.log(1 + (N - df + 0.5) / (df + 0.5)) : 0);

export function scoreDoc(data: Data, p: Preset, i: number, k1: number, b: number): Scored {
  const d = p.docs[i];
  const norm = k1 * (1 - b + (b * d[0]) / data.avgdl);
  const parts = p.terms.map((_, j) => {
    const tf = d[j + 1];
    return tf > 0 ? (p.qtf[j] * idf(data.N, p.df[j]) * tf) / (tf + norm) : 0;
  });
  let score = 0;
  for (const x of parts) score += x;
  return { i, score, parts };
}

/**
 * Every document in the slice, best first. Ties keep corpus order, as a
 * stable sort of the whole collection would.
 */
export function rankAll(data: Data, p: Preset, k1: number, b: number): Scored[] {
  const out = p.docs.map((_, i) => scoreDoc(data, p, i, k1, b));
  out.sort((x, y) => y.score - x.score || x.i - y.i);
  return out;
}

/** 1-based rank of the best-ranked relevant document, or null if none contains a query term. */
export function relRank(p: Preset, ranked: Scored[]): number | null {
  const rel = new Set(p.rel.filter((x) => x >= 0));
  const r = ranked.findIndex((s) => rel.has(s.i));
  return r < 0 ? null : r + 1;
}
