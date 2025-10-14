# Lab 1 – Cozy HTTP Bookshelf

A tiny HTTP/1.1 file server and matching client for sharing a curated shelf of PDFs, PNG art, and HTML. The goal is to mimic the behavior of Python's built-in `http.server` while keeping the implementation approachable and well-documented.

---

## Project layout

```
Lab1/
├── client.py                 # Command-line HTTP client companion
├── server.py                 # Single-threaded HTTP file server
├── content/                  # Demo website (HTML + PNG + PDFs)
│   ├── index.html            # Landing page referencing the bookshelf art
│   ├── assets/
│   │   └── bookshelf.png     # Hero illustration used on the homepage
│   └── books/                # Library of downloadable files (nested allowed)
│       ├── intro-to-networking.pdf
│       ├── latency-patterns.pdf
│       └── illustrated/
│           ├── micro-gallery.png
│           └── retro-computing.pdf
└── scripts/
    └── generate_assets.py    # Utility to regenerate the placeholder artwork
```

This tree highlights the main Python entry points alongside the static content and helper scripts included in the project.



---

## Running the server

1. Activate the repo's virtual environment.
2. Start the server by pointing it at the directory you want to publish:

   ```powershell
   python server.py content --port 8080
   ```

  *Explanation:* Runs the HTTP server against the `content` directory while listening on port 8080.

   * `--host` defaults to `0.0.0.0` so the server is reachable from your LAN.
   * `--port` defaults to `8080`. Override it if the port is occupied.

3. Visit `http://localhost:8080/` (or swap in your machine's LAN IP) to browse.

  ### Run the stack with Docker Compose

  Prefer containers? The included `docker-compose.yml` spins up both the server and an optional client image. Build the images and launch the server service:

  ```powershell
  docker compose up --build server
  ```

  *Explanation:* Builds the image if needed and starts the `server` service for containerized testing.

  * The server listens on port `8080` by default; override it with `-p 9090:8080` if needed.
  * Static content lives in the bind-mounted `content/` folder, so editing files on the host updates the container instantly.
  * Downloads produced by the client land in the shared `downloads/` directory.

  When you're done, stop the stack:

  ```powershell
  docker compose down
  ```

  *Explanation:* Stops the running stack and removes the Compose-managed network.

  #### Use the client container

  You can run the bundled client image against the server container without installing Python locally. The following command fetches a PDF from the server service and saves it in `downloads/` on the host:

  ```powershell
  docker compose run --rm client server 8080 /books/latency-patterns.pdf /downloads
  ```

  *Explanation:* Runs the client inside Docker to pull the PDF into the shared `downloads/` folder, then exits.

  Replace `/books/latency-patterns.pdf` with any path the server exposes. The hostname `server` refers to the server service on the Compose network; point it at a friend's machine by swapping in their IP/hostname instead.

### Features

- Serves HTML, PNG, and PDF files.
- Prevents directory traversal and returns `404 Not Found` for missing or unsupported files.
- Generates elegant directory listings for nested folders when a directory path is requested.
- Treats photo gallery PDFs (anything inside `content/books/illustrated/`) as downloadable attachments so clicking them saves a copy automatically.

---

## Using the client

Fetch files or listings directly from the terminal. The client understands the same content types as the server.

```powershell
python client.py <server_host> <server_port> <url_path> <download_directory>
```

Run this command to connect to the server, fetch the specified path, and either print or save the response based on its content type.
*Explanation:* The client dispatches a GET request and handles HTML versus binary content automatically based on headers.

Examples:

- Print the homepage HTML to the console:

  ```powershell
  python client.py localhost 8080 / content
  ```

  *Explanation:* Prints the homepage HTML directly in the terminal so you can verify the rendered markup.

- Download a PDF into your local `content/books` folder:

  ```powershell
  python client.py localhost 8080 /books/latency-patterns.pdf content/books
  ```

  *Explanation:* Downloads the PDF and saves it into your local `content/books` directory for offline reading.

- Save the illustrated gallery PNG to the nested directory (directories are created automatically):

  ```powershell
  python client.py localhost 8080 /books/illustrated/micro-gallery.png content/books/illustrated
  ```

  *Explanation:* Pulls the PNG asset into the illustrated subfolder so the local tree matches the server’s layout.

The client logic:

| Content type           | Behavior                                   |
| ---------------------- | ------------------------------------------- |
| `text/html`            | Body is printed to `stdout` exactly as sent |
| `image/png`, `application/pdf` | Bytes are saved to the target directory |

Errors (like `404 Not Found`) surface on `stderr` and set a non-zero exit code.

---

## Trade books with a friend

Want a new PDF for your shelf? Point the client at a friend's machine on the same network and save the response directly into your own `content/` directory:

```powershell
python client.py 192.168.1.42 8080 /books/zine-of-the-month.pdf content/books
```

*Explanation:* Targets a friend's LAN server by IP address and drops the shared PDF into your own library.

The file is downloaded and ready to serve from your own instance—refresh your browser to see it appear instantly in the directory listing.

---

## Regenerating demo assets

The placeholder artwork and PDFs were generated with pure-Python code so that everything stays self-contained. Rerun the helper whenever you want fresh copies:

```powershell
python scripts/generate_assets.py
```

*Explanation:* Recreates all placeholder PDFs and PNGs so the repository stays self-contained.

Feel free to swap in your own artwork or lecture notes; the server will automatically pick them up.

---

## Lab report evidence checklist

Use the following artifacts to demonstrate each requirement. Swap or trim sections as needed for your final submission.

1. **Source directory overview**  
   ```text
   Lab1/
   ├── .dockerignore
   ├── Dockerfile
   ├── README.md
   ├── client.py
   ├── content/
   │   ├── assets/
   │   │   └── bookshelf.png
   │   ├── books/
   │   │   ├── AA Tournament requirements part 2.pdf
   │   │   ├── CryptoLab.pdf
   │   │   ├── Lab2_Crypto.pdf
   │   │   ├── Timesheet#4.pdf
   │   │   └── illustrated/
   │   │       └── micro-gallery.png
   │   └── index.html
   ├── docker-compose.yml
   ├── docs/
   │   └── report/
  │       └── README.md
  ├── downloads/
   ├── scripts/
   │   └── generate_assets.py
   └── server.py
   ```
  *Explanation:* Captures every deliverable bundled with the lab, from code to content and documentation.

2. **Container assets**  
   `Dockerfile`
   ```dockerfile
   # syntax=docker/dockerfile:1.6
   FROM python:3.13-slim AS runtime

   ENV PYTHONDONTWRITEBYTECODE=1 \
       PYTHONUNBUFFERED=1

   WORKDIR /app

   COPY server.py client.py ./
   COPY content ./content
   COPY scripts ./scripts

   EXPOSE 8080

   CMD ["python", "server.py", "content", "--host", "0.0.0.0", "--port", "8080"]
   ```
  *Explanation:* Installs Python 3.13, copies the app files, and sets the default command to run the server from `content`.

   `docker-compose.yml`
   ```yaml
   services:
     server:
       build: .
       container_name: cozy-bookshelf
       ports:
         - "8080:8080"
       volumes:
         - ./content:/app/content
         - ./downloads:/downloads
       command: ["python", "server.py", "content", "--host", "0.0.0.0", "--port", "8080"]
     client:
       build: .
       entrypoint: ["python", "client.py"]
       profiles: ["client"]
       volumes:
         - ./downloads:/downloads
       working_dir: /app
   ```
  *Explanation:* Defines both services and mounts so containerized runs stay in sync with the host filesystem.

3. **Starting the container stack**  
   ```powershell
   docker compose -f Lab1/docker-compose.yml up --build server
   ```
  *Explanation:* Builds the image if needed and starts the bookshelf server inside Docker for local testing.

   Expected log tail once the server is ready:
   ```text
   cozy-bookshelf  | Serving '/app/content' on http://0.0.0.0:8080
   cozy-bookshelf  | 127.0.0.1 - - [14/Oct/2025 19:05:12] "GET / HTTP/1.1" 200 -
   ```
  *Explanation:* Confirms the container booted, logged the GET request, and is serving traffic.

4. **Server command inside the container**  
   The Compose service launches the same command baked into the image:
   ```yaml
   command: ["python", "server.py", "content", "--host", "0.0.0.0", "--port", "8080"]
   ```
  *Explanation:* Mirrors the image’s default entrypoint so Compose runs match standalone containers.

   ```dockerfile
   CMD ["python", "server.py", "content", "--host", "0.0.0.0", "--port", "8080"]
   ```
  *Explanation:* Aligns standalone container executions with the same parameters used by Compose.

5. **Contents of the served directory**  
   ```text
   content/
   ├── assets/
  │   └── bookshelf.png
  ├── books/
   │   ├── AA Tournament requirements part 2.pdf
   │   ├── CryptoLab.pdf
   │   ├── Lab2_Crypto.pdf
   │   ├── Timesheet#4.pdf
   │   └── illustrated/
   │       └── micro-gallery.png
   └── index.html
   ```
  *Explanation:* Confirms the server exposes an HTML landing page, four PDFs, and a nested illustrated PNG resource.

6. **Browser requests (four cases)**  
   ```powershell
   curl -i http://localhost:8080/missing.pdf
   ```
  *Explanation:* Intentionally requests a missing resource to demonstrate the server's 404 handling.
   ```http
   HTTP/1.1 404 Not Found
   Content-Type: text/plain; charset=utf-8
   Content-Length: 13
   Connection: close

   404 Not Found
   ```
  *Explanation:* Shows the server returns the correct 404 headers and body for missing files.

   ```powershell
   curl -i http://localhost:8080/
   ```
  *Explanation:* Fetches the homepage so you can capture the HTML response and embedded image reference.
   ```http
   HTTP/1.1 200 OK
   Content-Type: text/html; charset=utf-8
   Content-Length: 2125
   Connection: close

   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="utf-8" />
     <title>My PDF Library</title>
     <style>
       body { font-family: Arial, sans-serif; background: #f6f9fc; color: #1f2933; margin: 0; padding: 0; }
       ...
   ```
  *Explanation:* Highlights the 200 status plus the HTML markup browsers render as the landing page.

   ```powershell
   curl -I "http://localhost:8080/books/AA%20Tournament%20requirements%20part%202.pdf"
   ```
  *Explanation:* Demonstrates that PDF assets are served with the correct MIME type and size.
   ```http
   HTTP/1.1 200 OK
   Content-Type: application/pdf
   Content-Length: 258639
   Connection: close
   ```
  *Explanation:* Verifies the server reports both the PDF length and the `application/pdf` content type.

   ```powershell
   curl -I http://localhost:8080/books/illustrated/micro-gallery.png
   ```
  *Explanation:* Confirms the PNG is exposed correctly with its MIME type and length.
   ```http
   HTTP/1.1 200 OK
   Content-Type: image/png
   Content-Length: 755
   Connection: close
   ```
  *Explanation:* Shows the server returning the correct byte length and `image/png` header for the image.

7. **Client usage**  
   ```powershell
   python client.py localhost 8080 \
       "/books/AA%20Tournament%20requirements%20part%202.pdf" downloads
   ```
  *Explanation:* Exercises the client script against the local server and saves the PDF into the `downloads` folder.

   Console output:
   ```text
   Saved AA Tournament requirements part 2.pdf (258639 bytes) to downloads
   ```
  *Explanation:* Confirms the client received the file and persisted it with the expected byte count.

   Verify the saved artifact:
   ```powershell
   Get-ChildItem downloads
   ```
  *Explanation:* Proves the downloaded file landed on disk where it can be inspected.
   ```text
       Directory: C:\path\to\repo\Lab1\downloads

   Mode                 LastWriteTime         Length Name
   ----                 -------------         ------ ----
   -a---         2025-10-14  19:07:18        258639 AA Tournament requirements part 2.pdf
   ```
  *Explanation:* Shows the retrieved PDF alongside its size and timestamp for grading evidence.

8. **Directory listing page**  
   Requesting `/books/` produces HTML generated by `server.py`:
   ```http
   HTTP/1.1 200 OK
   Content-Type: text/html; charset=utf-8

   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="utf-8" />
     <title>Index of /books/</title>
     <style>
       body { font-family: Arial, sans-serif; margin: 2rem; }
       ...
   ```
  *Explanation:* Proves the custom directory listing renders friendly HTML when browsing folders.

   Subdirectory `/books/illustrated/`:
   ```http
   HTTP/1.1 200 OK
   Content-Type: text/html; charset=utf-8

   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="utf-8" />
     <title>Index of /books/illustrated/</title>
     ...
   ```
  *Explanation:* Confirms nested folders inherit the same templated listing experience.

9. **Browsing a friend's server (bonus)**  
   Not completed yet. Include IP discovery notes, screenshots, and client output here if you perform the optional network exchange.


---

## Next steps

- Add MIME types beyond HTML, PNG, and PDF.
- Serve byte ranges to support resumed downloads.
- Explore TLS termination with a reverse proxy for secure sharing.
