// Educational model, not vendor RTL. Minimal valid/ready handshake
// between an issuing warp scheduler and a downstream execution unit
// that is not always free to accept a new instruction.
module issue_handshake #(
    parameter int OPWIDTH = 8
) (
    input  logic               clk,
    input  logic                rst_n,
    input  logic                sched_valid,   // scheduler has an instruction
    input  logic [OPWIDTH-1:0]  sched_op,
    output logic                sched_ready,   // execution unit can accept it
    output logic                exec_valid,    // instruction accepted this cycle
    output logic [OPWIDTH-1:0]  exec_op
);
    logic busy;   // models a multi-cycle execution unit occupied by a prior op

    assign sched_ready = !busy;
    assign exec_valid  = sched_valid && sched_ready; // transfer iff both sides agree

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            busy    <= 1'b0;
            exec_op <= '0;
        end else if (exec_valid) begin
            busy    <= 1'b1;      // pretend this op occupies the unit next cycle
            exec_op <= sched_op;
        end else begin
            busy    <= 1'b0;      // frees up if nothing was accepted
        end
    end
endmodule
