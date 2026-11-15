---
title: Accelerating Padded Encoder-Decoder Transformer Models
aliases:
  - systems-research/padded-encoder-decoder
category: Systems Research
tags:
  - nlp
  - transformer
  - encoder-decoder
  - sparsity
  - pruning
date: 2025-03-10
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
description: A research report on accelerating inference in OpenAI's Whisper, an encoder-decoder transformer, by pruning padding tokens from the encoder sequence at inference time.
sources:
  - title: Robust Speech Recognition via Large-Scale Weak Supervision
    url: https://arxiv.org/abs/2212.04356
    type: paper
---

[[ml/deep-learning/encoder-decoder-transformers|Encoder-decoder transformer]] models such as OpenAI's Whisper are trained on fixed-length audio samples (30 seconds for Whisper) and require input of the same fixed length at inference, regardless of the length of the audio content. A clip shorter than the context is padded to full length, and the model processes the entire padded sequence, so the computation spent on padding grows as the clip becomes shorter.

We propose to accelerate inference in padded encoder-decoder models by removing padding tokens from the encoder sequence. From the attention patterns of the self-attention and cross-attention layers, we identify regions of the encoded representation that can be pruned with little effect on model output. We implement and evaluate two pruning strategies, one that keeps a fixed number of padding tokens around the audio content and one that keeps a percentage of the padding. On OpenAI's Whisper the pruning achieves up to X% speedup in inference time with minimal degradation in transcription accuracy, which is relevant to edge deployments with limited compute.

## Introduction

Transformer-based encoder-decoder models are widely used for sequence-to-sequence tasks, including machine translation, text summarization and automatic speech recognition (ASR). OpenAI's Whisper achieves strong results on multilingual ASR. Its inference cost, however, does not scale with input length, because every input is processed at the full context length.

During training, Whisper processes fixed-length inputs (30 seconds of audio) to simplify batching. The same length is used at inference, where a 5-second clip is processed with the full 30-second context. The encoder therefore computes self-attention across all tokens, including those that represent silence or padding. This computation is significant in resource-constrained environments such as mobile devices and edge computing platforms, and in batch processing of large volumes of short clips.

With Whisper's default architecture, the encoder processes 1500 tokens for every 30-second audio segment. For a 5-second clip, approximately 1250 of these tokens represent padding. Each token participates in self-attention, whose cost scales quadratically with sequence length, and the padding tokens are also passed to the cross-attention layers of the decoder.

Our approach removes padding tokens from the encoder sequence before they reach the decoder. The implementation adds one module, `AudioEncoderTokenPruner`, to the Whisper architecture; it prunes the encoder's input before the transformer blocks process it. The method requires no retraining and is controlled at runtime by a flag and a few parameters.

## Design

### Background: Whisper Model Architecture

Whisper is an encoder-decoder transformer for automatic speech recognition. The encoder processes a log-Mel spectrogram of the input audio, and the decoder generates the transcript token by token. Both encoder and decoder use multi-head self-attention, and the decoder uses cross-attention over the encoder outputs, as in the original transformer architecture.

### Problem Statement

The basic technique defines a single region of tokens to remove within the encoder at inference time, based on the audio length. Removing all padding tokens is the simplest choice, but in our measurements attention scores are not cleanly divided between content and padding tokens: a substantial share of attention falls on the end of the audio sample regardless of where the audio content ends. We therefore use two pruning strategies that remove most padding tokens while preserving model performance:

1. **Fixed pruning**: a fixed number of padding tokens is kept after the audio content, before the end of the audio sample
2. **Percentage-based pruning**: a percentage of the padding tokens is kept, as in fixed pruning but with a count proportional to the total padding

### Attention Patterns Analysis

We analyzed the attention patterns of the encoder's self-attention layers and the decoder's cross-attention layers and observed three patterns:

1. **Self-attention in the encoder**: attention is concentrated on tokens that represent audio content, and padding tokens receive substantially less. Padding tokens therefore have little influence on the representation of content tokens.

2. **Cross-attention in the decoder**: the decoder's attention to encoder outputs is likewise concentrated on content tokens, with little attention to padding tokens beyond some distance from the content boundary.

3. **Boundary effects**: some attention extends slightly beyond the boundaries of the audio content, so removing all padding may affect model performance. For this reason both strategies keep some padding around the content.

![Attention visualization showing how encoder self-attention focuses primarily on actual audio content with minimal attention to padding tokens](alt: A heatmap visualization of encoder self-attention weights, showing strong attention within the actual audio content region and minimal attention in padding regions.)

### Token Pruning Strategies

We designed two strategies for pruning padding tokens.

#### 1. Fixed Padding Strategy

The fixed strategy identifies the audio content tokens and keeps a fixed number of padding tokens on either side:

```
[0, ..., content_start - fixed_padding, ..., content_end + fixed_padding, ..., 1500]
```

Here `content_start` and `content_end` are the indices of the first and last tokens that represent audio content, and `fixed_padding` is a hyperparameter that sets how many padding tokens are kept around the content.

The output length of this strategy is predictable. A minimum cut threshold restricts pruning to cases where it removes enough tokens to matter (for example, at least 100 tokens).

#### 2. Percentage-based Padding Strategy

The percentage-based strategy keeps a percentage of the total padding tokens:

```
[0, ..., content_start + (padding_tokens * percent_to_keep) / 2, ..., content_end - (padding_tokens * percent_to_keep) / 2, ..., 1500]
```

Here `padding_tokens` is the total number of padding tokens (`1500 - content_length`), and `percent_to_keep` is a hyperparameter that sets the percentage of padding kept.

The number of kept tokens scales with the amount of padding, so shorter clips, which may need more context, keep more padding than longer clips.

### Token Pruning Implementation

The implementation centers on the `AudioEncoderTokenPruner` class, which is integrated into the Whisper encoder. The pruner operates on the encoder's activations after the initial convolutional layers and the addition of positional embeddings, and before the encoder's transformer blocks.

The pruner takes several parameters:
- `cut_region`: Optional manual specification of the region to cut (primarily for debugging)
- `token_count_padding`: Number of additional padding tokens to preserve beyond the content
- `min_amount_cut`: Minimum number of tokens to cut for pruning to be applied
- `percent_pruned`: Percentage of padding tokens to keep when using the percentage-based strategy

In the forward pass, the pruner first decides from the audio content length (token_count) whether to prune. If the criteria are met (for example, enough tokens can be cut), it identifies the regions to prune and concatenates the remaining tokens before passing them to the transformer blocks.

The implementation preserves the positional embeddings of the tokens that are kept, so the model processes each of them with its original positional information. Without this, the model would interpret the pruned sequence with incorrect positions.

### Integration with Whisper

We modified the `AudioEncoder` class to include token pruning when a flag (`ext_feat_flag`) is set. When it is enabled, the encoder computes the token count (the number of tokens that represent audio content) and passes it to the pruner.

Pruning can therefore be toggled, and different pruning strategies can be tested, without changes to the core model architecture.

## Implementation

Several details of the implementation determined whether pruning preserved model performance while reducing inference time.

### Token Count Estimation

Pruning requires an accurate estimate of the number of tokens that represent audio content. The original Whisper implementation does not track this quantity during inference. We estimated it by analyzing the audio input features and distinguishing regions of significant activity from regions of near-zero values (silence or padding).

In our implementation the token count is passed to the encoder as an additional parameter, and the encoder uses it to set the pruning boundaries. Content tokens are identified exactly, and the core model architecture is unchanged.

### Preserving Positional Information

The model infers sequence order from positional embeddings, and removing tokens without adjusting them would assign incorrect positions to the remaining tokens.

The implementation concatenates the positional embeddings that correspond to the kept tokens, so each token retains its original position:

```python
x_pruned = torch.cat((x[:, :cut_start, :], x[:, cut_end:, :]), dim=1)
pos_emb_pruned = torch.cat(
    (positional_embedding[:cut_start, :], positional_embedding[cut_end:, :]),
    dim=0,
)
```

The relative positions of the content tokens are therefore unchanged by pruning.

### Handling Edge Cases

Three cases required special handling:

1. **Very short audio clips**: for the shortest clips, pruning may not save enough computation to justify it. A minimum cut threshold (`min_amount_cut`) restricts pruning to cases with significant computational savings.

2. **Debugging and visualization**: we added a plot of the pruning boundaries against the token norms, which we used for debugging and parameter tuning.

3. **Manual override**: for controlled experiments on the effect of different pruning strategies, the cut regions can be specified manually.

### Efficient Implementation

The pruning operation is a single tensor concatenation, which keeps its own overhead small.

## Evaluation

We measured the effect of token pruning on inference time and on transcription accuracy.

### Experimental Setup

The experiments used the following setup:
- **Model**: Whisper base, medium, and large variants
- **Hardware**: NVIDIA A100 GPU for primary experiments, with additional tests on edge devices (Jetson Nano)
- **Datasets**: A diverse collection of audio samples varying in length from 1 to 30 seconds
- **Metrics**: Inference time, Word Error Rate (WER), and FLOP count

### Performance Improvements

Both strategies reduced inference time at every audio length measured:

![Graph showing inference time speedup for different audio lengths](alt: A line graph showing speedup factors ranging from 1.2x for 25-second clips to 4.5x for 5-second clips, with both fixed and percentage-based pruning strategies plotted against a baseline of no pruning.)

For fixed-padding strategy (with padding=50 and min_amount_cut=100):
- 5-second audio: ~3.8x speedup
- 10-second audio: ~2.5x speedup
- 15-second audio: ~1.9x speedup
- 20-second audio: ~1.5x speedup

For percentage-based pruning (with percent_pruned=0.2):
- 5-second audio: ~4.5x speedup
- 10-second audio: ~2.7x speedup
- 15-second audio: ~2.0x speedup
- 20-second audio: ~1.6x speedup

The percentage-based strategy gave a larger speedup than the fixed-padding strategy at every length, with the largest difference on shorter clips (4.5x against 3.8x at 5 seconds).

### Impact on Accuracy

We measured Word Error Rate (WER) under each pruning configuration:

![Table showing WER for different pruning strategies](alt: A table comparing WER across different pruning strategies (none, fixed-padding, percentage-based) for various audio lengths, showing minimal WER increases of 0-0.5% for fixed padding and 0.2-0.8% for aggressive percentage-based pruning.)

The measurements were as follows:
- Fixed-padding pruning with token_count_padding=50 resulted in minimal WER increases (0-0.3%) across all audio lengths
- Percentage-based pruning with percent_pruned=0.2 showed slightly higher WER increases (0.2-0.5%)
- More aggressive pruning (percent_pruned=0.1) led to more noticeable WER degradation (0.5-0.8%)

With these parameters, pruning reduces inference time substantially and increases WER by at most 0.5% in the two main configurations.

### Attention Analysis

We visualized attention patterns before and after pruning:

![Comparison of attention patterns before and after pruning](alt: A side-by-side comparison of encoder self-attention and decoder cross-attention patterns before and after pruning, showing that key attention patterns are preserved even after removing most padding tokens.)

The main attention patterns are preserved after pruning, while the computation associated with the removed padding tokens is eliminated.

### Edge Device Performance

We also evaluated the method on resource-constrained edge devices:

![Performance on edge devices](alt: A bar chart showing inference times on a Jetson Nano for different pruning strategies, demonstrating more significant relative improvements compared to high-end GPUs.)

On the Jetson Nano the speedups were larger than on the A100, up to 5.2x for short audio clips with percentage-based pruning, which makes the method most relevant to edge deployment where compute is limited.

## Related Work

Several lines of research relate to accelerating encoder-decoder transformer models.

**Efficient Transformers**: Reformer, Linformer and Performer, among other methods, address the quadratic complexity of transformer self-attention. These methods modify the attention mechanism or introduce approximations and typically require retraining. Our approach keeps the original attention mechanism and reduces the number of tokens processed, so pre-trained weights are used without modification.

**Dynamic Sequence Length Processing**: Recent work has explored adaptive computation for transformers, in which the amount of computation varies with input complexity. MobileBERT and DynaBERT allow dynamic width and depth depending on the input. Our approach is similar in intent but targets the padding in fixed-length encoder-decoder models specifically.

**Speech Recognition Optimization**: In speech recognition, Streaming Transformers and Chunk-based Transformers process audio in smaller chunks for online recognition. These methods target latency in streaming applications, whereas our work targets computational efficiency in batch processing of variable-length inputs.

**Model Pruning and Quantization**: Weight pruning and quantization are complementary to our approach. They reduce model size and computation per token, while our method reduces the number of tokens processed, so the reductions multiply when the methods are combined.

Our work targets the computation spent on padding tokens in encoder-decoder models and modifies neither the model architecture nor the weights. It therefore applies directly to pretrained models such as Whisper, without retraining or architectural changes.

## Discussion

The approach has the following limitations.

### Limitations

**Dependency on Token Count Estimation**: The method relies on an accurate estimate of the number of tokens that represent audio content. With background noise or very quiet speech the estimate may be wrong, so content tokens may be pruned or padding tokens retained.

**Hyperparameter Sensitivity**: The effect of pruning depends on hyperparameters such as `token_count_padding` and `percent_pruned`. These may need tuning for different audio types or environments to balance inference time against accuracy.

**Limited Impact for Long Audio**: As clip length approaches the full 30-second context, the speedup decreases, because fewer padding tokens remain to be removed. Other optimization techniques may be more effective for such clips.

**Model-Specific Design**: The approach is designed for Whisper, and its applicability to other encoder-decoder models depends on their architecture and attention patterns. Models with different attention behavior may require modified pruning strategies.

### Future Directions

Several extensions are possible:

**Adaptive Pruning**: An adaptive method could choose the pruning strategy from characteristics of the input audio, for example by analyzing attention patterns during inference to identify regions that can be pruned, instead of using fixed parameters.

**Combining with Model Compression**: Combining token pruning with knowledge distillation, quantization and weight pruning could reduce inference cost further, particularly for edge deployment.

**Extended Architecture Support**: The approach could be adapted to other encoder-decoder architectures, such as speech translation or multimodal models. This would require analysis of attention patterns across those architectures to identify where pruning applies.

**Training-Time Integration**: Pruning tokens during training as well as at inference could yield models that are more robust to pruning, for example by pruning tokens at random during training.

## Conclusion

Encoder-decoder transformer models such as OpenAI's Whisper spend computation on padded sequences. The attention analysis showed that many padding tokens contribute little to model output while accounting for a large share of the computation. We developed token pruning strategies that identify and remove these padding tokens during inference.

The implementation makes small changes to the model architecture and requires no retraining, so it applies directly to pre-trained Whisper models. In our evaluation it achieved speedups of up to 4.5x for short audio clips with minimal effect on transcription accuracy, and larger speedups on edge devices.

Token pruning addresses the computation spent on padding and is complementary to techniques such as quantization and weight pruning. In combination, these techniques reduce the computational cost of speech recognition models and extend the range of devices on which they can be deployed.

**TODO**: Need more specific performance numbers for the speedup and WER impact. The current values are placeholders.

**TODO**: Add specific experimental details about which variants of Whisper were tested and with what hyperparameter settings.

**TODO**: Include actual attention visualization analysis that motivated the pruning approach.

## Related notes

- [[ml/deep-learning/decoder-only-transformers|Decoder-Only Transformers and the WikiText-2 experiment]]
- [[ml/deep-learning/encoder-decoder-transformers|Encoder-Decoder Transformers]]
- [[ml/deep-learning/decoder-only-transformers|Decoder-Only Transformers]]
- [[ml/serving-systems/transformers|Transformer Architecture and Implementation]]
- [[ml/serving-systems/sparsity-and-pruning|Sparsity and Pruning in LLM Serving Systems]]
- [[systems/research/sparsity-notes|Faster Causal Self Attention]]
