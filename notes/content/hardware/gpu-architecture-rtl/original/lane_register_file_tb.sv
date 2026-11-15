module lane_register_file_tb;
    localparam int LANES = 32;
    logic clk = 0;
    logic [7:0] raddr, waddr;
    logic we;
    logic [LANES-1:0][31:0] wdata, rdata;

    lane_register_file #(.NUM_LANES(LANES), .REGS_PER_LANE(256)) dut (.*);
    always #5 clk = ~clk;

    initial begin
        waddr = 8'd3; we = 1'b1;
        for (int i = 0; i < LANES; i++) wdata[i] = i;
        @(posedge clk);
        we = 1'b0;

        raddr = 8'd3;
        @(posedge clk);
        for (int i = 0; i < LANES; i++)
            assert (rdata[i] == i)
                else $error("lane %0d expected %0d got %0d", i, i, rdata[i]);
        $finish;
    end
endmodule
