module pipelined_mac_chain_tb;
    localparam int WIDTH = 16, DEPTH = 4;
    logic clk = 0, rst_n = 0, in_valid, out_valid;
    logic [DEPTH-1:0][WIDTH-1:0] a, b;
    logic [2*WIDTH+DEPTH-1:0] acc_out;
    int expected;

    pipelined_mac_chain #(.WIDTH(WIDTH), .DEPTH(DEPTH)) dut (.*);
    always #5 clk = ~clk;

    initial begin
        rst_n = 0; in_valid = 0;
        @(posedge clk); rst_n = 1;

        for (int i = 0; i < DEPTH; i++) begin a[i] = i + 1; b[i] = 2; end
        expected = 0;
        for (int i = 0; i < DEPTH; i++) expected += (i + 1) * 2;

        in_valid = 1'b1;
        @(posedge clk);
        in_valid = 1'b0;

        repeat (DEPTH - 1) @(posedge clk);
        assert (out_valid == 1'b1)
            else $error("expected out_valid after %0d cycles", DEPTH);
        assert (acc_out == expected)
            else $error("expected acc_out=%0d got %0d", expected, acc_out);
        $finish;
    end
endmodule
