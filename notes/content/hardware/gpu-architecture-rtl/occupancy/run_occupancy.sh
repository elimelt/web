#!/usr/bin/env bash
# Builds NVIDIA's occupancy calculator for the host CPU and writes
# occupancy_h100_reference.csv, then checks occupancy.py against it.
#   cd notes/content/hardware/gpu-architecture-rtl/occupancy && ./run_occupancy.sh
set -euo pipefail
cd "$(dirname "$0")"
T=$(mktemp -d)
python3 -m pip download --no-deps --quiet nvidia-cuda-runtime-cu12==12.8.90 -d "$T"
python3 -I -m zipfile -e "$T"/nvidia_cuda_runtime_cu12-12.8.90-*.whl "$T/whl"
g++ -O1 -std=c++17 -I "$T/whl/nvidia/cuda_runtime/include" occ_ref.cpp -o "$T/occ_ref"
"$T/occ_ref" > occupancy_h100_reference.csv
python3 -I occupancy.py occupancy_h100_reference.csv
