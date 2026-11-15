---
title: Serving Systems
category: Machine Learning Systems
tags:
  - llm serving
  - inference
  - gpu
  - batching
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Index of the model-serving notes, on inference bottlenecks, GPU behavior and the optimization of large models.
sources:
  - title: "LoRA: Low-Rank Adaptation of Large Language Models"
    url: https://arxiv.org/abs/2106.09685
    type: paper
  - title: "Megatron-LM: Training Multi-Billion Parameter Language Models Using Model Parallelism"
    url: https://arxiv.org/abs/1909.08053
    type: paper
  - title: CUDA C++ Programming Guide
    url: https://docs.nvidia.com/cuda/cuda-c-programming-guide/
    type: docs
---

Model serving systems execute trained models, large language models in particular, on GPU hardware under latency and throughput objectives. Their analysis concerns where execution time and memory are spent and which optimization changes the binding bottleneck. [[ml/serving-systems/gpu-basics|GPU basics]] and [[ml/serving-systems/performance-modeling|performance modeling]] supply the hardware model and the bottleneck analysis on which the later optimization notes rely.

The remaining notes fall into several groups. [[ml/serving-systems/batching|Batching]], [[ml/serving-systems/parallelism|parallelism]], [[ml/serving-systems/gpu-interconnects|GPU interconnects]], and [[ml/serving-systems/memory-management|memory management]] concern system design. [[ml/serving-systems/optimizing-gpu-kernels|Optimizing GPU kernels]], [[ml/serving-systems/triton|Triton]], and [[ml/serving-systems/how-to-write-a-fast-kernel|how to write a fast kernel]] concern implementation. [[ml/serving-systems/transformers|Transformers]] and [[ml/serving-systems/speculative-decoding|speculative decoding]] relate the systems work to model structure. [[ml/serving-systems/peft-and-preference-optimization|PEFT and preference optimization]] covers adaptation, the fine-tuning and preference tuning of a base model with a small fraction of its parameters trained, and the serving of the resulting adapters.

## Entry points

- Foundations: [[ml/serving-systems/gpu-basics|GPU basics]], [[ml/serving-systems/performance-modeling|performance modeling]], [[ml/serving-systems/roofline-reference|roofline reference]]
- Scheduling and memory: [[ml/serving-systems/batching|batching]], [[ml/serving-systems/memory-management|memory management]], [[ml/serving-systems/parallelism|parallelism]], [[ml/serving-systems/gpu-interconnects|GPU interconnects]]
- Kernel work: [[ml/serving-systems/optimizing-gpu-kernels|optimizing GPU kernels]], [[ml/serving-systems/triton|Triton]], [[ml/serving-systems/how-to-write-a-fast-kernel|how to write a fast kernel]]
- Model-specific techniques: [[ml/serving-systems/transformers|transformers]], [[ml/serving-systems/quantization|quantization]], [[ml/serving-systems/speculative-decoding|speculative decoding]], [[ml/serving-systems/sparsity-and-pruning|sparsity and pruning]]
- Fine-tuning and adaptation: [[ml/serving-systems/peft-and-preference-optimization|PEFT and preference optimization]]
- Distributed training: [[ml/serving-systems/distributed-training|distributed training of LLMs]], [[ml/serving-systems/distributed-ml-runtimes|distributed ML runtime architecture]], [[ml/serving-systems/mixture-of-experts|mixture of experts]]
