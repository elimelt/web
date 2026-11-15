// Educational model, not vendor RTL. 4-deep pipelined MAC chain, one
// educational analog of the systolic accumulation inside a matrix
// engine: each stage multiplies one (a,b) pair and adds it into the
// running sum carried from the previous stage.
module pipelined_mac_chain #(
    parameter int WIDTH = 16,
    parameter int DEPTH = 4
) (
    input  logic                   clk,
    input  logic                   rst_n,
    input  logic                   in_valid,
    input  logic [DEPTH-1:0][WIDTH-1:0] a,
    input  logic [DEPTH-1:0][WIDTH-1:0] b,
    output logic                   out_valid,
    output logic [2*WIDTH+DEPTH-1:0] acc_out
);
    logic [2*WIDTH+DEPTH-1:0] acc [DEPTH:1];
    logic [DEPTH:1]           valid_pipe;
    // The only change from pipelined_mac_chain.sv: stage 0's inputs come from
    // these nets instead of continuous assignments to acc[0] and valid_pipe[0].
    wire  [2*WIDTH+DEPTH-1:0] acc_in   [DEPTH-1:0];
    wire  [DEPTH-1:0]         valid_in;

    genvar s;
    generate
        for (s = 0; s < DEPTH; s++) begin : g_stage
            if (s == 0) begin : g_first
                assign acc_in[s]   = '0;
                assign valid_in[s] = in_valid;
            end else begin : g_rest
                assign acc_in[s]   = acc[s];
                assign valid_in[s] = valid_pipe[s];
            end
            always_ff @(posedge clk or negedge rst_n) begin
                if (!rst_n) begin
                    acc[s+1]        <= '0;
                    valid_pipe[s+1] <= 1'b0;
                end else begin
                    acc[s+1]        <= acc_in[s] + (a[s] * b[s]); // multiply-add this stage
                    valid_pipe[s+1] <= valid_in[s];            // carry the valid bit downstream
                end
            end
        end
    endgenerate

    assign acc_out   = acc[DEPTH];
    assign out_valid = valid_pipe[DEPTH];
endmodule
