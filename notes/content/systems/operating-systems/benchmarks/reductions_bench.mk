CFLAGS = -O3 -march=native -Wall -Wextra
reductions_bench: reductions_bench.o reductions_kernels.o reductions_scalar.o reductions_clang.o
	gcc -O3 -o $@ $^ -lpthread
reductions_bench.o: reductions_bench.c
	gcc $(CFLAGS) -c $<
reductions_kernels.o: reductions_kernels.c
	gcc $(CFLAGS) -c $<
reductions_scalar.o: reductions_scalar.c
	gcc $(CFLAGS) -fno-tree-vectorize -c $<
reductions_clang.o: reductions_clang.c
	clang $(CFLAGS) -c $<
clean:
	rm -f *.o reductions_bench
