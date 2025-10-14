"""Utility script to generate placeholder PNG and PDF assets for the HTTP file server demo."""

from __future__ import annotations

import binascii
import struct
import zlib
from pathlib import Path

ASSET_ROOT = Path(__file__).resolve().parents[1] / "content"


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    chunk = struct.pack(">I", len(data)) + chunk_type + data
    crc = binascii.crc32(chunk_type + data) & 0xFFFFFFFF
    return chunk + struct.pack(">I", crc)


def create_bookshelf_png(path: Path) -> None:
    width, height = 400, 260
    palette = [
        (99, 102, 241),  # indigo
        (79, 70, 229),   # deeper indigo
        (236, 72, 153),  # pink shelf accent
        (16, 185, 129),  # teal shelf accent
        (147, 197, 253), # sky highlight
    ]

    rows = bytearray()
    shelf_height = height // len(palette)
    for y in range(height):
        rows.append(0)  # no filter
        color = palette[(y // max(1, shelf_height)) % len(palette)]
        rows.extend(color * width)

    compressed = zlib.compress(bytes(rows), level=9)

    png_data = bytearray()
    png_data.extend(b"\x89PNG\r\n\x1a\n")
    png_data.extend(
        _png_chunk(
            b"IHDR",
            struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0),
        )
    )
    png_data.extend(_png_chunk(b"IDAT", compressed))
    png_data.extend(_png_chunk(b"IEND", b""))

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png_data)


def _escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def create_mini_pdf(path: Path, title: str, lines: list[str]) -> None:
    header = b"%PDF-1.4\n"

    escaped_lines = [_escape_pdf_text(line) for line in lines]
    stream_lines = ["BT", "/F1 22 Tf", "72 740 Td", f"({escaped_lines[0]}) Tj"]
    for line in escaped_lines[1:]:
        stream_lines.extend(["T*", f"({line}) Tj"])
    stream_lines.append("ET")
    stream_content = "\n".join(stream_lines).encode("utf-8")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream_content), stream_content),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    buffer = bytearray()
    buffer.extend(header)

    offsets: list[int] = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(buffer))
        buffer.extend(f"{index} 0 obj\n".encode("ascii"))
        buffer.extend(obj)
        buffer.extend(b"\nendobj\n")

    xref_offset = len(buffer)
    buffer.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    buffer.extend(b"0000000000 65535 f \n")
    for offset in offsets:
        buffer.extend(f"{offset:010} 00000 n \n".encode("ascii"))

    buffer.extend(
        b"trailer\n" +
        f"<< /Size {len(objects) + 1} /Root 1 0 R /Info << /Title ({_escape_pdf_text(title)}) >> >>\n".encode("ascii")
    )
    buffer.extend(f"startxref\n{xref_offset}\n%%EOF".encode("ascii"))

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(buffer))


def main() -> None:
    assets_dir = ASSET_ROOT / "assets"
    books_dir = ASSET_ROOT / "books"
    illustrated_dir = books_dir / "illustrated"

    create_bookshelf_png(assets_dir / "bookshelf.png")

    create_mini_pdf(
        books_dir / "intro-to-networking.pdf",
        "Intro to Networking",
        [
            "Intro to Networking",
            "A gentle introduction to sockets and HTTP.",
            "Perfect for your LAN book club.",
        ],
    )
    create_mini_pdf(
        books_dir / "latency-patterns.pdf",
        "Latency Patterns",
        [
            "Latency Patterns",
            "Collected notes on caching, queues, and service meshes.",
            "Short enough to read over coffee.",
        ],
    )
    create_mini_pdf(
        illustrated_dir / "retro-computing.pdf",
        "Retro Computing Sketchbook",
        [
            "Retro Computing Sketchbook",
            "Doodles of terminals, waveforms, and bold typography.",
            "Because art should be buffered, too.",
        ],
    )
    create_bookshelf_png(illustrated_dir / "micro-gallery.png")


if __name__ == "__main__":
    main()
