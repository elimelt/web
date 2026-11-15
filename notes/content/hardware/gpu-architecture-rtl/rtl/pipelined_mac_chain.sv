// Model 3: pipelined multiply-accumulate chain. Educational model, not vendor RTL.
//
// Computes acc_out = sum_s a[s]*b[s] for one operand set per cycle, with a
// latency of DEPTH cycles. Stage s adds a[s]*b[s] to the partial sum that
// stage s-1 produced one cycle earlier. The operand vectors travel down the
// pipeline with the partial sum, so stage s uses the operands of the set that
// entered s cycles ago rather than whatever is on the input port now. Without
// that skew, back-to-back operand sets mix (see ../original/ and the note).
module pipelined_mac_chain #(
    parameter int WIDTH = 16,
    parameter int DEPTH = 4
) (
    input  logic                         clk,
    input  logic                         rst_n,
    input  logic                         in_valid,
    input  logic [DEPTH-1:0][WIDTH-1:0]  a,
    input  logic [DEPTH-1:0][WIDTH-1:0]  b,
    output logic                         out_valid,
    output logic [2*WIDTH+DEPTH-1:0]     acc_out
);
    localparam int AW = 2 * WIDTH + DEPTH;

    // Register s+1 holds the state after stage s.
    logic [DEPTH:1][AW-1:0]                acc_q;
    logic [DEPTH:1]                        valid_q;
    logic [DEPTH:1][DEPTH-1:0][WIDTH-1:0]  a_q, b_q;

    genvar s;
    generate
        for (s = 0; s < DEPTH; s++) begin : g_stage
            logic [AW-1:0]                acc_in;
            logic                         valid_in;
            logic [DEPTH-1:0][WIDTH-1:0]  a_in, b_in;
            if (s == 0) begin : g_first
                assign acc_in   = '0;
                assign valid_in = in_valid;
                assign a_in     = a;
                assign b_in     = b;
            end else begin : g_rest
                assign acc_in   = acc_q[s];
                assign valid_in = valid_q[s];
                assign a_in     = a_q[s];
                assign b_in     = b_q[s];
            end
            always_ff @(posedge clk or negedge rst_n) begin
                if (!rst_n) begin
                    acc_q[s+1]   <= '0;
                    valid_q[s+1] <= 1'b0;
                    a_q[s+1]     <= '0;
                    b_q[s+1]     <= '0;
                end else begin
                    acc_q[s+1]   <= acc_in + AW'(a_in[s]) * AW'(b_in[s]);
                    valid_q[s+1] <= valid_in;
                    a_q[s+1]     <= a_in;
                    b_q[s+1]     <= b_in;
                end
            end
        end
    endgenerate

    assign acc_out   = acc_q[DEPTH];
    assign out_valid = valid_q[DEPTH];
endmodule
