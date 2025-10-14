import argparse
import socket
import sys
from pathlib import Path
from typing import Dict, Tuple
import urllib.parse

ALLOWED_MIME_TYPES: Dict[str, str] = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".png": "image/png",
    ".pdf": "application/pdf",
}

PHOTO_GALLERY_KEYWORDS = {"illustrated"}

CRLF = "\r\n"
REQUEST_TERMINATOR = f"{CRLF}{CRLF}".encode("ascii")
MAX_REQUEST_SIZE = 16 * 1024  # 16 KB should be plenty for simple GET requests

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Lightweight HTTP file server supporting HTML, PNG, and PDF content."
    )
    parser.add_argument(
        "directory",
        type=Path,
        help="Root directory whose contents should be exposed over HTTP",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host interface to bind to (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="TCP port to listen on (default: 8080)",
    )
    return parser.parse_args()

def build_response(status_line: str, headers: Dict[str, str], body: bytes) -> bytes:
    header_lines = [status_line]
    for key, value in headers.items():
        header_lines.append(f"{key}: {value}")
    response_head = CRLF.join(header_lines) + REQUEST_TERMINATOR.decode("ascii")
    return response_head.encode("ascii") + body

def read_http_request(connection: socket.socket) -> bytes:
    data = bytearray()
    while REQUEST_TERMINATOR not in data:
        chunk = connection.recv(4096)
        if not chunk:
            break
        data.extend(chunk)
        if len(data) > MAX_REQUEST_SIZE:
            break
    return bytes(data)

def parse_request_line(request_bytes: bytes) -> Tuple[str, str, str]:
    try:
        request_text = request_bytes.decode("iso-8859-1")
    except UnicodeDecodeError:
        raise ValueError("Unable to decode HTTP request")

    lines = request_text.split(CRLF)
    if not lines or len(lines[0].split()) != 3:
        raise ValueError("Malformed HTTP request line")

    method, target, version = lines[0].split()
    return method.upper(), target, version

def ensure_within_root(root: Path, requested: Path) -> bool:
    try:
        requested.relative_to(root)
        return True
    except ValueError:
        return False

def guess_mime_type(path: Path) -> str:
    return ALLOWED_MIME_TYPES.get(path.suffix.lower(), "")


def should_force_download(root: Path, path: Path) -> bool:
    if path.suffix.lower() != ".pdf":
        return False
    try:
        relative = path.resolve().relative_to(root)
    except ValueError:
        return False
    return any(part.lower() in PHOTO_GALLERY_KEYWORDS for part in relative.parts)

def build_directory_listing(root: Path, directory: Path, request_path: str) -> bytes:
    entries = []
    relative_request = urllib.parse.unquote(request_path)
    if not relative_request.endswith('/'):
        relative_request += '/'

    if directory != root:
        parent_rel = (directory.parent.relative_to(root)).as_posix()
        parent_link = "/" if parent_rel == "." else f"/{parent_rel}/"
        entries.append(f'<li><a href="{parent_link}">..</a></li>')

    for item in sorted(directory.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
        name = item.name + ("/" if item.is_dir() else "")
        relative_path = item.relative_to(root).as_posix()
        href = f"/{relative_path}"
        if item.is_dir():
            href += "/"
            entries.append(f'<li><a href="{href}">{name}</a></li>')
        else:
            force_download = should_force_download(root, item)
            if force_download:
                entries.append(f'<li><a href="{href}" download="{item.name}">{name}</a></li>')
            else:
                entries.append(f'<li><a href="{href}">{name}</a></li>')

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
  <ul>
    {''.join(entries)}
  </ul>
</body>
</html>
""".strip()
    return body.encode("utf-8")

def handle_get(root: Path, target: str) -> bytes:
    parsed = urllib.parse.urlparse(target)
    sanitized_path = Path(urllib.parse.unquote(parsed.path.lstrip("/")))
    filesystem_path = (root / sanitized_path).resolve()

    if not ensure_within_root(root, filesystem_path):
        return build_response(
            "HTTP/1.1 404 Not Found",
            {"Content-Type": "text/plain; charset=utf-8", "Content-Length": "13", "Connection": "close"},
            b"404 Not Found",
        )

    if filesystem_path.is_dir():
        body = build_directory_listing(root, filesystem_path, parsed.path or "/")
        headers = {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": str(len(body)),
            "Connection": "close",
        }
        return build_response("HTTP/1.1 200 OK", headers, body)

    if not filesystem_path.exists() or not filesystem_path.is_file():
        return build_response(
            "HTTP/1.1 404 Not Found",
            {"Content-Type": "text/plain; charset=utf-8", "Content-Length": "13", "Connection": "close"},
            b"404 Not Found",
        )

    mime_type = guess_mime_type(filesystem_path)
    if not mime_type:
        return build_response(
            "HTTP/1.1 404 Not Found",
            {"Content-Type": "text/plain; charset=utf-8", "Content-Length": "13", "Connection": "close"},
            b"404 Not Found",
        )

    body = filesystem_path.read_bytes()
    force_download = should_force_download(root, filesystem_path)
    headers = {
        "Content-Type": mime_type,
        "Content-Length": str(len(body)),
        "Connection": "close",
    }
    if force_download:
        headers["Content-Disposition"] = f'attachment; filename="{filesystem_path.name}"'
    return build_response("HTTP/1.1 200 OK", headers, body)

def handle_client(connection: socket.socket, address: Tuple[str, int], root: Path) -> None:
    request_bytes = read_http_request(connection)
    if not request_bytes:
        return
    try:
        method, target, version = parse_request_line(request_bytes)
    except ValueError:
        response = build_response(
            "HTTP/1.1 400 Bad Request",
            {"Content-Type": "text/plain; charset=utf-8", "Content-Length": "15", "Connection": "close"},
            b"400 Bad Request",
        )
        connection.sendall(response)
        return

    if method != "GET":
        response = build_response(
            "HTTP/1.1 405 Method Not Allowed",
            {
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Length": "23",
                "Connection": "close",
                "Allow": "GET",
            },
            b"405 Method Not Allowed",
        )
        connection.sendall(response)
        return

    if version not in {"HTTP/1.0", "HTTP/1.1"}:
        response = build_response(
            "HTTP/1.1 505 HTTP Version Not Supported",
            {"Content-Type": "text/plain; charset=utf-8", "Content-Length": "29", "Connection": "close"},
            b"505 HTTP Version Not Supported",
        )
        connection.sendall(response)
        return

    response = handle_get(root, target)
    connection.sendall(response)

def run_server(directory: Path, host: str, port: int) -> None:
    root = directory.resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError(f"Provided directory '{root}' is not a valid folder")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server_socket:
        server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server_socket.bind((host, port))
        server_socket.listen(5)
        print(f"Serving '{root}' on http://{host}:{port}")

        while True:
            try:
                client_conn, client_addr = server_socket.accept()
            except KeyboardInterrupt:
                print("\nShutting down server...")
                break
            with client_conn:
                handle_client(client_conn, client_addr, root)


def main() -> None:
    args = parse_args()
    try:
        run_server(args.directory, args.host, args.port)
    except ValueError as exc:
        print(exc)
        sys.exit(1)
    except OSError as exc:
        print(f"Failed to start server: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
