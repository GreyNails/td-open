"""Bounded subprocess communication with cleanup of the entire process group."""
from __future__ import annotations
import asyncio
from contextlib import suppress
import os
import signal


class ProcessOutputLimit(ValueError):
    pass


async def run_bounded_process(*args: str, payload: bytes, cwd: str, env: dict,
                              timeout: float, stdout_limit: int = 8 * 1024 * 1024,
                              stderr_limit: int = 64 * 1024) -> tuple[int, bytes, bytes]:
    process = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=cwd, env=env,
        start_new_session=os.name == "posix", limit=65536)
    async def read(stream, limit, label):
        result = bytearray()
        while True:
            chunk = await stream.read(65536)
            if not chunk: return bytes(result)
            if len(result) + len(chunk) > limit: raise ProcessOutputLimit(f"{label} exceeds {limit} bytes")
            result.extend(chunk)
    async def write():
        try:
            process.stdin.write(payload); await process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError): pass
        finally:
            process.stdin.close()
            with suppress(BrokenPipeError, ConnectionResetError): await process.stdin.wait_closed()
    tasks = [asyncio.create_task(write()), asyncio.create_task(read(process.stdout, stdout_limit, "stdout")),
             asyncio.create_task(read(process.stderr, stderr_limit, "stderr")), asyncio.create_task(process.wait())]
    try:
        _, output, errors, code = await asyncio.wait_for(asyncio.gather(*tasks), timeout)
        return code, output, errors
    finally:
        # Also reap children whose parent exited normally after redirecting its
        # output. The isolated group contains only this invocation and its children.
        if os.name == "posix":
            with suppress(ProcessLookupError): os.killpg(process.pid, signal.SIGKILL)
        elif process.returncode is None:
            with suppress(ProcessLookupError): process.kill()
        for task in tasks:
            if not task.done(): task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        # A reader that hit its byte limit can leave the pipe transport paused.
        # Drain and discard remaining bytes after killing the group; wait() alone
        # can otherwise deadlock even though the child has already exited.
        async def discard(stream):
            while await stream.read(65536): pass
        try:
            await asyncio.wait_for(asyncio.gather(discard(process.stdout), discard(process.stderr), process.wait()), 2)
        except asyncio.TimeoutError:
            process._transport.close()
            with suppress(ProcessLookupError): await process.wait()
