# Lab 2: Concurrent HTTP File Server & Concurrency Experiments

**Student:** *Bobeica Andrei*  
**Course:** *PR*

---

## Overview

This lab extends the Lab 1 single-threaded server into a **concurrent, multi-threaded HTTP file server**. The upgraded implementation now:

- Accepts many simultaneous connections through a thread pool (`ThreadPoolExecutor`).
- Tracks requests per resource and exposes the counts directly in directory listings.
- Provides a naïve counter mode to intentionally reproduce race conditions, alongside a synchronized default mode.
- Enforces **rate limiting (~5 requests/second per client IP)** to keep the service responsive under bursts.
- Supplies `load_test.py`, a benchmark script that highlights the latency difference between the old single-threaded server and the new concurrent version.

> **Concurrency definition:** We follow the high-level PLT perspective - *concurrency is about structuring a program into independently executing components*. Parallel execution (multiple CPU cores running at once) may happen, but it is a hardware concern orthogonal to the program structure. Our Lab 2 server is therefore concurrent by design and may execute in parallel depending on machine resources.

---

## Source Code Structure

```
Lab2/
├── server.py              # Thread-pooled HTTP server with counters + rate limiting
├── load_test.py           # Concurrent GET generator for benchmarking
├── Dockerfile             # Container image that runs the threaded server
├── docker-compose.yml     # Compose stack for server + optional load tester
├── .dockerignore          # Prunes build context when building container images
├── README.md              # This guide
├── docs/
│   └── report/README.md   # Checklist of evidence to capture for the lab report
└── downloads/.gitkeep     # Placeholder so the downloads directory exists in Git
```

`server.py` is the heart of the submission; it exposes a configurable thread-pooled HTTP server with request accounting and client-side rate limiting. `load_test.py` drives controlled bursts of requests so you can document the benefit of concurrency, reproduce the naïve counter race, and observe rate limiting in action. Docker artifacts mirror the local workflow in a container-first setting, while `docs/report/README.md` outlines the artefacts to gather for the formal report.

## Concurrency vs. Parallelism

Two widely-used viewpoints coexist:

- **Systems view (OS tradition):** concurrency means tasks overlap in time (via interleaving or true simultaneity); parallelism requires simultaneous execution on multiple processors, hence parallel tasks are also concurrent.
- **Programming-languages view (PLT tradition):** concurrency is a program-structuring technique that decomposes work into independently-executing components, while parallelism is a hardware capability for simultaneous execution. These dimensions are orthogonal: a concurrent program may or may not run in parallel, and a parallel computation may lack explicit concurrency constructs.

The implementation here embraces the PLT perspective: we expose concurrency through threads so that independent requests can make progress regardless of their eventual execution schedule.

## Implementation Highlights (`server.py`)

- Thread pool (`--workers`) accepts many simultaneous connections; the default pool size equals the CPU count.
- Optional simulated per-request work (`--simulate-delay`, default `0`) highlights the contrast with Lab 1 under load.
- Request counter surfaced in directory listings. Pass `--naive-counter` (optionally `--naive-counter-delay`) to demonstrate the race condition; omit the flag to enable locking and fix the race.
- Per-client rate limiting (`--rate-limit` requests per `--rate-window` seconds, default `5`/`1s`) returns HTTP 429 when exceeded. Set `--rate-limit 0` to disable.

The counters and limiter share a common context that is safe under the default locking mode. The naïve counter mode intentionally removes the lock, letting you capture inconsistent counts for the report.

### Run Locally

```powershell
python server.py ..\Lab1\content --port 8080 --workers 8 --simulate-delay 1.0
```

Visit `http://localhost:8080/` and browse into subdirectories; the request counter column increments per resource. Capture screenshots before/after refreshing to document the working counter.

### Race Condition Demonstration

Switch to the naïve counter variant to surface the race:

```powershell
python server.py ..\Lab1\content --workers 8 --naive-counter --naive-counter-delay 0.05
```

Repeatedly refresh a directory listing or run `load_test.py` (see below) and capture the inconsistent counts. Re-run without `--naive-counter` to show the race disappears.

### Rate Limiting Walkthrough

1. Start the server with the default limiter (`~5` requests/sec):
   ```powershell
   python server.py ..\Lab1\content --port 8082 --workers 8
   ```
2. Use one terminal to exceed the limit:
   ```powershell
   python load_test.py 127.0.0.1 8082 / --requests 50 --concurrency 10 --timeout 2
   ```
3. Use another terminal to stay just under the limit (e.g., `--requests 25 --concurrency 3`). Note the difference in success rate and throughput for the report.

## Docker Workflow

Build and run the threaded server in a container (serving the Lab 1 `content/` directory):

```powershell
docker compose up --build server
```

*Explanation:* Uses `docker-compose.yml` to build the Lab 2 image and publish it on `http://localhost:8080/`. Static assets are bind-mounted read-only from `../Lab1/content`.

Launch the optional load-tester container once the server is running:

```powershell
docker compose run --rm loadtest server 8080 /
```

*Explanation:* Executes `load_test.py` inside the container to hit the running server service (reachable as `server` on the Compose network). Append additional CLI flags such as `--requests 50 --concurrency 10` to tweak the workload.

## Load generator (`load_test.py`)

`load_test.py` issues concurrent GET requests and reports aggregate timings. Launch the Lab 1 server with its `--simulate-delay` flag so both implementations spend the same time per request, then compare against the threaded Lab 2 server:

```powershell
# Lab 1 (single-threaded)

python ..\Lab1\server.py ..\Lab1\content --port 8081 --host 127.0.0.1 --simulate-delay 1.0
# in a separate shell
python load_test.py 127.0.0.1 8081 / --requests 10 --concurrency 10

# Lab 2 (threaded)
python server.py ..\Lab1\content --port 8082 --host 127.0.0.1 --simulate-delay 1.0 --workers 8 --rate-limit 0
python load_test.py 127.0.0.1 8082 / --requests 10 --concurrency 10
```

Expect the threaded server to complete ~10 requests in roughly the simulated delay, while the single-threaded version should take ~10× longer when the artificial delay is present.

Use `--timeout` to flag individual requests that exceed the allotted time, and `--total-timeout` to abort the whole load test once the overall budget is spent (remaining futures are cancelled and reported).

When you switch to the rate limiting demo, drop the `--rate-limit 0` flag (or set a concrete value) so the Lab 2 limiter is active again. Lab 1 stays unlimited; the comparison highlights how throttling affects throughput.

## Results & Comparison

Captured load-test evidence lives in `docs/report/`:

- `docs/report/lab1-load-test.png` records the single-threaded Lab 1 run: **100 requests completed in ~2.07 s**, average latency ~0.145 s, and every response returned HTTP 200. The sequential design makes total runtime roughly proportional to the simulated work per request.
![alt text](<docs/report/Screenshot 2025-10-21 231338.png>)   
- `docs/report/lab2-load-test.png` shows the concurrent Lab 2 run under the default limiter: **100 requests dispatched in ~1.02 s**, yet every response is an HTTP 429 and five requests time out. The thread pool is ready to serve work faster, but the limiter deliberately caps per-client throughput. Re-run with `--rate-limit 0` to capture unrestricted throughput and contrast it with the throttled scenario.
  ![alt text](<docs/report/Screenshot 2025-10-21 231416.png>)

These screenshots, alongside the request-counter captures, form the quantitative comparison the lab report requires. Summarize both the raw performance gain (Lab 2 outperforming Lab 1 when not rate limited) and the protective effect of the limiter when bursts exceed ~5 requests per second from a single client.

## Conclusion

Lab 2 evolves the simple Lab 1 server into a resilient concurrent service. A thread pool lifts the sequential bottleneck, the synchronized counter eliminates race conditions, and the optional naïve mode exposes the original bug for documentation. The load tester and Docker assets turn the experiments into repeatable workflows. Finally, the rate limiter ensures fairness under bursty traffic—showing how concurrency plus careful regulation can deliver both responsiveness and protection. With the gathered evidence embedded in `docs/report/`, the lab meets all functional and reporting objectives.

## Evidence Checklist

Capture the following artefacts in `docs/report/` (screenshot, log, or table as appropriate) and reference them in your formal submission:

- Directory listing that shows per-resource request counters before/after the race fix.
- Load test results comparing Lab 1 vs. Lab 2 latency under an artificial delay.
- Rate limiting traces demonstrating HTTP 429 responses once the threshold is exceeded.
- Step-by-step commands used to reproduce each experiment (include PowerShell history or snippets).
