// btrace: record every conditional branch a real x86-64 Linux program executes.
//
// The tracer runs the program under ptrace and single-steps it, one user-mode
// instruction at a time. At each stop it decodes the instruction at RIP; when
// that is a conditional jump (Jcc rel8, Jcc rel32, JRCXZ, LOOP/LOOPE/LOOPNE),
// it waits one step and compares the new RIP with the fall-through address to
// learn whether the branch was taken.
//
// Output: a binary file of little-endian uint64 records,
//     record = (pc << 2) | (backward << 1) | taken
// where backward means the branch target is below the branch's own address.
// A trailer line on stderr reports instruction and branch counts.
//
// Tracing starts at the program's ELF entry point (_start), so the dynamic
// loader's relocation work, which is the same for every program, is run at
// full speed and left out of the trace.
//
// Build:  cc -O2 -o btrace btrace.c
// Use:    ./btrace OUT.bin [-n MAX_INSNS] -- program args...
//
// Limits: user mode only (the kernel's branches are invisible), one thread
// (run programs in single-threaded mode), and slow: every instruction is a
// trap, about 20,000 instructions per second in the VM these traces came from.

#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ptrace.h>
#include <sys/uio.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

// A small direct-mapped cache of code pages, so decoding costs no syscall in
// the common case. Code is read-only, so cached bytes stay valid unless the
// program maps new code over an old address, which none of the traced
// programs do (no JIT).
#define PAGE 4096
#define CACHE_SLOTS 4096
static uint64_t slot_page[CACHE_SLOTS];
static uint8_t slot_data[CACHE_SLOTS][PAGE + 16];
static pid_t child;

// The program's entry point, from the auxiliary vector the kernel gave it.
static uint64_t entry_point(pid_t pid) {
  char path[64];
  snprintf(path, sizeof path, "/proc/%d/auxv", pid);
  FILE *f = fopen(path, "rb");
  if (!f) return 0;
  uint64_t kv[2], entry = 0;
  while (fread(kv, sizeof kv, 1, f) == 1) {
    if (kv[0] == 9 /* AT_ENTRY */) entry = kv[1];
    if (kv[0] == 0) break;
  }
  fclose(f);
  return entry;
}

static const uint8_t *code_at(uint64_t pc) {
  uint64_t page = pc & ~(uint64_t)(PAGE - 1);
  unsigned s = (unsigned)((page >> 12) % CACHE_SLOTS);
  if (slot_page[s] != page + 1) {
    // Read the page plus 16 bytes of the next one, so an instruction that
    // straddles a page boundary decodes in one piece. The tail read may fail
    // at the end of a mapping; zero it then.
    memset(slot_data[s], 0, sizeof slot_data[s]);
    struct iovec local = {slot_data[s], PAGE + 16};
    struct iovec remote = {(void *)page, PAGE + 16};
    if (process_vm_readv(child, &local, 1, &remote, 1, 0) < 0) {
      local.iov_len = PAGE;
      remote.iov_len = PAGE;
      if (process_vm_readv(child, &local, 1, &remote, 1, 0) < 0) return NULL;
    }
    slot_page[s] = page + 1;
  }
  return slot_data[s] + (pc - page);
}

// Returns the instruction length if the bytes at p are a conditional branch,
// and sets *target; returns 0 otherwise.
static int decode_cond(const uint8_t *p, uint64_t pc, uint64_t *target) {
  int i = 0;
  // Legacy prefixes that compilers emit in front of branches: segment
  // overrides used as static hints (2E, 3E), BND (F2), and operand or
  // address size (66, 67).
  while (i < 4 && (p[i] == 0x2E || p[i] == 0x3E || p[i] == 0xF2 || p[i] == 0xF3 || p[i] == 0x66 || p[i] == 0x67 ||
                   p[i] == 0x26 || p[i] == 0x36 || p[i] == 0x64 || p[i] == 0x65))
    i++;
  uint8_t op = p[i];
  if (op >= 0x70 && op <= 0x7F) {
    int len = i + 2;
    *target = pc + len + (int8_t)p[i + 1];
    return len;
  }
  if ((op >= 0xE0 && op <= 0xE3)) {  // LOOPNE, LOOPE, LOOP, JRCXZ
    int len = i + 2;
    *target = pc + len + (int8_t)p[i + 1];
    return len;
  }
  if (op == 0x0F && p[i + 1] >= 0x80 && p[i + 1] <= 0x8F) {
    int len = i + 6;
    int32_t rel;
    memcpy(&rel, p + i + 2, 4);
    *target = pc + len + (int64_t)rel;
    return len;
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 4) {
    fprintf(stderr, "usage: %s OUT.bin [-n MAX_INSNS] -- program args...\n", argv[0]);
    return 2;
  }
  const char *out = argv[1];
  uint64_t max_insns = UINT64_MAX;
  int a = 2;
  if (strcmp(argv[a], "-n") == 0) {
    max_insns = strtoull(argv[a + 1], NULL, 10);
    a += 2;
  }
  if (strcmp(argv[a], "--") != 0) {
    fprintf(stderr, "expected -- before the program\n");
    return 2;
  }
  a++;

  FILE *f = fopen(out, "wb");
  if (!f) {
    perror(out);
    return 1;
  }
  static uint64_t buf[1 << 16];
  size_t nbuf = 0;

  child = fork();
  if (child == 0) {
    ptrace(PTRACE_TRACEME, 0, 0, 0);
    execvp(argv[a], argv + a);
    perror("execvp");
    _exit(127);
  }
  int status;
  waitpid(child, &status, 0);  // stopped at exec
  ptrace(PTRACE_SETOPTIONS, child, 0, PTRACE_O_EXITKILL);

  // Run the dynamic loader at full speed: plant an int3 at the entry point,
  // continue, and restore the original byte when it traps.
  uint64_t entry = entry_point(child);
  if (entry) {
    errno = 0;
    long word = ptrace(PTRACE_PEEKTEXT, child, (void *)entry, 0);
    if (errno == 0) {
      ptrace(PTRACE_POKETEXT, child, (void *)entry, (void *)((word & ~0xFFL) | 0xCC));
      ptrace(PTRACE_CONT, child, 0, 0);
      waitpid(child, &status, 0);
      if (!WIFSTOPPED(status) || WSTOPSIG(status) != SIGTRAP) {
        fprintf(stderr, "did not reach the entry point\n");
        return 1;
      }
      ptrace(PTRACE_POKETEXT, child, (void *)entry, (void *)word);
      struct user_regs_struct r;
      ptrace(PTRACE_GETREGS, child, 0, &r);
      r.rip = entry;
      ptrace(PTRACE_SETREGS, child, 0, &r);
    }
  }

  uint64_t insns = 0, branches = 0, taken_n = 0, backward_n = 0, mismatches = 0;
  int pending = 0;  // the previous instruction was a conditional branch
  uint64_t p_pc = 0, p_len = 0, p_target = 0;
  int sig = 0;
  for (;;) {
    struct user_regs_struct regs;
    if (ptrace(PTRACE_GETREGS, child, 0, &regs) < 0) break;
    uint64_t pc = regs.rip;
    if (pending) {
      int taken = pc != p_pc + p_len;
      if (taken && pc != p_target) mismatches++;  // e.g. a signal handler ran in between
      uint64_t rec = (p_pc << 2) | ((uint64_t)(p_target < p_pc) << 1) | (uint64_t)taken;
      buf[nbuf++] = rec;
      if (nbuf == sizeof buf / sizeof buf[0]) {
        fwrite(buf, 8, nbuf, f);
        nbuf = 0;
      }
      branches++;
      taken_n += taken;
      backward_n += p_target < p_pc;
      pending = 0;
    }
    if (insns >= max_insns) {
      kill(child, SIGKILL);
      break;
    }
    const uint8_t *code = code_at(pc);
    if (code) {
      uint64_t target;
      int len = decode_cond(code, pc, &target);
      if (len) {
        pending = 1;
        p_pc = pc;
        p_len = len;
        p_target = target;
      }
    }
    insns++;
    if (ptrace(PTRACE_SINGLESTEP, child, 0, sig) < 0) break;
    sig = 0;
    if (waitpid(child, &status, 0) < 0) break;
    if (WIFEXITED(status) || WIFSIGNALED(status)) break;
    if (WIFSTOPPED(status) && WSTOPSIG(status) != SIGTRAP) {
      sig = WSTOPSIG(status);  // pass real signals through
      pending = 0;
    }
  }
  if (nbuf) fwrite(buf, 8, nbuf, f);
  fclose(f);
  fprintf(stderr, "insns=%llu cond_branches=%llu taken=%llu backward=%llu target_mismatch=%llu\n",
          (unsigned long long)insns, (unsigned long long)branches, (unsigned long long)taken_n,
          (unsigned long long)backward_n, (unsigned long long)mismatches);
  return 0;
}
