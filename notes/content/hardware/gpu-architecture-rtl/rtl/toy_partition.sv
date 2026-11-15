// A toy SM partition built from the four models. Educational model, not vendor RTL.
//
//   warp_issue_arbiter -> valid_ready_stage (issue latch) -> banked_regfile
//   (operand collector) -> EXEC_DEPTH-stage lane-parallel IMAD pipeline ->
//   writeback into banked_regfile.
//
// Every instruction is IMAD d, a, b, c (d = a*b + c per lane, 32-bit integer
// wraparound), the integer analog of FFMA. A per-warp scoreboard holds one
// pending bit per register; a warp is ready when its next instruction reads or
// writes no register with a write still in flight. Instructions of one warp
// issue in program order, and independent instructions of one warp may overlap.
module toy_partition #(
    parameter int NUM_WARPS  = 8,
    parameter int REGS       = 8,
    parameter int LANES      = 32,
    parameter int WIDTH      = 32,
    parameter int NUM_BANKS  = 2,
    parameter int PORTS      = 2,
    parameter int EXEC_DEPTH = 4,
    parameter int PCW        = 10,
    localparam int WID = $clog2(NUM_WARPS),
    localparam int RID = $clog2(REGS),
    localparam int VW  = LANES * WIDTH,
    localparam int IW  = 4 * RID           // {dst, c, b, a}
) (
    input  logic                           clk,
    input  logic                           rst_n,
    input  logic                           run,
    // instruction supply: instr[w] is the instruction at pc[w]
    input  logic [NUM_WARPS-1:0]           has_instr,
    input  logic [NUM_WARPS*IW-1:0]        instr,     // warp w at [w*IW +: IW]
    output logic [NUM_WARPS*PCW-1:0]       pc,        // warp w at [w*PCW +: PCW]
    // register preload (only while run is low)
    input  logic                           init_en,
    input  logic [WID-1:0]                 init_warp,
    input  logic [RID-1:0]                 init_reg,
    input  logic [VW-1:0]                  init_data,
    // debug read
    input  logic [WID-1:0]                 dbg_warp,
    input  logic [RID-1:0]                 dbg_reg,
    output logic [VW-1:0]                  dbg_data,
    // trace
    output logic [NUM_WARPS-1:0]           t_ready,
    output logic                           t_issue,
    output logic [WID-1:0]                 t_issue_warp,
    output logic                           t_latch_valid,
    output logic [WID-1:0]                 t_latch_warp,
    output logic                           t_read,
    output logic                           t_conflict,
    output logic                           t_op_valid,
    output logic [WID-1:0]                 t_coll_warp,
    output logic [WID-1:0]                 t_op_warp,
    output logic [EXEC_DEPTH-1:0]          t_exec_valid,
    output logic [EXEC_DEPTH*WID-1:0]      t_exec_warp,
    output logic                           t_wb,
    output logic [WID-1:0]                 t_wb_warp,
    output logic [RID-1:0]                 t_wb_reg,
    output logic                           idle
);
    function automatic logic [RID-1:0] f_a(input logic [IW-1:0] i);   return i[RID-1:0];         endfunction
    function automatic logic [RID-1:0] f_b(input logic [IW-1:0] i);   return i[2*RID-1:RID];     endfunction
    function automatic logic [RID-1:0] f_c(input logic [IW-1:0] i);   return i[3*RID-1:2*RID];   endfunction
    function automatic logic [RID-1:0] f_d(input logic [IW-1:0] i);   return i[4*RID-1:3*RID];   endfunction

    // ---------------- scoreboard and readiness ----------------
    logic [IW-1:0]   ins     [NUM_WARPS];
    logic [PCW-1:0]  pc_r    [NUM_WARPS];
    logic [REGS-1:0] pending [NUM_WARPS];
    logic [NUM_WARPS-1:0] ready;
    genvar gw;
    generate
        for (gw = 0; gw < NUM_WARPS; gw++) begin : g_warp
            assign ins[gw] = instr[gw*IW +: IW];
            assign pc[gw*PCW +: PCW] = pc_r[gw];
            assign ready[gw] = run && has_instr[gw]
                && !pending[gw][f_a(ins[gw])] && !pending[gw][f_b(ins[gw])]
                && !pending[gw][f_c(ins[gw])] && !pending[gw][f_d(ins[gw])];
        end
    endgenerate

    // ---------------- Model 1: arbiter ----------------
    logic [NUM_WARPS-1:0] grant;
    logic [WID-1:0]       grant_idx;
    logic                 issue_valid, latch_in_ready;
    warp_issue_arbiter #(.NUM_WARPS(NUM_WARPS)) u_arb (
        .clk, .rst_n, .warp_ready(ready), .issue_accept(latch_in_ready),
        .warp_grant(grant), .grant_idx, .issue_valid);
    wire issue_fire = issue_valid && latch_in_ready;

    // ---------------- Model 4: issue latch (valid/ready) ----------------
    logic                latch_valid, rf_in_ready;
    logic [WID+IW-1:0]   latch_data;
    valid_ready_stage #(.WIDTH(WID + IW)) u_latch (
        .clk, .rst_n,
        .in_valid(issue_valid), .in_ready(latch_in_ready), .in_data({grant_idx, ins[grant_idx]}),
        .out_valid(latch_valid), .out_ready(rf_in_ready), .out_data(latch_data));
    wire [WID-1:0] l_warp  = latch_data[WID+IW-1:IW];
    wire [IW-1:0]  l_instr = latch_data[IW-1:0];

    // ---------------- Model 2: banked register file + collector ----------------
    logic                op_valid;
    logic [WID-1:0]      op_warp;
    logic [RID-1:0]      op_dst;
    logic [3*VW-1:0]     op;          // {c, b, a}
    logic                wb_en;
    logic [WID-1:0]      wb_warp;
    logic [RID-1:0]      wb_reg;
    logic [VW-1:0]       wb_data;
    logic                rf_wen;
    logic [WID-1:0]      rf_wwarp;
    logic [RID-1:0]      rf_wreg;
    logic [VW-1:0]       rf_wdata;
    assign rf_wen   = run ? wb_en   : init_en;
    assign rf_wwarp = run ? wb_warp : init_warp;
    assign rf_wreg  = run ? wb_reg  : init_reg;
    assign rf_wdata = run ? wb_data : init_data;

    banked_regfile #(.NUM_WARPS(NUM_WARPS), .REGS(REGS), .LANES(LANES), .WIDTH(WIDTH),
                     .NUM_BANKS(NUM_BANKS), .PORTS(PORTS)) u_rf (
        .clk, .rst_n,
        .in_valid(latch_valid), .in_ready(rf_in_ready), .in_warp(l_warp),
        .in_src({f_c(l_instr), f_b(l_instr), f_a(l_instr)}), .in_dst(f_d(l_instr)),
        .out_valid(op_valid), .out_warp(op_warp), .out_dst(op_dst), .out_opnd(op),
        .wb_en(rf_wen), .wb_warp(rf_wwarp), .wb_reg(rf_wreg), .wb_data(rf_wdata),
        .dbg_warp, .dbg_reg, .dbg_data,
        .stat_read_cycle(t_read), .stat_conflict_cycle(t_conflict));

    // ---------------- execute: lane-parallel IMAD, EXEC_DEPTH stages ----------------
    logic [VW-1:0] imad;
    always_comb
        for (int l = 0; l < LANES; l++)
            imad[l*WIDTH +: WIDTH] = op[l*WIDTH +: WIDTH] * op[VW + l*WIDTH +: WIDTH]
                                   + op[2*VW + l*WIDTH +: WIDTH];

    logic [EXEC_DEPTH-1:0] ex_v;
    logic [WID-1:0]        ex_w [EXEC_DEPTH];
    logic [RID-1:0]        ex_d [EXEC_DEPTH];
    logic [VW-1:0]         ex_r [EXEC_DEPTH];
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            ex_v <= '0;
        end else begin
            ex_v[0] <= op_valid;
            ex_w[0] <= op_warp;
            ex_d[0] <= op_dst;
            ex_r[0] <= imad;
            for (int s = 1; s < EXEC_DEPTH; s++) begin
                ex_v[s] <= ex_v[s-1];
                ex_w[s] <= ex_w[s-1];
                ex_d[s] <= ex_d[s-1];
                ex_r[s] <= ex_r[s-1];
            end
        end
    end
    assign wb_en   = ex_v[EXEC_DEPTH-1];
    assign wb_warp = ex_w[EXEC_DEPTH-1];
    assign wb_reg  = ex_d[EXEC_DEPTH-1];
    assign wb_data = ex_r[EXEC_DEPTH-1];

    // ---------------- scoreboard and pc update ----------------
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            for (int w = 0; w < NUM_WARPS; w++) begin
                pending[w] <= '0;
                pc_r[w]    <= '0;
            end
        end else begin
            if (run && wb_en)  pending[wb_warp][wb_reg] <= 1'b0;
            if (issue_fire) begin
                pending[grant_idx][f_d(ins[grant_idx])] <= 1'b1;
                pc_r[grant_idx] <= pc_r[grant_idx] + 1'b1;
            end
        end
    end

    // ---------------- trace ----------------
    assign t_ready       = ready;
    assign t_issue       = issue_fire;
    assign t_issue_warp  = grant_idx;
    assign t_latch_valid = latch_valid;
    assign t_latch_warp  = l_warp;
    assign t_coll_warp   = u_rf.a_warp;
    assign t_op_valid    = op_valid;
    assign t_op_warp     = op_warp;
    assign t_exec_valid  = ex_v;
    generate
        for (gw = 0; gw < EXEC_DEPTH; gw++) begin : g_tex
            assign t_exec_warp[gw*WID +: WID] = ex_w[gw];
        end
    endgenerate
    assign t_wb          = wb_en;
    assign t_wb_warp     = wb_warp;
    assign t_wb_reg      = wb_reg;
    assign idle          = !latch_valid && !u_rf.a_valid && !op_valid && (ex_v == '0);
endmodule
