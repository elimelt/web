// Model 1: round-robin warp issue arbiter. Educational model, not vendor RTL.
//
// Each cycle the arbiter grants at most one ready warp. The search starts at
// rr_ptr; after an accepted grant, rr_ptr moves to the warp after the one that
// was granted, so a warp that was just served has the lowest priority next.
// issue_accept is the downstream ready signal: the pointer moves only when
// the grant is taken (valid/ready, see valid_ready_stage.sv).
module warp_issue_arbiter #(
    parameter int NUM_WARPS = 4          // at least 2
) (
    input  logic                  clk,
    input  logic                  rst_n,
    input  logic [NUM_WARPS-1:0]  warp_ready,   // warp i has an issuable instruction
    input  logic                  issue_accept, // downstream takes the grant this cycle
    output logic [NUM_WARPS-1:0]  warp_grant,   // one-hot grant
    output logic [$clog2(NUM_WARPS)-1:0] grant_idx,
    output logic                  issue_valid   // some warp is granted
);
    localparam int IW = $clog2(NUM_WARPS);
    logic [IW-1:0] rr_ptr;
    int w;

    always_comb begin
        warp_grant  = '0;
        grant_idx   = '0;
        issue_valid = 1'b0;
        w = 0;
        for (int i = 0; i < NUM_WARPS; i++) begin
            w = (int'(rr_ptr) + i) % NUM_WARPS;
            if (!issue_valid && warp_ready[w]) begin
                warp_grant[w] = 1'b1;
                grant_idx     = IW'(w);
                issue_valid   = 1'b1;
            end
        end
    end

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            rr_ptr <= '0;
        else if (issue_valid && issue_accept)
            rr_ptr <= IW'((int'(grant_idx) + 1) % NUM_WARPS);
    end
endmodule
