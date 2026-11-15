// Model 2: banked vector register file with one operand collector.
// Educational model, not vendor RTL.
//
// Each bank row holds one architectural register of one warp for all LANES
// lanes (LANES*WIDTH bits), so a warp-wide read of one register is a single
// row read. Registers are assigned to banks by register index:
// bank = reg % NUM_BANKS, the mapping Jia et al. (2018) report for Volta with
// two banks. Each bank serves PORTS reads per cycle; Volta's two 64-bit-wide
// banks deliver two 32-bit registers per bank per cycle, so NUM_BANKS=2,
// PORTS=2 mimics that report, and NUM_BANKS=4, PORTS=1 mimics the Maxwell and
// Pascal arrangement in the same paper.
//
// The collector takes one three-source instruction (valid/ready), reads as
// many pending sources as the banks allow each cycle, and presents all three
// operands one cycle after its last read (bank reads are synchronous). Sources
// that name the same register are served by one read. A bank conflict shows up
// as extra read cycles, during which in_ready is low.
//
// The execute pipeline downstream never stalls, so there is no ready input on
// the operand side. One write port (writeback) is separate from the read ports.
module banked_regfile #(
    parameter int NUM_WARPS = 8,
    parameter int REGS      = 8,     // architectural registers per warp
    parameter int LANES     = 32,
    parameter int WIDTH     = 32,
    parameter int NUM_BANKS = 2,
    parameter int PORTS     = 2,     // reads per bank per cycle
    localparam int WID = $clog2(NUM_WARPS),
    localparam int RID = $clog2(REGS),
    localparam int VW  = LANES * WIDTH,
    localparam int ROWS = NUM_WARPS * REGS / NUM_BANKS
) (
    input  logic                  clk,
    input  logic                  rst_n,
    // instruction in
    input  logic                  in_valid,
    output logic                  in_ready,
    input  logic [WID-1:0]        in_warp,
    input  logic [3*RID-1:0]      in_src,     // {c, b, a}
    input  logic [RID-1:0]        in_dst,
    // operands out, to execute
    output logic                  out_valid,
    output logic [WID-1:0]        out_warp,
    output logic [RID-1:0]        out_dst,
    output logic [3*VW-1:0]       out_opnd,   // {c, b, a}
    // writeback port
    input  logic                  wb_en,
    input  logic [WID-1:0]        wb_warp,
    input  logic [RID-1:0]        wb_reg,
    input  logic [VW-1:0]         wb_data,
    // debug read port (testbench only, combinational)
    input  logic [WID-1:0]        dbg_warp,
    input  logic [RID-1:0]        dbg_reg,
    output logic [VW-1:0]         dbg_data,
    // statistics
    output logic                  stat_read_cycle,     // collector read this cycle
    output logic                  stat_conflict_cycle  // ...and must read again next cycle
);
    logic [VW-1:0] mem [NUM_BANKS][ROWS];

    function automatic int bank_of(input logic [RID-1:0] r);
        return int'(r) % NUM_BANKS;
    endfunction
    function automatic int row_of(input logic [WID-1:0] w, input logic [RID-1:0] r);
        return (int'(w) * REGS + int'(r)) / NUM_BANKS;
    endfunction

    // Collector state
    logic                a_valid;
    logic [WID-1:0]      a_warp;
    logic [3*RID-1:0]    a_src;       // {c, b, a}
    logic [RID-1:0]      a_dst;
    logic [2:0]          a_pend;      // source j still to be read
    logic [2:0]          sel;         // source j is read this cycle
    logic                done;

    // Bank arbitration for one cycle: grant pending sources in operand order,
    // at most PORTS distinct registers per bank. A source equal to one already
    // granted this cycle rides on that read.
    function automatic logic [2:0] select_reads(input logic [3*RID-1:0] src, input logic [2:0] pend);
        int used [NUM_BANKS];
        logic [2:0] g;
        logic dup;
        g = '0;
        for (int b = 0; b < NUM_BANKS; b++) used[b] = 0;
        for (int j = 0; j < 3; j++) begin
            if (pend[j]) begin
                dup = 1'b0;
                for (int k = 0; k < 3; k++)
                    if (k < j && g[k] && src[k*RID +: RID] == src[j*RID +: RID]) dup = 1'b1;
                if (dup) begin
                    g[j] = 1'b1;
                end else if (used[bank_of(src[j*RID +: RID])] < PORTS) begin
                    g[j] = 1'b1;
                    used[bank_of(src[j*RID +: RID])] = used[bank_of(src[j*RID +: RID])] + 1;
                end
            end
        end
        return g;
    endfunction

    assign sel  = a_valid ? select_reads(a_src, a_pend) : 3'b000;
    assign done = a_valid && ((a_pend & ~sel) == 3'b000);

    assign dbg_data            = mem[bank_of(dbg_reg)][row_of(dbg_warp, dbg_reg)];
    assign in_ready            = !a_valid || done;
    assign stat_read_cycle     = a_valid;
    assign stat_conflict_cycle = a_valid && !done;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            a_valid   <= 1'b0;
            a_pend    <= '0;
            a_warp    <= '0;
            a_src     <= '0;
            a_dst     <= '0;
            out_valid <= 1'b0;
            out_warp  <= '0;
            out_dst   <= '0;
        end else begin
            // synchronous bank reads: data lands in the operand registers
            for (int j = 0; j < 3; j++)
                if (sel[j]) out_opnd[j*VW +: VW] <= mem[bank_of(a_src[j*RID +: RID])][row_of(a_warp, a_src[j*RID +: RID])];
            a_pend    <= a_pend & ~sel;
            out_valid <= done;
            if (done) begin
                out_warp <= a_warp;
                out_dst  <= a_dst;
            end
            if (in_valid && in_ready) begin
                a_valid <= 1'b1;
                a_warp  <= in_warp;
                a_src   <= in_src;
                a_dst   <= in_dst;
                a_pend  <= 3'b111;
            end else if (done) begin
                a_valid <= 1'b0;
            end
        end
    end

    always_ff @(posedge clk) begin
        if (wb_en) mem[bank_of(wb_reg)][row_of(wb_warp, wb_reg)] <= wb_data;
    end
endmodule
