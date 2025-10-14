import argparse
import os
import socket
import sys
from pathlib import Path
from typing import Dict, Tuple
import urllib.parse

CRLF = "\r\n"
BUFFER_SIZE = 4096


class HttpResponse:
    def __init__(self, status_line: str, headers: Dict[str, str], body: bytes) -> None:
        self.status_line = status_line
        self.headers = headers
        self.body = body

    @property
    def status(self) -> Tuple[int, str]:
        parts = self.status_line.split(" ", 2)
        if len(parts) < 2:
            raise ValueError("Malformed status line")
        code = int(parts[1])
        reason = parts[2] if len(parts) > 2 else ""
        return code, reason

    def header(self, name: str, default: str = "") -> str:
        return self.headers.get(name.lower(), default)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Minimal HTTP client for the companion PDF web server."
    )
    parser.add_argument("server_host", help="Hostname or IP address of the server")
    parser.add_argument("server_port", type=int, help="Port number the server listens on")
    parser.add_argument("url_path", help="Path to request (e.g., /books/intro.pdf)")
    parser.add_argument(
        "directory",
        type=Path,
        help="Directory where downloaded files (PNG/PDF) should be stored",
    )
    return parser.parse_args()


def make_request(host: str, port: int, path: str) -> HttpResponse:
    normalized_path = path if path.startswith("/") else f"/{path}"
    normalized_path = urllib.parse.urlsplit(normalized_path).path or "/"

    request_lines = [
        f"GET {normalized_path} HTTP/1.1",
        f"Host: {host}:{port}",
        "User-Agent: CozyPDFClient/1.0",
        "Connection: close",
        "",
        "",
    ]
    request_data = CRLF.join(request_lines).encode("ascii")

    with socket.create_connection((host, port)) as sock:
        sock.sendall(request_data)
        response_bytes = bytearray()
        while True:
            chunk = sock.recv(BUFFER_SIZE)
            if not chunk:
                break
            response_bytes.extend(chunk)

    header_end = response_bytes.find(b"\r\n\r\n")
    if header_end == -1:
        raise ValueError("Incomplete HTTP response")

    header_blob = response_bytes[:header_end].decode("iso-8859-1")
    body = bytes(response_bytes[header_end + 4 :])
    header_lines = header_blob.split(CRLF)
    status_line = header_lines[0]
    headers: Dict[str, str] = {}
    for line in header_lines[1:]:
        if not line:
            continue
        if ":" not in line:
            continue
        name, value = line.split(":", 1)
        headers[name.lower().strip()] = value.strip()

    return HttpResponse(status_line, headers, body)


def save_binary(body: bytes, destination_dir: Path, filename_hint: str) -> Path:
    destination_dir.mkdir(parents=True, exist_ok=True)
    filename = filename_hint or "downloaded-file"
    target = destination_dir / filename
    counter = 1
    while target.exists():
        stem, suffix = os.path.splitext(filename)
        target = destination_dir / f"{stem}_{counter}{suffix}"
        counter += 1
    target.write_bytes(body)
    return target


def handle_html(response: HttpResponse) -> None:
    content_type = response.header("content-type", "text/html; charset=utf-8")
    charset = "utf-8"
    if "charset=" in content_type:
        charset = content_type.split("charset=")[-1].split(";")[0].strip()
    sys.stdout.write(response.body.decode(charset, errors="replace"))


def handle_binary(response: HttpResponse, target_dir: Path, path: str) -> None:
    filename_hint = Path(path).name
    saved_path = save_binary(response.body, target_dir, filename_hint)
    print(f"Saved {saved_path.name} ({len(response.body)} bytes) to {saved_path.parent}")


def main() -> None:
    args = parse_args()

    try:
        response = make_request(args.server_host, args.server_port, args.url_path)
    except (OSError, ValueError) as exc:
        print(f"Request failed: {exc}", file=sys.stderr)
        sys.exit(1)

    status_code, reason = response.status
    if status_code != 200:
        print(f"Server responded with {status_code} {reason}", file=sys.stderr)
        sys.exit(status_code)

    content_type = response.header("content-type").lower()
    if content_type.startswith("text/html"):
        handle_html(response)
    elif content_type.startswith("image/png"):
        handle_binary(response, args.directory, args.url_path)
    elif content_type.startswith("application/pdf"):
        handle_binary(response, args.directory, args.url_path)
    else:
        print(
            f"Unhandled content type '{content_type}'. Nothing saved.",
            file=sys.stderr,
        )
        sys.exit(2)


if __name__ == "__main__":
    main()
