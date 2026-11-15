"""TCP proxy that delays every byte by a fixed time in each direction.

    python3 delayproxy.py DELAY_MS LISTEN:TARGET [LISTEN:TARGET ...]

run.sh puts one in front of each etcd member's peer port, so all Raft
traffic between members sees DELAY_MS of one-way latency while each client
still talks to its own member directly. Order within a connection is kept;
throughput is not limited.
"""

import asyncio
import sys
import time


async def pump(reader, writer, delay):
    queue = asyncio.Queue()

    async def sender():
        while True:
            due, data = await queue.get()
            if data is None:
                break
            wait = due - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            writer.write(data)
            await writer.drain()
        writer.close()

    task = asyncio.create_task(sender())
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            await queue.put((time.monotonic() + delay, data))
    except (ConnectionError, OSError):
        pass
    await queue.put((0, None))
    try:
        await task
    except (ConnectionError, OSError):
        pass


async def serve(listen, target, delay):
    async def handle(cr, cw):
        try:
            tr, tw = await asyncio.open_connection("127.0.0.1", target)
        except OSError:
            cw.close()
            return
        await asyncio.gather(pump(cr, tw, delay), pump(tr, cw, delay))

    server = await asyncio.start_server(handle, "127.0.0.1", listen)
    async with server:
        await server.serve_forever()


async def main():
    delay = float(sys.argv[1]) / 1000.0
    pairs = [tuple(int(x) for x in a.split(":")) for a in sys.argv[2:]]
    await asyncio.gather(*(serve(l, t, delay) for l, t in pairs))


if __name__ == "__main__":
    asyncio.run(main())
