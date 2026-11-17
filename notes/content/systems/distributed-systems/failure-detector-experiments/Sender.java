// Heartbeat sender: one UDP datagram every PERIOD ms at a fixed rate
// (scheduled at t0 + k*PERIOD; a late heartbeat is sent as soon as possible,
// none are skipped). Each datagram carries the sequence number and the
// System.nanoTime() at which it was sent.
//
// Optional workload in the same JVM (args: seconds period_ms workload seed
// [port slots churn_from_s churn_to_s]); the workload runs only between
// churn_from_s and churn_to_s after start:
//   none   heartbeats only;
//   churn  two worker threads, each allocating about 200 MB/s, retain small objects so that the
//          live heap is about slots * 2 KB (arg 6), replacing a random slice of it
//          continuously; with -XX:+UseParallelGC the collector stops all
//          threads, the heartbeat thread included, for every collection.
import java.net.*;
import java.nio.ByteBuffer;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

public class Sender {
    static final AtomicBoolean done = new AtomicBoolean(false);
    static int slots;
    static long churnFrom, churnTo, start;

    public static void main(String[] a) throws Exception {
        int seconds = Integer.parseInt(a[0]);
        long period = Long.parseLong(a[1]) * 1_000_000L;
        String workload = a[2];
        long seed = Long.parseLong(a[3]);
        int port = Integer.parseInt(a.length > 4 ? a[4] : "47001");
        slots = Integer.parseInt(a.length > 5 ? a[5] : "150000");
        churnFrom = Long.parseLong(a.length > 6 ? a[6] : "0") * 1000L;
        churnTo = Long.parseLong(a.length > 7 ? a[7] : "1000000000") * 1000L;
        start = System.currentTimeMillis();
        if (workload.equals("churn")) {
            for (int w = 0; w < 2; w++) {
                final long s = seed * 31 + w;
                Thread t = new Thread(() -> churn(s));
                t.setDaemon(true);
                t.start();
            }
        }
        DatagramSocket sock = new DatagramSocket();
        InetAddress to = InetAddress.getLoopbackAddress();
        ByteBuffer buf = ByteBuffer.allocate(16);
        long t0 = System.nanoTime() + 200_000_000L;
        long n = seconds * 1_000_000_000L / period;
        for (long k = 0; k < n; k++) {
            long due = t0 + k * period;
            long wait;
            while ((wait = due - System.nanoTime()) > 0) {
                Thread.sleep(wait / 1_000_000L, (int) (wait % 1_000_000L));
            }
            buf.clear();
            buf.putLong(k);
            buf.putLong(System.nanoTime());
            sock.send(new DatagramPacket(buf.array(), 16, to, port));
        }
        done.set(true);
        sock.close();
    }

    // Retains about slots * 2 KB of small arrays and keeps replacing random slots.
    static void churn(long seed) {
        Random r = new Random(seed);
        final int SLOTS = slots;
        byte[][] live = new byte[SLOTS][];
        long count = 0;
        while (!done.get()) {
            long el = System.currentTimeMillis() - start;
            if (el < churnFrom || el >= churnTo) {
                if (el >= churnTo) live = new byte[SLOTS][]; // drop the live set
                try { Thread.sleep(50); } catch (InterruptedException e) { return; }
                continue;
            }
            int i = r.nextInt(SLOTS);
            live[i] = new byte[1024 + r.nextInt(2048)];
            if (++count % 1000 == 0) {
                // about 2 MB allocated per worker every 10 ms
                try { Thread.sleep(10); } catch (InterruptedException e) { return; }
            }
            if ((i & 0xff) == 0) {
                // a burst of short-lived garbage
                long x = 0;
                for (int j = 0; j < 2000; j++) x += new long[64].length;
                if (x == 42) System.out.print("");
            }
        }
    }
}
