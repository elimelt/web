// Testbench for toy_partition: runs one IMAD program per warp, prints an
// optional cycle-by-cycle trace and a RESULT line, and checks every register
// of every warp against an in-order reference model.
//
// Plusargs: +WARPS=<active warps> +N=<instructions per warp>
//           +PATTERN=<0 chain | 1 conflict-chain | 2 four-chain ILP | 3 random>
//           +SEED=<n> +TRACE=<cycles to print>
// Parameters (set with -P / -G): NUM_BANKS, PORTS, EXEC_DEPTH.
// Inputs change and outputs are sampled at the falling edge, so the result does
// not depend on how a simulator orders events within the rising-edge time step.
module tb_partition;
    parameter int NUM_BANKS  = 2;
    parameter int PORTS      = 2;
    parameter int EXEC_DEPTH = 4;
    localparam int NW = 16, REGS = 8, LANES = 32, WIDTH = 32, PCW = 10;
    localparam int WID = $clog2(NW), RID = $clog2(REGS), VW = LANES * WIDTH, IW = 4 * RID;
    localparam int MAXN = 512;

    logic clk = 1'b0, rst_n = 1'b0, run = 1'b0;
    always #5 clk = ~clk;

    logic [NW-1:0]           has_instr;
    logic [NW*IW-1:0]        instr;
    logic [NW*PCW-1:0]       pc;
    logic                    init_en = 1'b0;
    logic [WID-1:0]          init_warp = '0, dbg_warp = '0;
    logic [RID-1:0]          init_reg = '0, dbg_reg = '0;
    logic [VW-1:0]           init_data = '0, dbg_data;
    logic [NW-1:0]           t_ready;
    logic                    t_issue, t_latch_valid, t_read, t_conflict, t_op_valid, t_wb, idle;
    logic [WID-1:0]          t_issue_warp, t_latch_warp, t_coll_warp, t_op_warp, t_wb_warp;
    logic [EXEC_DEPTH-1:0]   t_exec_valid;
    logic [EXEC_DEPTH*WID-1:0] t_exec_warp;
    logic [RID-1:0]          t_wb_reg;

    toy_partition #(.NUM_WARPS(NW), .REGS(REGS), .LANES(LANES), .WIDTH(WIDTH),
                    .NUM_BANKS(NUM_BANKS), .PORTS(PORTS), .EXEC_DEPTH(EXEC_DEPTH),
                    .PCW(PCW)) dut (.*);

    // program storage and reference state
    logic [IW-1:0]    prog [NW][MAXN];
    logic [WIDTH-1:0] ref_r [NW][REGS][LANES];
    int warps, n, pattern, seed, trace;
    logic [31:0] rng;

    function automatic logic [31:0] xs32(input logic [31:0] x);
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        return x;
    endfunction
    function automatic logic [IW-1:0] enc(input int d, input int a, input int b, input int c);
        return {RID'(d), RID'(c), RID'(b), RID'(a)};
    endfunction

    // prog is written once before run, so pc, warps and n are the only inputs
    always @(pc or warps or n or run) begin
        for (int w = 0; w < NW; w++) begin
            has_instr[w] = (w < warps) && (int'(pc[w*PCW +: PCW]) < n);
            instr[w*IW +: IW] = (int'(pc[w*PCW +: PCW]) < MAXN) ? prog[w][pc[w*PCW +: 9]] : '0;
        end
    end

    int cycles, issued, reads, conflicts, errors, done_run;
    string line, verdict;

    initial begin
        if (!$value$plusargs("WARPS=%d", warps))     warps = 1;
        if (!$value$plusargs("N=%d", n))             n = 64;
        if (!$value$plusargs("PATTERN=%d", pattern)) pattern = 0;
        if (!$value$plusargs("SEED=%d", seed))       seed = 1;
        if (!$value$plusargs("TRACE=%d", trace))     trace = 0;
        rng = 32'h9E3779B9 ^ 32'(seed);

        // programs
        for (int w = 0; w < NW; w++)
            for (int i = 0; i < MAXN; i++) begin
                case (pattern)
                    0: prog[w][i] = enc(3, 1, 2, 3);                  // IMAD R3, R1, R2, R3
                    1: prog[w][i] = enc(5, 1, 3, 5);                  // IMAD R5, R1, R3, R5 (odd regs)
                    2: prog[w][i] = enc(4 + i % 4, 1, 2, 4 + i % 4);  // four independent chains
                    default: begin
                        rng = xs32(rng); prog[w][i][RID-1:0]       = rng[2:0];
                        rng = xs32(rng); prog[w][i][2*RID-1:RID]   = rng[2:0];
                        rng = xs32(rng); prog[w][i][3*RID-1:2*RID] = rng[2:0];
                        rng = xs32(rng); prog[w][i][4*RID-1:3*RID] = rng[2:0];
                    end
                endcase
            end

        // initial register values
        for (int w = 0; w < NW; w++)
            for (int r = 0; r < REGS; r++)
                for (int l = 0; l < LANES; l++)
                    ref_r[w][r][l] = xs32(32'(w * 4099 + r * 131 + l + 1));

        // reset, then preload through the write port
        @(negedge clk); @(negedge clk); rst_n = 1'b1;
        for (int w = 0; w < NW; w++)
            for (int r = 0; r < REGS; r++) begin
                @(negedge clk);
                init_en = 1'b1; init_warp = WID'(w); init_reg = RID'(r);
                for (int l = 0; l < LANES; l++) init_data[l*WIDTH +: WIDTH] = ref_r[w][r][l];
            end
        @(negedge clk); init_en = 1'b0;

        // reference: execute each warp's program in order
        for (int w = 0; w < warps; w++)
            for (int i = 0; i < n; i++)
                for (int l = 0; l < LANES; l++)
                    ref_r[w][prog[w][i][4*RID-1:3*RID]][l] =
                        ref_r[w][prog[w][i][RID-1:0]][l] * ref_r[w][prog[w][i][2*RID-1:RID]][l]
                        + ref_r[w][prog[w][i][3*RID-1:2*RID]][l];

        if (trace > 0)
            $display("cyc | rdy  | issue | latch | collector  operands | exec s1 s2 s3 s4 | writeback");
        @(negedge clk);
        run = 1'b1;
        cycles = 0; issued = 0; reads = 0; conflicts = 0;
        // sample at each falling edge: the state of the cycle that ends at the next rising edge
        done_run = 0;
        // run rises at a falling edge; #1 later the cycle's combinational values have settled
        while (done_run == 0) begin
            #1;
            if (trace > 0 && cycles < trace) begin
                line = $sformatf("%3d | %b |", cycles, t_ready[3:0]);
                if (t_issue) line = {line, $sformatf("  w%0d   |", t_issue_warp)};
                else         line = {line, "   .   |"};
                if (t_latch_valid) line = {line, $sformatf("  w%0d   |", t_latch_warp)};
                else               line = {line, "   .   |"};
                if (t_read && t_conflict) line = {line, $sformatf(" w%0d read+cnf", t_coll_warp)};
                else if (t_read)          line = {line, $sformatf(" w%0d read    ", t_coll_warp)};
                else                      line = {line, "     .      "};
                if (t_op_valid) line = {line, $sformatf(" w%0d opnd |", t_op_warp)};
                else            line = {line, "    .    |"};
                line = {line, "     "};
                for (int s = 0; s < EXEC_DEPTH; s++)
                    if (t_exec_valid[s]) line = {line, $sformatf("w%0d ", t_exec_warp[s*WID +: WID])};
                    else                 line = {line, " . "};
                line = {line, "|"};
                if (t_wb) line = {line, $sformatf(" w%0d R%0d", t_wb_warp, t_wb_reg)};
                else      line = {line, " ."};
                $display("%s", line);
            end
            if (t_issue)    issued++;
            if (t_read)     reads++;
            if (t_conflict) conflicts++;
            cycles++;
            if (issued == warps * n && idle && !t_issue) done_run = 1;
            if (cycles > 100000) begin $display("TIMEOUT"); done_run = 1; end
            @(negedge clk);
        end

        // check every register of every active warp
        errors = 0;
        for (int w = 0; w < warps; w++)
            for (int r = 0; r < REGS; r++) begin
                dbg_warp = WID'(w); dbg_reg = RID'(r);
                #1;
                for (int l = 0; l < LANES; l++)
                    if (dbg_data[l*WIDTH +: WIDTH] !== ref_r[w][r][l]) errors++;
            end
        if (errors == 0) verdict = "PASS"; else verdict = $sformatf("FAIL(%0d)", errors);
        $display("RESULT banks=%0d ports=%0d depth=%0d pattern=%0d warps=%0d seed=%0d instr=%0d cycles=%0d read_cycles=%0d conflict_cycles=%0d check=%s",
                 NUM_BANKS, PORTS, EXEC_DEPTH, pattern, warps, seed, issued, cycles, reads, conflicts,
                 verdict);
        $finish;
    end
endmodule
