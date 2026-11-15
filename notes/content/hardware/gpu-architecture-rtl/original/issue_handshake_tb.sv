module issue_handshake_tb;
    logic clk = 0, rst_n = 0, sched_valid, sched_ready, exec_valid;
    logic [7:0] sched_op, exec_op;

    issue_handshake #(.OPWIDTH(8)) dut (.*);
    always #5 clk = ~clk;

    initial begin
        rst_n = 0; sched_valid = 0; sched_op = 8'hAA;
        @(posedge clk); rst_n = 1;

        sched_valid = 1'b1;
        @(posedge clk);
        assert (exec_valid == 1'b1 && exec_op == 8'hAA)
            else $error("expected transfer of op AA");

        @(posedge clk); // execution unit now busy, sched_ready should drop
        assert (sched_ready == 1'b0)
            else $error("expected sched_ready low while busy");
        $finish;
    end
endmodule
