// Testbench for warp_issue_arbiter (Model 1).
//
// 1. For every non-empty ready mask, hold the mask for 48 cycles and count the
//    grants per warp. A round-robin arbiter gives every ready warp the same
//    share (48 / popcount, within one grant).
// 2. Drive 20,000 cycles of pseudo-random ready masks and random accept, and
//    compare each grant against a reference round-robin model.
// Compile with -DORIGINAL to test ../original/warp_issue_arbiter.sv, which has
// no issue_accept or grant_idx port (accept is then always 1).
module tb_arbiter;
    localparam int NW = 4;
    logic clk = 1'b0, rst_n = 1'b0;
    always #5 clk = ~clk;

    logic [NW-1:0] warp_ready = '0, warp_grant;
    logic          issue_valid, issue_accept = 1'b1;
    logic [1:0]    grant_idx;

`ifdef ORIGINAL
    warp_issue_arbiter #(.NUM_WARPS(NW)) dut (.clk, .rst_n, .warp_ready, .warp_grant, .issue_valid);
`else
    warp_issue_arbiter #(.NUM_WARPS(NW)) dut (.clk, .rst_n, .warp_ready, .issue_accept,
                                              .warp_grant, .grant_idx, .issue_valid);
`endif

    function automatic logic [31:0] xs32(input logic [31:0] x);
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        return x;
    endfunction

    int counts [NW];
    int ref_ptr, ref_g, worst_num, worst_den, mismatches, onehot_err, seed, pop, lo, hi;
    logic [31:0] rng;
    logic [NW-1:0] exp_grant;
    string line;

    initial begin
        if (!$value$plusargs("SEED=%d", seed)) seed = 1;
        rng = 32'h1234567 ^ 32'(seed);
        worst_num = 1; worst_den = 1; mismatches = 0; onehot_err = 0;
        @(negedge clk); rst_n = 1'b1;

        // 1. fixed masks
        for (int m = 1; m < (1 << NW); m++) begin
            for (int w = 0; w < NW; w++) counts[w] = 0;
            warp_ready = NW'(m);
            for (int c = 0; c < 48; c++) begin
                #1;
                for (int w = 0; w < NW; w++) if (warp_grant[w]) counts[w]++;
                @(negedge clk);
            end
            pop = 0; lo = 1000; hi = 0;
            line = $sformatf("ARB mask=%b grants:", NW'(m));
            for (int w = 0; w < NW; w++) begin
                line = {line, $sformatf(" w%0d=%0d", w, counts[w])};
                if (m & (1 << w)) begin
                    pop++;
                    if (counts[w] < lo) lo = counts[w];
                    if (counts[w] > hi) hi = counts[w];
                end
            end
            $display("%s", line);
            if (hi * worst_den > worst_num * lo) begin worst_num = hi; worst_den = lo; end
        end

        // 2. random masks against a reference model
        warp_ready = '0;
        @(negedge clk); rst_n = 1'b0; @(negedge clk); rst_n = 1'b1;
        ref_ptr = 0;
        for (int c = 0; c < 20000; c++) begin
            rng = xs32(rng);
            warp_ready = rng[NW-1:0];
`ifndef ORIGINAL
            issue_accept = rng[8] | rng[9];     // accepted 3 cycles in 4
`endif
            #1;
            exp_grant = '0; ref_g = -1;
            for (int i = 0; i < NW; i++)
                if (ref_g < 0 && warp_ready[(ref_ptr + i) % NW]) ref_g = (ref_ptr + i) % NW;
            if (ref_g >= 0) exp_grant[ref_g] = 1'b1;
            if (warp_grant != exp_grant) mismatches++;
            if ((warp_grant & ~warp_ready) != 0 || $countones(warp_grant) > 1
                || issue_valid != (warp_ready != 0)) onehot_err++;
            if (ref_g >= 0 && issue_accept) ref_ptr = (ref_g + 1) % NW;
            @(negedge clk);
        end
        $display("ARB_RESULT worst_share=%0d:%0d random_mismatches=%0d/20000 protocol_errors=%0d",
                 worst_num, worst_den, mismatches, onehot_err);
        $finish;
    end
endmodule
