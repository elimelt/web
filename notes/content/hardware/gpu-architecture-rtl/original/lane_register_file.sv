// Educational model, not vendor RTL. One synchronous register-file
// bank per SIMT lane; a warp-wide register read is 32 parallel bank
// reads in a single cycle, addressed identically across lanes.
module lane_register_file #(
    parameter int NUM_LANES     = 32,
    parameter int REGS_PER_LANE = 256,
    parameter int DATA_WIDTH    = 32
) (
    input  logic                                 clk,
    input  logic [$clog2(REGS_PER_LANE)-1:0]     raddr,   // same register index, all lanes
    input  logic [$clog2(REGS_PER_LANE)-1:0]     waddr,
    input  logic                                 we,
    input  logic [NUM_LANES-1:0][DATA_WIDTH-1:0] wdata,
    output logic [NUM_LANES-1:0][DATA_WIDTH-1:0] rdata
);
    logic [DATA_WIDTH-1:0] bank [NUM_LANES-1:0][REGS_PER_LANE-1:0];

    genvar lane;
    generate
        for (lane = 0; lane < NUM_LANES; lane++) begin : g_lane
            always_ff @(posedge clk) begin
                if (we) bank[lane][waddr] <= wdata[lane];
                rdata[lane] <= bank[lane][raddr];
            end
        end
    endgenerate
endmodule
