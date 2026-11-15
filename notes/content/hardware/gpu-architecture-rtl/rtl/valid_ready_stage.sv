// Model 4: one-entry valid/ready pipeline register. Educational model.
//
// A transfer happens on a rising edge at which valid and ready are both high.
// The stage holds one item. It accepts a new item when it is empty or when its
// current item leaves in the same cycle, so a stream with both sides always
// ready moves one item per cycle. in_ready depends combinationally on
// out_ready; a skid buffer (two entries) would break that path.
module valid_ready_stage #(
    parameter int WIDTH = 8
) (
    input  logic             clk,
    input  logic             rst_n,
    input  logic             in_valid,
    output logic             in_ready,
    input  logic [WIDTH-1:0] in_data,
    output logic             out_valid,
    input  logic             out_ready,
    output logic [WIDTH-1:0] out_data
);
    logic             full;
    logic [WIDTH-1:0] data;

    assign in_ready  = !full || out_ready;
    assign out_valid = full;
    assign out_data  = data;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            full <= 1'b0;
            data <= '0;
        end else if (in_valid && in_ready) begin
            full <= 1'b1;          // refill (possibly in the cycle the old item leaves)
            data <= in_data;
        end else if (out_ready) begin
            full <= 1'b0;          // item left, nothing arrived
        end
    end
endmodule
