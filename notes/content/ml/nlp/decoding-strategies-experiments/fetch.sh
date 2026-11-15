#!/bin/sh
# Downloads the model and the test set into data/ and checks their SHA-256.
#   sh fetch.sh
set -eu
mkdir -p data
cd data
# OpenNMT-py's pretrained English-German Transformer-base (WMT, sentencepiece).
[ -f transformer-ende-wmt-pyOnmt.tar.gz ] || curl -fsSLO https://s3.amazonaws.com/opennmt-models/transformer-ende-wmt-pyOnmt.tar.gz
# newstest2021 English-German source and reference A, from the WMT21 system outputs repository.
base=https://raw.githubusercontent.com/wmt-conference/wmt21-news-systems/v1.3/txt
[ -f newstest2021.en-de.src.en ] || curl -fsSLO "$base/sources/newstest2021.en-de.src.en"
[ -f newstest2021.en-de.ref.A.de ] || curl -fsSLO "$base/references/newstest2021.en-de.ref.A.de"
sha256sum -c <<'SUMS'
45790c61c517bfc387a57de6b5958a36caf239a2142871500553934ced083c78  transformer-ende-wmt-pyOnmt.tar.gz
63925ded38b5354d19717df308d81274854f95ac2be5d94fd29b7b13c5dddcb7  newstest2021.en-de.src.en
3363b4a490bdcf55f3565bcc5dfadabaf3554f17cfb3540e25781e6bad67f854  newstest2021.en-de.ref.A.de
SUMS
tar xzf transformer-ende-wmt-pyOnmt.tar.gz
sha256sum -c <<'SUMS'
742be79f10c1c5ed960b4b04b551d6638aaf5845b81ab0be9b573df5fb8d6596  averaged-10-epoch.pt
d7603d84c37664a498fa269ba2e1e3a86b30a386da271a237b04a5928e39ef77  sentencepiece.model
SUMS
