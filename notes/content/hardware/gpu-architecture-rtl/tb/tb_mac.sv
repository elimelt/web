// Testbench for pipelined_mac_chain (Model 3).
//
// Streams a new pseudo-random operand set into the chain on every cycle (with
// MODE=1, one set every DEPTH cycles with the operands held in between, which
// is how the original sketch testbench drove it) and checks that out_valid appears DEPTH cycles after in_valid and
// that acc_out equals the dot product of the operand set that entered then.
// Also runs against ../original/pipelined_mac_chain_drivers_fixed.sv, the
// original datapath with only its illegal drivers rewritten (Icarus rejects
// the original's continuous assignment to an element of an array that
// always_ff blocks also drive, and Verilator 5.020 rejects it with this
// testbench).
module tb_mac;
    localparam int WIDTH = 16, DEPTH = 4, AW = 2 * WIDTH + DEPTH, N = 2000;
    logic clk = 1'b0, rst_n = 1'b0;
    always #5 clk = ~clk;

    function automatic logic [31:0] xs32(input logic [31:0] x);
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        return x;
    endfunction

    logic                        in_valid = 1'b0, out_valid;
    logic [DEPTH-1:0][WIDTH-1:0] a = '0, b = '0;
    logic [AW-1:0]               acc_out;

    pipelined_mac_chain #(.WIDTH(WIDTH), .DEPTH(DEPTH)) dut (.*);

    logic [AW-1:0] expect_q [N + DEPTH + 1];
    logic          vexp_q   [N + DEPTH + 1];
    int seed, mode, checked, wrong, valid_err;
    logic [31:0] rng;
    logic [AW-1:0] dot;

    initial begin
        if (!$value$plusargs("SEED=%d", seed)) seed = 1;
        if (!$value$plusargs("MODE=%d", mode)) mode = 0;  // 0 stream every cycle, 1 one set per DEPTH cycles, operands held
        rng = 32'h5EED ^ 32'(seed);
        checked = 0; wrong = 0; valid_err = 0;
        for (int i = 0; i < N + DEPTH + 1; i++) begin expect_q[i] = '0; vexp_q[i] = 1'b0; end
        @(negedge clk); rst_n = 1'b1;
        for (int c = 0; c < N + DEPTH; c++) begin
            // cycle c: present inputs (they are captured at the next rising edge)
            if (c < N) begin
                in_valid = (mode == 0) ? 1'b1 : (c % DEPTH == 0);
                if (in_valid) begin              // MODE=1 holds operands between sets
                    dot = '0;
                    for (int s = 0; s < DEPTH; s++) begin
                        rng = xs32(rng); a[s] = rng[WIDTH-1:0];
                        rng = xs32(rng); b[s] = rng[WIDTH-1:0];
                        dot = dot + AW'(a[s]) * AW'(b[s]);
                    end
                end
                expect_q[c + DEPTH] = dot;
                vexp_q[c + DEPTH]   = in_valid;
            end else begin
                in_valid = 1'b0;
            end
            #1;
            if (out_valid !== vexp_q[c]) valid_err++;
            if (vexp_q[c]) begin
                checked++;
                if (acc_out !== expect_q[c]) wrong++;
            end
            @(negedge clk);
        end
        $display("MAC_RESULT mode=%0d seed=%0d checked=%0d wrong_sums=%0d valid_timing_errors=%0d",
                 mode, seed, checked, wrong, valid_err);
        $finish;
    end
endmodule
