// Testbench for banked_regfile (Model 2).
//
// For all 512 source triples (a, b, c) over 8 registers, sends one
// instruction to the collector, counts the cycles it spends reading, and
// compares the count with max over banks of ceil(distinct registers in that
// bank / PORTS). Also checks that the three operands returned are the values
// written to those registers.
module tb_regfile;
    parameter int NUM_BANKS = 2;
    parameter int PORTS     = 2;
    localparam int NW = 2, REGS = 8, LANES = 4, WIDTH = 32, VW = LANES * WIDTH;

    logic clk = 1'b0, rst_n = 1'b0;
    always #5 clk = ~clk;

    logic           in_valid = 1'b0, in_ready, out_valid, wb_en = 1'b0;
    logic           in_warp = 1'b0, out_warp, wb_warp = 1'b0, dbg_warp = 1'b0;
    logic [8:0]     in_src = '0;
    logic [2:0]     in_dst = '0, out_dst, wb_reg = '0, dbg_reg = '0;
    logic [3*VW-1:0] out_opnd;
    logic [VW-1:0]  wb_data = '0, dbg_data;
    logic           stat_read_cycle, stat_conflict_cycle;

    banked_regfile #(.NUM_WARPS(NW), .REGS(REGS), .LANES(LANES), .WIDTH(WIDTH),
                     .NUM_BANKS(NUM_BANKS), .PORTS(PORTS)) dut (.*);

    function automatic logic [VW-1:0] value_of(input int w, input int r);
        logic [VW-1:0] v;
        for (int l = 0; l < LANES; l++) v[l*WIDTH +: WIDTH] = 32'(w * 1000 + r * 10 + l);
        return v;
    endfunction

    int expected, measured, cnt_err, data_err, hist [5];
    int per_bank [NUM_BANKS];
    int src [3];
    logic seen [REGS];

    initial begin
        cnt_err = 0; data_err = 0;
        for (int i = 0; i < 5; i++) hist[i] = 0;
        @(negedge clk); rst_n = 1'b1;
        for (int w = 0; w < NW; w++)
            for (int r = 0; r < REGS; r++) begin
                wb_en = 1'b1; wb_warp = w[0]; wb_reg = 3'(r); wb_data = value_of(w, r);
                @(negedge clk);
            end
        wb_en = 1'b0;
        for (int t = 0; t < 512; t++) begin
            src[0] = t % 8; src[1] = (t / 8) % 8; src[2] = t / 64;
            // reference cycle count
            for (int b = 0; b < NUM_BANKS; b++) per_bank[b] = 0;
            for (int r = 0; r < REGS; r++) seen[r] = 1'b0;
            for (int j = 0; j < 3; j++)
                if (!seen[src[j]]) begin seen[src[j]] = 1'b1; per_bank[src[j] % NUM_BANKS]++; end
            expected = 1;
            for (int b = 0; b < NUM_BANKS; b++)
                if ((per_bank[b] + PORTS - 1) / PORTS > expected) expected = (per_bank[b] + PORTS - 1) / PORTS;
            // send it
            in_valid = 1'b1; in_warp = t[0]; in_dst = 3'd0;
            in_src = {3'(src[2]), 3'(src[1]), 3'(src[0])};
            #1; while (!in_ready) begin @(negedge clk); #1; end
            @(negedge clk); in_valid = 1'b0;
            measured = 0;
            #1;
            while (stat_read_cycle) begin measured++; @(negedge clk); #1; end
            // operands are presented in the cycle after the last read
            if (!out_valid) data_err++;
            for (int j = 0; j < 3; j++)
                if (out_opnd[j*VW +: VW] !== value_of(t % 2, src[j])) data_err++;
            if (measured != expected) cnt_err++;
            hist[measured]++;
            @(negedge clk);
        end
        $display("RF_RESULT banks=%0d ports=%0d triples=512 read_cycles_1=%0d read_cycles_2=%0d read_cycles_3=%0d count_mismatches=%0d data_errors=%0d",
                 NUM_BANKS, PORTS, hist[1], hist[2], hist[3], cnt_err, data_err);
        $finish;
    end
endmodule
