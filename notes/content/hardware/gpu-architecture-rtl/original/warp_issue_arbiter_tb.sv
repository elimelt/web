module warp_issue_arbiter_tb;
    logic clk = 0, rst_n = 0;
    logic [3:0] warp_ready, warp_grant;
    logic issue_valid;

    warp_issue_arbiter #(.NUM_WARPS(4)) dut (.*);
    always #5 clk = ~clk;

    initial begin
        rst_n = 0; warp_ready = 4'b0000;
        @(posedge clk); rst_n = 1;

        warp_ready = 4'b0100;  // only warp 2 ready
        @(posedge clk);
        assert (warp_grant == 4'b0100)
            else $error("expected warp 2 granted, got %b", warp_grant);

        warp_ready = 4'b0000;  // nobody ready
        @(posedge clk);
        assert (issue_valid == 1'b0)
            else $error("issued with no ready warps");
        $finish;
    end
endmodule
