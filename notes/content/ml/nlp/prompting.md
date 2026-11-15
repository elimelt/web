---
title: Prompting Language Models
aliases:
  - natural-language-processing/prompting
category: Natural Language Processing
tags:
  - language-models
  - prompting
  - nlp
  - llm
date: 2025-03-10
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Prompting techniques for language models, with small Python templates for few-shot prompting, retrieval-augmented generation, chain of thought, self-ask, and prompt self-improvement.
sources:
  - title: Brown et al. (2020), Language Models are Few-Shot Learners
    url: https://arxiv.org/abs/2005.14165
    type: paper
  - title: Wei et al. (2022), Chain-of-Thought Prompting Elicits Reasoning in Large Language Models
    url: https://arxiv.org/abs/2201.11903
    type: paper
  - title: Press et al. (2022), Measuring and Narrowing the Compositionality Gap in Language Models
    url: https://arxiv.org/abs/2210.03350
    type: paper
  - title: Lewis et al. (2020), Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks
    url: https://arxiv.org/abs/2005.11401
    type: paper
  - title: Liu et al. (2023), Lost in the Middle - How Language Models Use Long Contexts
    url: https://arxiv.org/abs/2307.03172
    type: paper
  - title: Madaan et al. (2023), Self-Refine - Iterative Refinement with Self-Feedback
    url: https://arxiv.org/abs/2303.17651
    type: paper
---

Prompting is the specification of a task to a pretrained language model through its input text, without any update to the model's parameters. A prompt can contain instructions, demonstrations of the task, retrieved documents or a request for intermediate reasoning.

Each pattern is given with a small Python template. Prompt behavior depends on how text is split into tokens, so [[ml/nlp/reading/tokenization|tokenization]] is useful background. Retrieval-augmented prompting builds on [[ml/nlp/reading/information-retrieval|information retrieval]].

## Basic concepts

The position of an instruction in the context affects how reliably the model follows it. Models use information at the start and end of a long context more reliably than information in the middle ([Liu et al. 2023](https://arxiv.org/abs/2307.03172)), so critical instructions are best placed near the end of the prompt, close to where generation begins.

> [!tip] Position and phrasing in long contexts
> The lost-in-the-middle effect is U-shaped; performance is highest when the relevant material is at the beginning or end of the context. An instruction that the model does not follow may be followed after it is moved, without any change to its wording.

The desired response format can be specified through examples or through explicit instructions. Specification by example is most effective with base models, which complete text patterns. Chat-tuned models follow explicit formatting instructions more reliably, since instruction tuning trains them to follow directions.

A persona instruction ("You are an expert radiologist") affects tone and domain vocabulary and acts as a soft prior on style.

Few-shot prompting demonstrates the desired input-output mapping with examples before the real query. Large models can perform a task from a few demonstrations without gradient updates ([Brown et al. 2020](https://arxiv.org/abs/2005.14165)).

```python
prompt = lambda persona, context, query: \
f"""<Persona>
{persona}
</Persona>

<Context>
{context}
</Context>

<Query>
{query}
</Query>

<Response>
"""
```

## Retrieval augmented generation

Retrieval-augmented generation retrieves documents relevant to the query and includes them in the prompt, so that the model answers from the provided evidence instead of parametric memory ([Lewis et al. 2020](https://arxiv.org/abs/2005.11401)). The retrieved documents ground the response and provide a reference against which its claims can be checked.

```python
def rag_prompt(
  query, retrieved_contexts=[],
  instruction="Answer based on the provided context."
):
    context_section = "\n\n".join([
      f"Context {i+1}:\n{context}"
      for i, context in enumerate(retrieved_contexts)
    ])

    return f"""Retrieved Information:
    {context_section}

    Question: {query}

    {instruction}"""
```

## Chain of thought

Chain-of-thought prompting asks the model to produce intermediate reasoning steps before the answer. Explicit intermediate reasoning improves accuracy on multi-step problems ([Wei et al. 2022](https://arxiv.org/abs/2201.11903)).

```python
def chain_of_thought_prompt(problem, steps_required=True):
    return f"""Problem: {problem}

{'Please think through this step-by-step and explain your reasoning for each step.' if steps_required else 'Solve this problem by showing your work.'}"""
```

## Self-ask

Self-ask prompting has the model decompose a compositional question into sub-questions, answer each in turn and combine the answers into the full answer. Press et al. ([2022](https://arxiv.org/abs/2210.03350)) introduced this format and showed that the sub-questions provide a natural point at which to insert search engine results.

```python
def self_ask_prompt(question, allow_search_queries=True):
    return f"""Question: {question}

To solve this problem, I'll break it down into smaller questions and answer them one by one.

{'''If you need to search for specific information, format search queries as [SEARCH: your query].''' if allow_search_queries else ''}

Let me think through this carefully:"""
```

## Self improvement

In prompt self-improvement, the model critiques a prompt given the output it produced and the goal that the output did not meet, and then generates a revised prompt. Iteration with model-generated feedback follows the same loop as Self-Refine ([Madaan et al. 2023](https://arxiv.org/abs/2303.17651)).

```python
def self_improvement_prompt(original_prompt, model_output, goal):
    return f"""Original Prompt:
\"{original_prompt}\"

Output Received:
\"{model_output}\"

Desired Goal:
\"{goal}\"

What are the weaknesses of the original prompt? How could it be improved to better achieve the desired goal?

After analyzing the weaknesses, provide an improved version of the prompt."""
```

## Related notes

- [[index|(not) Elijah's Notes]]

## Sources

- [Brown et al. (2020), Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165)
- [Wei et al. (2022), Chain-of-Thought Prompting Elicits Reasoning in Large Language Models](https://arxiv.org/abs/2201.11903)
- [Press et al. (2022), Measuring and Narrowing the Compositionality Gap in Language Models](https://arxiv.org/abs/2210.03350)
- [Lewis et al. (2020), Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401)
- [Liu et al. (2023), Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172)
- [Madaan et al. (2023), Self-Refine: Iterative Refinement with Self-Feedback](https://arxiv.org/abs/2303.17651)
