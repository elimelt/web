#!/bin/sh
# Downloads SciFact and the ONNX export of all-MiniLM-L6-v2 into ./data and
# ./models and checks their SHA-256.
set -eu
mkdir -p data models
curl -sSL -o data/scifact.tar.gz https://scifact.s3-us-west-2.amazonaws.com/release/latest/data.tar.gz
curl -sSL -o models/minilm.tar.gz https://chroma-onnx-models.s3.amazonaws.com/all-MiniLM-L6-v2/onnx.tar.gz
sha256sum -c <<SUMS
11c621288d41ac144d29b13b0f8503b3820b7d6e8b1f6ff24dff335c196d76be  data/scifact.tar.gz
913d7300ceae3b2dbc2c50d1de4baacab4be7b9380491c27fab7418616a16ec3  models/minilm.tar.gz
SUMS
mkdir -p data/scifact models/minilm
tar xzf data/scifact.tar.gz -C data/scifact
tar xzf models/minilm.tar.gz -C models/minilm
