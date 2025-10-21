"""Utility script to stress-test HTTP servers with concurrent GET requests."""

import argparse
import http.client
import socket
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from typing import List, Tuple


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send concurrent GET requests and measure latency")
    parser.add_argument("host", help="Server hostname or IP")
    parser.add_argument("port", type=int, help="Server TCP port")
    parser.add_argument("path", nargs="?", default="/", help="Path to request (default: /)")
    parser.add_argument(
        "--requests",
        type=int,
        default=10,
        help="Total number of requests to issue",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=10,
        help="Maximum number of in-flight requests",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=10.0,
        help="Per-request timeout in seconds",
    )
    parser.add_argument(
        "--total-timeout",
        type=float,
        default=0.0,
        help="Abort outstanding requests if the entire run exceeds this many seconds (0 disables)",
    )
    return parser.parse_args()


def _issue_request(host: str, port: int, path: str, timeout: float) -> Tuple[int, float, bool]:
    start = time.perf_counter()
    connection = http.client.HTTPConnection(host, port, timeout=timeout)
    timed_out = False
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        status = response.status
        response.read()
    except socket.timeout:
        status = 0
        timed_out = True
    except Exception:
        status = 0
    finally:
        connection.close()
    return status, time.perf_counter() - start, timed_out


def run_load_test(
    host: str,
    port: int,
    path: str,
    total_requests: int,
    concurrency: int,
    timeout: float,
    total_timeout: float,
) -> None:
    start_time = time.perf_counter()
    durations: List[float] = []
    statuses: List[int] = []
    timed_out_requests = 0

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(_issue_request, host, port, path, timeout) for _ in range(total_requests)]
        pending = set(futures)
        deadline = start_time + total_timeout if total_timeout > 0 else None

        while pending:
            wait_timeout = None
            if deadline is not None:
                remaining = deadline - time.perf_counter()
                if remaining <= 0:
                    break
                wait_timeout = remaining

            done, pending = wait(pending, timeout=wait_timeout, return_when=FIRST_COMPLETED)
            if not done:
                break

            for future in done:
                status, duration, timed_out = future.result()
                durations.append(duration)
                statuses.append(status)
                if timed_out:
                    timed_out_requests += 1

        cancelled = len(pending)
        for future in pending:
            future.cancel()

    total_time = time.perf_counter() - start_time
    success_count = sum(1 for status in statuses if status == 200)
    errors = len(statuses) - success_count

    print(f"Completed {len(statuses)} requests in {total_time:.3f}s")
    if durations:
        print(f"  Average latency: {sum(durations)/len(durations):.3f}s")
        print(f"  Fastest: {min(durations):.3f}s  Slowest: {max(durations):.3f}s")
    print(f"  Successes (HTTP 200): {success_count}")
    if errors:
        print(f"  Non-200 responses: {errors}")
    if timed_out_requests:
        print(f"  Request timeouts: {timed_out_requests}")
    if total_timeout > 0:
        if cancelled:
            print(f"  Cancelled due to overall timeout: {cancelled}")
        elif time.perf_counter() > (start_time + total_timeout):
            print("  Overall timeout reached after all requests completed")


def main() -> None:
    args = parse_args()
    run_load_test(
        args.host,
        args.port,
        args.path,
        args.requests,
        args.concurrency,
        args.timeout,
        args.total_timeout,
    )


if __name__ == "__main__":
    main()
