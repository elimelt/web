// Educational model, not vendor RTL. Round-robin arbiter picking one
// ready warp to issue each cycle, one-hot output.
module warp_issue_arbiter #(
    parameter int NUM_WARPS = 4
) (
    input  logic                  clk,
    input  logic                  rst_n,
    input  logic [NUM_WARPS-1:0]  warp_ready,   // warp i has a decoded instruction ready
    output logic [NUM_WARPS-1:0]  warp_grant,   // one-hot: warp granted issue this cycle
    output logic                  issue_valid   // some warp was granted
);
    logic [$clog2(NUM_WARPS)-1:0] rr_ptr;       // round-robin priority pointer
    logic [2*NUM_WARPS-1:0]       ready_x2;     // ready mask duplicated for rotation
    logic [2*NUM_WARPS-1:0]       grant_x2;

    assign ready_x2 = {warp_ready, warp_ready};

    always_comb begin
        grant_x2    = '0;
        issue_valid = 1'b0;
        for (int i = 0; i < NUM_WARPS; i++) begin
            if (!issue_valid && ready_x2[rr_ptr + i]) begin
                grant_x2[rr_ptr + i] = 1'b1;
                issue_valid = 1'b1;
            end
        end
        warp_grant = grant_x2[NUM_WARPS-1:0] | grant_x2[2*NUM_WARPS-1:NUM_WARPS];
    end

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)          rr_ptr <= '0;
        else if (issue_valid) rr_ptr <= (rr_ptr + 1) % NUM_WARPS; // move past the granted warp
    end
endmodule
