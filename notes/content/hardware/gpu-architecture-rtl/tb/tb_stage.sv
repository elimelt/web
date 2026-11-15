// Testbench for valid_ready_stage (Model 4).
//
// A producer offers the sequence 0, 1, 2, ... with pseudo-random valid; a
// consumer takes items with pseudo-random ready. Checks: every item arrives
// exactly once and in order, out_data is stable while out_valid is high and
// not taken, and with both sides always ready the stage moves one item per
// cycle.
// Compile with -DORIGINAL to test ../original/issue_handshake.sv instead: its
// exec_valid is asserted in the transfer cycle while exec_op is registered
// and appears one cycle later, so a consumer that samples exec_op when
// exec_valid is high receives the previous op.
module tb_stage;
    logic clk = 1'b0, rst_n = 1'b0;
    always #5 clk = ~clk;

    function automatic logic [31:0] xs32(input logic [31:0] x);
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        return x;
    endfunction

    logic       in_valid = 1'b0, out_ready = 1'b0;
    logic [7:0] in_data = '0;
    logic       in_ready, out_valid;
    logic [7:0] out_data;

`ifdef ORIGINAL
    // issue_handshake: the scheduler is the producer; the transfer is exec_valid.
    issue_handshake #(.OPWIDTH(8)) dut (.clk, .rst_n, .sched_valid(in_valid), .sched_op(in_data),
        .sched_ready(in_ready), .exec_valid(out_valid), .exec_op(out_data));
`else
    valid_ready_stage #(.WIDTH(8)) dut (.clk, .rst_n, .in_valid, .in_ready, .in_data,
        .out_valid, .out_ready, .out_data);
`endif

    int sent, recv, order_err, stable_err, seed, cycles, mode;
    logic [31:0] rng;
    logic       prev_hold;
    logic [7:0] prev_data;

    initial begin
        if (!$value$plusargs("SEED=%d", seed)) seed = 1;
        if (!$value$plusargs("MODE=%d", mode)) mode = 0;   // 0 random, 1 always valid and ready
        rng = 32'hABCDEF ^ 32'(seed);
        sent = 0; recv = 0; order_err = 0; stable_err = 0; prev_hold = 1'b0;
        @(negedge clk); rst_n = 1'b1;
        for (cycles = 0; cycles < 4000; cycles++) begin
            rng = xs32(rng);
            in_valid  = (mode == 1) ? 1'b1 : rng[0];
            out_ready = (mode == 1) ? 1'b1 : (rng[5] | rng[6]);
            in_data   = 8'(sent);
            #1;
`ifdef ORIGINAL
            // the original has no consumer ready: every exec_valid is a delivery
            if (out_valid) begin
                if (out_data !== 8'(recv)) order_err++;
                recv++;
            end
`else
            if (prev_hold && (!out_valid || out_data !== prev_data)) stable_err++;
            if (out_valid && out_ready) begin
                if (out_data !== 8'(recv)) order_err++;
                recv++;
            end
            prev_hold = out_valid && !out_ready;
            prev_data = out_data;
`endif
            if (in_valid && in_ready) sent++;
            @(negedge clk);
        end
        $display("STAGE_RESULT mode=%0d seed=%0d sent=%0d received=%0d in_flight=%0d order_errors=%0d stability_errors=%0d",
                 mode, seed, sent, recv, sent - recv, order_err, stable_err);
        $finish;
    end
endmodule
