# Note style guide

Notes are written in a dry, precise, technical register, close to a textbook
or a survey article. They use the field's own vocabulary. A sentence that is
plain but exact is preferred to one that is vivid. These rules apply to every
note's prose and to its frontmatter `description`. `prose.yml` encodes the same
rules for scripts.

Each rule below gives a line that appeared in the notes and a rewrite.

## Structure

1. **No Purpose section.** A note opens with untitled paragraphs before its
   first heading. The first paragraph gives the formal definition of the
   subject. The next explains that definition in plain terms. Context or
   scope follows only when the reader needs it. The opening does not outline
   the note, since the headings do that.

2. **No self-reference.** The text does not discuss itself: no "this note",
   "this section" or "the experiments below show". To point at another
   section, link its heading.

   - Before: "Every policy in this note makes that decision from different
     information."
   - After: "Scheduling policies differ in the information available to them
     when they make this decision."

## Tone

3. **No theatrical framing.** No scene-setting openers and no dramatic
   vocabulary such as "forever", "ruins", "kills", "painful", "magic",
   "secretly" or "honestly".

   - Before: "One server, a queue of jobs, and one decision repeated forever:
     which job runs next."
   - After: "A single-server scheduling policy determines, whenever a job
     arrives or the server becomes free, which waiting job receives service."

4. **No human traits for jobs, systems or algorithms.** Programs do not want,
   know, care, refuse or suffer. Use the field's term: a policy is
   size-aware or size-oblivious; it does not "know" sizes.

   - Before: "Slowdown puts a 10 ms job and a 10 minute job on the same
     footing: waiting one second ruins the first and doesn't register for the
     second."
   - After: "Slowdown normalizes response time by service time, so jobs whose
     sizes differ by orders of magnitude can be compared on one scale."

5. **Precise terms over informal metaphor.** Avoid "buys", "pays for", "wins",
   "beats", "cheap", "the catch" and "the trick" where a precise term exists:
   cost, overhead, latency, throughput, outperforms by a stated amount.

   - Before: "In serving it buys three things."
   - After: "Quantization reduces serving cost in three ways."

6. **No aphorisms or landing lines.** A paragraph ends on its last substantive
   statement, not on a summary line written to sound memorable.

   - Before: "RR is a policy for 'nobody waits forever', not 'the average job
     finishes early.'"
   - After: "Round robin bounds how long any job waits before it first
     receives service, at the cost of a higher mean response time than SRPT."

## Claims

7. **No unqualified generalities.** Words such as "usual", "always",
   "standard", "best", "hard to beat" and "by a wide margin" need a condition,
   a scope, a number or a citation.

   - Before: "Mean response time is the usual objective."
   - After: "Mean response time is a reasonable objective, and the one SRPT
     minimizes. A high percentile of response time measures the tail
     instead."

8. **No evaluative lists.** Replace "Good:" and "Bad:" bullets and words like
   "terrible" with the property and the condition under which it holds.

   - Before: "Bad: terrible interactive latency under mixed workloads"
   - After: "Under a mix of short and long jobs, a short job that arrives
     behind a long one waits for the long job's entire service time (the
     convoy effect)."

## Sentences

9. **No signposting and no colon reveals.** State the content directly
   instead of announcing it.

   - Before: "The catch is cost. Six transistors per bit eat die area fast."
   - After: "Each SRAM bit requires six transistors, so SRAM occupies far more
     die area per bit than DRAM."

10. **No "X, not Y" or "not just X" constructions** unless the contrast is
    itself the claim.

11. **No em dashes.** Use commas, parentheses, semicolons or separate
    sentences.

12. **Complete declarative sentences.** No fragments for effect. Give
    quantities instead of "a lot" or "much".

13. **Person.** "We" is acceptable in derivations and proofs. "You" appears
    only in instructions for running code. "I" appears only for the author's
    own measurements, hardware or reading context.

14. **Descriptions follow the same rules.**

    - Before: "...and the derivations and traces that make their tradeoffs
      memorable."
    - After: "FIFO, SJF, SRPT, round robin, FB and MLFQ: the objective each
      optimizes, the optimality results, and their behavior on the Azure
      Functions trace."

## Exceptions

Quoted source text, theorem and definition language, code and commands keep
their original wording. Personal essays under `content/thoughts/` are written
in the author's own voice and are exempt from the tone rules.
