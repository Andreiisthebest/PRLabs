import argparse
import socket
import sys
import threading
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Deque, Dict, Iterable, Optional, Tuple
import urllib.parse

CRLF = "\r\n"
REQUEST_TERMINATOR = f"{CRLF}{CRLF}".encode("ascii")
MAX_REQUEST_SIZE = 16 * 1024
DEFAULT_MIME_TYPES: Dict[str, str] = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".png": "image/png",
    ".pdf": "application/pdf",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Concurrent HTTP file server with request counting and rate limiting."
    )
    parser.add_argument("directory", type=Path, help="Root directory to expose over HTTP")
    parser.add_argument("--host", default="0.0.0.0", help="Interface to bind to")
    parser.add_argument("--port", type=int, default=8080, help="TCP port to bind to")
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="Maximum number of worker threads handling connections",
    )
    parser.add_argument(
        "--simulate-delay",
        type=float,
        default=0.0,
        help="Artificial delay (seconds) added to each request handler to emulate work",
    )
    parser.add_argument(
        "--naive-counter",
        action="store_true",
        help="Disable synchronization around the request counter (for race demonstrations)",
    )
    parser.add_argument(
        "--naive-counter-delay",
        type=float,
        default=0.0,
        help="Sleep duration inserted between read/write in naive counter to magnify races",
    )
    parser.add_argument(
        "--rate-limit",
        type=float,
        default=5.0,
        help="Allowed requests per second per client IP (set 0 to disable rate limiting)",
    )
    parser.add_argument(
        "--rate-window",
        type=float,
        default=1.0,
        help="Sliding window size in seconds used for rate limiting",
    )
    return parser.parse_args()


class RequestCounter:
    def __init__(self, synchronized: bool, naive_delay: float) -> None:
        self._counts: Dict[str, int] = defaultdict(int)
        self._lock = threading.Lock()
        self._synchronized = synchronized
        self._naive_delay = naive_delay

    def increment(self, key: str) -> int:
        if self._synchronized:
            with self._lock:
                self._counts[key] += 1
                return self._counts[key]

        # Naive mode: intentionally read-modify-write without a lock.
        current = self._counts.get(key, 0)
        if self._naive_delay > 0:
            time.sleep(self._naive_delay)
        new_value = current + 1
        self._counts[key] = new_value
        return new_value

    def get(self, key: str) -> int:
        if self._synchronized:
            with self._lock:
                return self._counts.get(key, 0)
        return self._counts.get(key, 0)

    def snapshot(self, keys: Iterable[str]) -> Dict[str, int]:
        if self._synchronized:
            with self._lock:
                return {key: self._counts.get(key, 0) for key in keys}
        return {key: self._counts.get(key, 0) for key in keys}


class RateLimiter:
    def __init__(self, limit_per_window: float, window_seconds: float) -> None:
        self._limit_per_window = limit_per_window
        self._window_seconds = window_seconds
        self._lock = threading.Lock()
        self._requests: Dict[str, Deque[float]] = defaultdict(deque)

    def allow(self, ip: str) -> Tuple[bool, Optional[float]]:
        if self._limit_per_window <= 0:
            return True, None

        now = time.monotonic()
        with self._lock:
            timestamps = self._requests[ip]
            cutoff = now - self._window_seconds
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            if len(timestamps) >= self._limit_per_window:
                retry_after = timestamps[0] + self._window_seconds - now
                return False, max(retry_after, 0.0)
            timestamps.append(now)
            return True, None


class HTTPServer:
    def __init__(
        self,
        directory: Path,
        host: str,
        port: int,
        workers: int,
        simulate_delay: float,
        counter: RequestCounter,
        rate_limiter: RateLimiter,
    ) -> None:
        self._root = directory.resolve()
        if not self._root.exists() or not self._root.is_dir():
            raise ValueError(f"Provided directory '{self._root}' is not a valid folder")
        self._host = host
        self._port = port
        self._workers = max(1, workers)
        self._simulate_delay = simulate_delay
        self._counter = counter
        self._rate_limiter = rate_limiter

    def serve_forever(self) -> None:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server_socket:
            server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server_socket.bind((self._host, self._port))
            server_socket.listen(128)
            print(f"Serving '{self._root}' on http://{self._host}:{self._port} with {self._workers} worker threads")

            with ThreadPoolExecutor(max_workers=self._workers) as executor:
                try:
                    while True:
                        client_conn, client_addr = server_socket.accept()
                        executor.submit(self._handle_connection, client_conn, client_addr)
                except KeyboardInterrupt:
                    print("\nShutting down server...")

    def _handle_connection(self, conn: socket.socket, addr: Tuple[str, int]) -> None:
        with conn:
            request_bytes = self._read_http_request(conn)
            if not request_bytes:
                return
            try:
                method, target, version = self._parse_request_line(request_bytes)
            except ValueError:
                body = b"400 Bad Request"
                response = self._build_response(
                    "HTTP/1.1 400 Bad Request",
                    {
                        "Content-Type": "text/plain; charset=utf-8",
                        "Content-Length": str(len(body)),
                        "Connection": "close",
                    },
                    body,
                )
                conn.sendall(response)
                return

            if method != "GET":
                body = b"405 Method Not Allowed"
                response = self._build_response(
                    "HTTP/1.1 405 Method Not Allowed",
                    {
                        "Content-Type": "text/plain; charset=utf-8",
                        "Content-Length": str(len(body)),
                        "Connection": "close",
                        "Allow": "GET",
                    },
                    body,
                )
                conn.sendall(response)
                return

            if version not in {"HTTP/1.0", "HTTP/1.1"}:
                body = b"505 HTTP Version Not Supported"
                response = self._build_response(
                    "HTTP/1.1 505 HTTP Version Not Supported",
                    {
                        "Content-Type": "text/plain; charset=utf-8",
                        "Content-Length": str(len(body)),
                        "Connection": "close",
                    },
                    body,
                )
                conn.sendall(response)
                return

            if not self._apply_rate_limit(addr[0], conn):
                return

            if self._simulate_delay > 0:
                time.sleep(self._simulate_delay)

            response = self._handle_get(target)
            conn.sendall(response)

    def _apply_rate_limit(self, ip: str, conn: socket.socket) -> bool:
        allowed, retry_after = self._rate_limiter.allow(ip)
        if allowed:
            return True
        body = b"429 Too Many Requests"
        headers = {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Length": str(len(body)),
            "Connection": "close",
        }
        if retry_after is not None:
            headers["Retry-After"] = f"{retry_after:.3f}"
        response = self._build_response("HTTP/1.1 429 Too Many Requests", headers, body)
        try:
            conn.sendall(response)
        except OSError:
            pass
        return False

    def _handle_get(self, target: str) -> bytes:
        parsed = urllib.parse.urlparse(target)
        sanitized_path = Path(urllib.parse.unquote(parsed.path.lstrip("/")))
        filesystem_path = (self._root / sanitized_path).resolve()

        if not self._ensure_within_root(filesystem_path):
            return self._not_found()

        if filesystem_path.is_dir():
            counter_key = self._counter_key_for_path(filesystem_path, is_dir=True)
            self._counter.increment(counter_key)
            body = self._build_directory_listing(filesystem_path, parsed.path or "/")
            headers = {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": str(len(body)),
                "Connection": "close",
            }
            return self._build_response("HTTP/1.1 200 OK", headers, body)

        if not filesystem_path.exists() or not filesystem_path.is_file():
            return self._not_found()

        mime_type = DEFAULT_MIME_TYPES.get(filesystem_path.suffix.lower())
        if not mime_type:
            return self._not_found()

        counter_key = self._counter_key_for_path(filesystem_path, is_dir=False)
        self._counter.increment(counter_key)

        body = filesystem_path.read_bytes()
        headers = {
            "Content-Type": mime_type,
            "Content-Length": str(len(body)),
            "Connection": "close",
        }
        return self._build_response("HTTP/1.1 200 OK", headers, body)

    def _build_directory_listing(self, directory: Path, request_path: str) -> bytes:
        entries = []
        relative_request = urllib.parse.unquote(request_path)
        if not relative_request.endswith("/"):
            relative_request += "/"

        if directory != self._root:
            parent_rel = directory.parent.relative_to(self._root).as_posix()
            parent_link = "/" if parent_rel == "." else f"/{parent_rel}/"
            entries.append(f'<li><a href="{parent_link}">..</a></li>')

        child_paths = list(sorted(directory.iterdir(), key=lambda p: (p.is_file(), p.name.lower())))
        keys_to_fetch = [self._counter_key_for_path(item, item.is_dir()) for item in child_paths]
        counts = self._counter.snapshot(keys_to_fetch)

        for item in child_paths:
            name = item.name + ("/" if item.is_dir() else "")
            relative_path = item.relative_to(self._root).as_posix()
            href = f"/{relative_path}"
            key = self._counter_key_for_path(item, item.is_dir())
            display_count = counts.get(key, 0)
            if item.is_dir():
                href += "/"
                entries.append(f'<li><a href="{href}">{name}</a> (requests: {display_count})</li>')
            else:
                count_label = f" (requests: {display_count})"
                entries.append(f'<li><a href="{href}">{name}</a>{count_label}</li>')

        current_dir_key = self._counter_key_for_path(directory, True)
        current_dir_count = self._counter.get(current_dir_key)

        body = f"""
<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <title>Index of {relative_request}</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 2rem; }}
    h1 {{ font-size: 1.5rem; }}
    ul {{ list-style-type: none; padding-left: 0; }}
    li {{ margin-bottom: 0.3rem; }}
    a {{ text-decoration: none; color: #1a73e8; }}
    a:hover {{ text-decoration: underline; }}
  </style>
</head>
<body>
  <h1>Index of {relative_request}</h1>
    <p>Requests for this directory: {current_dir_count}</p>
  <ul>
    {''.join(entries)}
  </ul>
</body>
</html>
""".strip()
        return body.encode("utf-8")

    def _not_found(self) -> bytes:
        return self._build_response(
            "HTTP/1.1 404 Not Found",
            {"Content-Type": "text/plain; charset=utf-8", "Content-Length": "13", "Connection": "close"},
            b"404 Not Found",
        )

    def _build_response(self, status_line: str, headers: Dict[str, str], body: bytes) -> bytes:
        header_lines = [status_line]
        header_lines.extend(f"{key}: {value}" for key, value in headers.items())
        response_head = CRLF.join(header_lines) + CRLF + CRLF
        return response_head.encode("ascii") + body

    def _counter_key_for_path(self, path: Path, is_dir: bool) -> str:
        try:
            relative = path.resolve().relative_to(self._root)
        except ValueError:
            return "/"

        if relative == Path("."):
            key = "/"
        else:
            key = "/" + relative.as_posix()

        if is_dir and not key.endswith("/"):
            key += "/"
        return key

    def _read_http_request(self, connection: socket.socket) -> bytes:
        data = bytearray()
        while REQUEST_TERMINATOR not in data:
            chunk = connection.recv(4096)
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > MAX_REQUEST_SIZE:
                break
        return bytes(data)

    def _parse_request_line(self, request_bytes: bytes) -> Tuple[str, str, str]:
        try:
            request_text = request_bytes.decode("iso-8859-1")
        except UnicodeDecodeError as exc:
            raise ValueError("Unable to decode HTTP request") from exc

        lines = request_text.split(CRLF)
        if not lines or len(lines[0].split()) != 3:
            raise ValueError("Malformed HTTP request line")

        method, target, version = lines[0].split()
        return method.upper(), target, version

    def _ensure_within_root(self, requested: Path) -> bool:
        try:
            requested.relative_to(self._root)
            return True
        except ValueError:
            return False


def main() -> None:
    args = parse_args()
    counter = RequestCounter(synchronized=not args.naive_counter, naive_delay=args.naive_counter_delay)
    rate_limiter = RateLimiter(limit_per_window=args.rate_limit, window_seconds=args.rate_window)
    server = HTTPServer(
        directory=args.directory,
        host=args.host,
        port=args.port,
        workers=args.workers,
        simulate_delay=args.simulate_delay,
        counter=counter,
        rate_limiter=rate_limiter,
    )
    try:
        server.serve_forever()
    except ValueError as exc:
        print(exc)
        sys.exit(1)
    except OSError as exc:
        print(f"Failed to start server: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
