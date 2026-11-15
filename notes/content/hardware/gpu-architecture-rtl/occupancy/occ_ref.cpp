// Prints NVIDIA's own occupancy calculation (cuda_occupancy.h from the CUDA
// runtime, compiled for the host CPU, no GPU needed) for a grid of launch
// configurations on an H100 SXM (compute capability 9.0, 132 SMs) as CSV.
// The header is not redistributed here; run_occupancy.sh downloads it.
//
// Device properties are the documented compute capability 9.0 limits:
// 1024 threads per block, 2048 threads (64 warps) per SM, 64K 32-bit registers
// per SM and per block, 228 KB shared memory per SM, 227 KB per block (opt-in),
// 48 KB per block without opt-in, 1 KB reserved per block.
#include <cstdio>
#include "cuda_occupancy.h"

int main() {
    cudaOccDeviceProp p;
    p.computeMajor = 9;
    p.computeMinor = 0;
    p.maxThreadsPerBlock = 1024;
    p.maxThreadsPerMultiprocessor = 2048;
    p.regsPerBlock = 65536;
    p.regsPerMultiprocessor = 65536;
    p.warpSize = 32;
    p.sharedMemPerBlock = 48 * 1024;
    p.sharedMemPerMultiprocessor = 228 * 1024;
    p.numSms = 132;
    p.sharedMemPerBlockOptin = 227 * 1024;
    p.reservedSharedMemPerBlock = 1024;

    cudaOccDeviceState s;                 // default carveout preference
    const int threads[] = {32, 64, 96, 128, 160, 192, 256, 320, 384, 512, 640, 768, 1024};
    const int regs[] = {16, 24, 32, 40, 48, 56, 64, 72, 80, 96, 112, 128, 144, 168, 192, 224, 255};
    const int smem_kb[] = {0, 1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 72, 80, 96,
                           100, 112, 128, 144, 160, 192, 200, 226, 227};
    std::printf("threads,regs,smem_bytes,blocks,warps,limit_warps,limit_regs,limit_smem,limit_blocks\n");
    for (int t : threads)
        for (int r : regs)
            for (int kb : smem_kb) {
                cudaOccFuncAttributes a;
                a.maxThreadsPerBlock = 1024;
                a.numRegs = r;
                a.sharedSizeBytes = 0;
                a.partitionedGCConfig = PARTITIONED_GC_OFF;
                a.shmemLimitConfig = FUNC_SHMEM_LIMIT_OPTIN;
                a.maxDynamicSharedSizeBytes = 227 * 1024;
                a.numBlockBarriers = 1;
                cudaOccResult res;
                size_t dyn = (size_t)kb * 1024;
                cudaOccError e = cudaOccMaxActiveBlocksPerMultiprocessor(&res, &p, &a, &s, t, dyn);
                if (e != CUDA_OCC_SUCCESS) { std::printf("error,%d,%d,%d,%d\n", t, r, kb, (int)e); continue; }
                int b = res.activeBlocksPerMultiprocessor;
                std::printf("%d,%d,%zu,%d,%d,%d,%d,%d,%d\n", t, r, dyn, b, b * ((t + 31) / 32),
                            res.blockLimitWarps, res.blockLimitRegs, res.blockLimitSharedMem,
                            res.blockLimitBlocks);
            }
    return 0;
}
