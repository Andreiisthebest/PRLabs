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

python ..\Lab1\server.py ..\Lab1\content --port 8080 --host 127.0.0.1 --simulate-delay 1.0
# in a separate shell
python load_test.py 127.0.0.1 8080 / --requests 10 --concurrency 10

# Lab 2 (threaded)
python server.py ..\Lab1\content --port 8080 --host 127.0.0.1 --simulate-delay 1.0 --workers 8 --rate-limit 0
python load_test.py 127.0.0.1 8080 / --requests 10 --concurrency 10
```

Expect the threaded server to complete ~10 requests in roughly the simulated delay, while the single-threaded version should take ~10× longer when the artificial delay is present.

Use `--timeout` to flag individual requests that exceed the allotted time, and `--total-timeout` to abort the whole load test once the overall budget is spent (remaining futures are cancelled and reported).

When you switch to the rate limiting demo, drop the `--rate-limit 0` flag (or set a concrete value) so the Lab 2 limiter is active again. Lab 1 stays unlimited; the comparison highlights how throttling affects throughput.

## Experimental Results

### 1. Performance Comparison: Single-threaded vs Multi-threaded Server

#### 1.1 Single-threaded Server (Lab 1)

To benchmark the single-threaded server, we send 10 concurrent requests with a 1-second simulated delay per request:

```powershell
# Terminal 1: Start Lab 1 single-threaded server
python ..\Lab1\server.py ..\Lab1\content --port 8080 --host 127.0.0.1 --simulate-delay 1.0
```

```powershell
# Terminal 2: Send 10 concurrent requests
python load_test.py 127.0.0.1 8080 / --requests 10 --concurrency 10 --timeout 20
```

**Expected Result:** Since the server processes requests sequentially, 10 requests with 1-second delay each should take approximately **10 seconds** total.


![alt text](<../Lab1/docs/report/Screenshot 2025-10-25 043637.png>)

#### 1.2 Multi-threaded Server (Lab 2)

To benchmark the multi-threaded server with the same workload:

```powershell
# Terminal 1: Start Lab 2 multi-threaded server (rate limiting disabled for fair comparison)
python server.py ..\Lab1\content --port 8080 --host 127.0.0.1 --simulate-delay 1.0 --workers 8 --rate-limit 0
```

```powershell
# Terminal 2: Send 10 concurrent requests
python load_test.py 127.0.0.1 8080/ --requests 10 --concurrency 10
```

**Expected Result:** With 8 worker threads, all 10 requests can be processed concurrently, completing in approximately **1 second** total (the time of a single request).


![alt text](<../Lab1/docs/report/Screenshot 2025-10-25 042642.png>)

#### 1.3 Performance Summary

| Server Type | Requests | Concurrency | Simulated Delay | Total Time | Speedup |
|-------------|----------|-------------|-----------------|------------|---------|
| Single-threaded (Lab 1) | 10 | 10 | 1.0s | ~10s | 1x (baseline) |
| Multi-threaded (Lab 2) | 10 | 10 | 1.0s | ~1s | ~10x |

---

### 2. Hit Counter and Race Condition

#### 2.1 Triggering the Race Condition

To demonstrate the race condition in the naïve counter implementation:

```powershell
# Terminal 1: Start server with naive (unsynchronized) counter
python server.py ..\Lab1\content --port 8080--workers 8 --naive-counter --naive-counter-delay 0.05
```

```powershell
# Terminal 2: Generate concurrent requests to trigger the race
python load_test.py 127.0.0.1 8080/ --requests 50 --concurrency 10
```

Then visit `http://localhost:8080` in your browser and refresh multiple times, or check the counter in directory listings.


![alt text](<../Lab1/docs/report/Screenshot 2025-10-25 044518.png>)


**Result:** The request counter have shown only 8 request out of 50

![alt text](<../Lab1/docs/report/Screenshot 2025-10-25 044422.png>)

#### 2.2 Code Responsible for Race Condition

The naïve counter implementation in `server.py` (lines 74-82):

```python
# Naive mode: intentionally read-modify-write without a lock.
current = self._counts.get(key, 0)
if self._naive_delay > 0:
    time.sleep(self._naive_delay)  # Magnifies the race window
new_value = current + 1
self._counts[key] = new_value
```

**Problem:** Multiple threads read the same `current` value, then all increment and write back, causing lost updates.

#### 2.3 Fixed Code (Synchronized)

The corrected implementation using a lock (lines 69-72):

```python
if self._synchronized:
    with self._lock:
        self._counts[key] += 1
        return self._counts[key]
```

**Solution:** The `threading.Lock()` ensures only one thread modifies the counter at a time, preventing race conditions.


---

### 3. Rate Limiting

#### 3.1 Spam Requests Test

The rate limiter is configured to allow **5 requests per second** per client IP by default. To test this:

```powershell
# Terminal 1: Start server with default rate limiting (5 req/s)
python server.py ..\Lab1\content --port 8080--workers 8 --rate-limit 5 --rate-window 1.0
```

```powershell
# Terminal 2: Spam requests - attempting ~50 requests/second
python load_test.py 127.0.0.1 8080/ --requests 100 --concurrency 20 --timeout 2
```

**Test Configuration:**
- **Attempted rate:** ~50 requests/second (100 requests with 20 concurrent workers)
- **Allowed rate:** 5 requests/second per client
- **Expected behavior:** Most requests should be denied with HTTP 429 (Too Many Requests)

**Screenshot Placeholder:**

![alt text](<../Lab1/docs/report/Screenshot 2025-10-25 045748.png>)

#### 3.2 Response Statistics

## Conclusion

This lab demonstrates the fundamental principles and practical benefits of concurrent programming in network server design. By transforming the sequential Lab 1 HTTP server into a multi-threaded, production-ready service, we've explored three critical aspects of concurrent systems: **performance**, **correctness**, and **resource management**.

### Key Achievements

**1. Performance Through Concurrency**  
The experimental results conclusively demonstrate the power of concurrent design. Under simulated workload conditions (1-second delay per request), the multi-threaded Lab 2 server achieved approximately **10× throughput improvement** over its single-threaded predecessor. With 10 concurrent requests, Lab 1 required ~10 seconds (sequential processing), while Lab 2 completed the same workload in ~1 second by leveraging a thread pool to process requests in parallel. This validates the core principle: when work can be decomposed into independent tasks, concurrency enables dramatic performance gains by utilizing available system resources efficiently.

**2. Understanding Race Conditions**  
The request counter implementation serves as an educational tool for understanding concurrency hazards. By intentionally exposing an unsynchronized "naïve" mode, we demonstrated how race conditions arise when multiple threads access shared mutable state without proper coordination. The classic read-modify-write pattern—where threads read a counter value, increment it, and write back—resulted in lost updates when interleaved execution allowed multiple threads to read the same initial value. The fix, using `threading.Lock()`, ensures mutual exclusion: only one thread can modify the counter at any given time, guaranteeing correctness. This hands-on demonstration reinforces that **concurrency requires discipline**—shared state must be protected with appropriate synchronization primitives.

**3. Rate Limiting for Resource Protection**  
The integrated rate limiter showcases a practical defensive mechanism essential for production services. By enforcing a configurable limit (default: 5 requests/second per client IP), the server protects itself from resource exhaustion during traffic bursts or abuse scenarios. The experimental results clearly show the limiter's effectiveness: when subjected to 100 rapid requests with high concurrency, the server throttled excess traffic by returning HTTP 429 (Too Many Requests) responses, maintaining system stability while allowing legitimate traffic within the threshold. This demonstrates that **concurrency alone is insufficient**—robust services must also incorporate admission control and fairness policies to prevent any single client from monopolizing resources.

### Technical Insights

The implementation leverages Python's `ThreadPoolExecutor` from the `concurrent.futures` module, providing a high-level abstraction over thread management. The pool pattern avoids the overhead of constantly creating and destroying threads, instead maintaining a fixed pool of worker threads that process incoming connections. The sliding-window rate limiter uses a `deque` to track timestamps per client IP, pruning old entries efficiently while determining whether to accept or reject new requests—a time-efficient algorithm suitable for production use.

The Docker integration ensures reproducibility across environments, with `docker-compose.yml` orchestrating both the server and load-testing containers. This containerized workflow mirrors real-world deployment practices and provides a consistent testing platform independent of the host system configuration.

### Broader Implications

This lab illuminates the distinction between **concurrency** (program structure enabling independent progress) and **parallelism** (simultaneous execution). While Python's Global Interpreter Lock (GIL) limits true CPU-parallel execution of Python bytecode, I/O-bound operations—such as network communication—benefit significantly from threading because threads can make progress while others are blocked waiting for data. Future work could explore alternative concurrency models (async/await with `asyncio`, process-based parallelism with `multiprocessing`) to understand their trade-offs for CPU-bound versus I/O-bound workloads.

### Final Remarks

Lab 2 successfully transforms a basic sequential server into a scalable, resilient concurrent service that handles multiple clients efficiently while protecting against common pitfalls (race conditions) and abuse scenarios (rate limiting). The comprehensive testing methodology—combining load generators, controlled race condition reproduction, and comparative benchmarking—provides empirical evidence of each feature's effectiveness. The captured screenshots and metrics in `docs/report/` form a complete technical narrative, meeting all academic and practical objectives.

Moving forward, this foundation enables exploration of advanced topics: connection pooling, adaptive rate limiting based on server load, distributed rate limiting across multiple server instances, and investigation of alternative concurrency paradigms. The skills developed here—thread synchronization, performance measurement, and defensive programming—are directly applicable to real-world distributed systems engineering.

