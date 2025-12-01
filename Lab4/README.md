# Lab4 — Distributed Key-Value Store with Single-Leader Replication

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Implementation Details](#implementation-details)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Getting Started](#getting-started)
- [Running Tests](#running-tests)
- [Performance Analysis](#performance-analysis)
- [Data Consistency](#data-consistency)
- [Versioning & Race Conditions](#versioning--race-conditions)
- [Code Examples](#code-examples)
- [Troubleshooting](#troubleshooting)

## Overview

This project implements a **distributed key-value store** with single-leader replication, demonstrating fundamental concepts in distributed systems:

### Core Features
- ✅ **Single-leader architecture**: Only the leader accepts client writes
- ✅ **Semi-synchronous replication**: Configurable quorum for write durability
- ✅ **Network simulation**: Random delays to simulate real-world conditions
- ✅ **Versioning system**: Prevents race conditions from out-of-order messages
- ✅ **Concurrent processing**: Async I/O for high throughput
- ✅ **Docker containerization**: Easy deployment and scaling

### System Components
- **1 Leader** (port 8000) — Accepts writes, coordinates replication
- **5 Followers** (ports 8001-8005) — Store replicas, serve reads
- **Web API** — RESTful JSON interface for all operations
- **Performance tools** — Automated testing and analysis scripts

## Architecture

### High-Level Design

```
                          Client Application
                                 │
                                 │ HTTP POST /set
                                 ▼
                         ┌───────────────┐
                         │  Leader:8000  │
                         │  (Accepts     │
                         │   Writes)     │
                         └───────┬───────┘
                                 │
                    ┌────────────┼────────────┐
                    │ Concurrent Replication  │
                    │  (Random Delay Per      │
                    │   Follower)             │
                    └────────────┬────────────┘
                                 │
         ┌───────────────────────┴───────────────────────┐
         │                                               │
    Waits for WRITE_QUORUM confirmations         Returns success
         │                                         to client when
         ▼                                         quorum reached
    ┌────┴────┬────────┬────────┬────────┬────────┐
    ▼         ▼        ▼        ▼        ▼        ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│  F1    │ │  F2    │ │  F3    │ │  F4    │ │  F5    │
│ :8001  │ │ :8002  │ │ :8003  │ │ :8004  │ │ :8005  │
└────────┘ └────────┘ └────────┘ └────────┘ └────────┘
```

### Write Flow

1. **Client** sends write request to leader
2. **Leader** increments version number and writes locally
3. **Leader** sends concurrent replication requests to all 5 followers
4. **Network delay** applied per follower (random in [MIN_DELAY, MAX_DELAY])
5. **Followers** accept if version > current version (reject stale writes)
6. **Leader** waits for WRITE_QUORUM confirmations
7. **Leader** returns success/failure to client

### Read Flow

- Reads can go to **any node** (leader or followers)
- Returns both **value** and **version** number
- Followers may have slightly stale data (eventual consistency)

## Implementation Details

### Server Architecture (`server.py`)

The server uses **FastAPI** for async web framework and **httpx** for async HTTP client:

```python
# In-memory store structure
store: Dict[str, Dict[str, Any]] = {}
# Example: {"mykey": {"value": "myvalue", "version": 5}}
```

**Key Design Decisions:**

1. **Versioning**: Each key has a version counter that increments with every write
2. **Async replication**: Uses `asyncio.create_task()` for concurrent follower updates
3. **Quorum waiting**: Uses `asyncio.as_completed()` to return as soon as quorum is reached
4. **Stale write rejection**: Followers compare incoming version with current version

### Replication Logic

**Leader's `set_value` endpoint:**
```python
@app.post("/set")
async def set_value(req: SetRequest):
    # 1. Increment version
    current_version = store.get(req.key, {}).get("version", 0)
    new_version = current_version + 1
    
    # 2. Write locally first
    store[req.key] = {"value": req.value, "version": new_version}
    
    # 3. Create concurrent replication tasks
    tasks = [replicate_to_follower(url, key, value, version) 
             for url in FOLLOWERS]
    
    # 4. Wait for WRITE_QUORUM confirmations
    confirmations = 0
    for coro in asyncio.as_completed(tasks):
        if await coro:
            confirmations += 1
        if confirmations >= WRITE_QUORUM:
            break
    
    # 5. Return success if quorum reached
    return {"ok": confirmations >= WRITE_QUORUM}
```

**Follower's `replicate` endpoint:**
```python
@app.post("/replicate")
async def replicate(req: ReplicateRequest):
    current = store.get(req.key)
    
    # Only apply if version is newer (prevents race conditions)
    if current is None or req.version > current["version"]:
        store[req.key] = {"value": req.value, "version": req.version}
        return {"ok": True, "applied": True}
    else:
        return {"ok": True, "applied": False}  # Rejected stale write
```

## Environment Variables

All configuration is managed through environment variables in `docker-compose.yml`:

| Variable | Description | Default | Example | Used By |
|----------|-------------|---------|---------|---------|
| `ROLE` | Server role | `follower` | `leader`, `follower` | All |
| `PORT` | HTTP port | `8000` | `8001`, `8002` | All |
| `FOLLOWERS` | Follower URLs | - | `follower1:8001,follower2:8002,...` | Leader |
| `WRITE_QUORUM` | Confirmations needed | `1` | `3` (wait for 3 followers) | Leader |
| `MIN_DELAY` | Min replication delay (ms) | `0` | `50` (50ms minimum) | Leader |
| `MAX_DELAY` | Max replication delay (ms) | `1000` | `500` (max 500ms) | Leader |
| `REPL_TIMEOUT` | HTTP timeout (seconds) | `5.0` | `10.0` | Leader |

**Configuration in `docker-compose.yml`:**
```yaml
services:
  leader:
    environment:
      - ROLE=leader
      - PORT=8000
      - WRITE_QUORUM=${WRITE_QUORUM:-1}  # Default: 1
      - MIN_DELAY=${MIN_DELAY:-0}         # Default: 0ms
      - MAX_DELAY=${MAX_DELAY:-1000}      # Default: 1000ms
      - FOLLOWERS=follower1:8001,follower2:8002,follower3:8003,follower4:8004,follower5:8005
```

**How to change quorum at runtime:**
```powershell
# Option 1: Set environment variable and restart leader
$env:WRITE_QUORUM=3
docker-compose up -d --force-recreate --no-deps leader

# Option 2: Edit docker-compose.yml and restart
docker-compose up -d
```

## API Reference

### POST /set
Write a key-value pair (leader only).

**Request:**
```json
{
  "key": "username",
  "value": "alice"
}
```

**Response:**
```json
{
  "ok": true,
  "confirmations": 3,
  "required": 3,
  "version": 1
}
```

**Fields:**
- `ok`: `true` if quorum reached, `false` otherwise
- `confirmations`: Number of followers that confirmed
- `required`: Required quorum size (WRITE_QUORUM)
- `version`: Version number assigned to this write

**Example:**
```powershell
curl -X POST http://localhost:8000/set `
  -H "Content-Type: application/json" `
  -d '{"key":"user:123","value":"Alice"}'
```

### POST /replicate
Replicate a write from leader (followers only, called internally).

**Request:**
```json
{
  "key": "username",
  "value": "alice",
  "version": 1
}
```

**Response:**
```json
{
  "ok": true,
  "applied": true
}
```

**Fields:**
- `applied`: `true` if write was accepted (version > current), `false` if rejected as stale

### GET /get/{key}
Read a value and its version.

**Response:**
```json
{
  "key": "username",
  "value": "alice",
  "version": 1
}
```

**Example:**
```powershell
curl http://localhost:8000/get/user:123
```

### GET /dump
Get all keys in the store.

**Response:**
```json
{
  "username": {"value": "alice", "version": 1},
  "email": {"value": "alice@example.com", "version": 2}
}
```

**Example:**
```powershell
# Check leader's data
curl http://localhost:8000/dump

# Check follower's data
curl http://localhost:8001/dump
```

## Getting Started

### Prerequisites
- Docker Desktop installed
- Python 3.9+ installed
- PowerShell (Windows) or Bash (Linux/Mac)

### Step 1: Build and Start the System

```powershell
# Build images and start all containers
docker-compose up --build -d
```

**What happens:**
- Builds Docker image with Python and dependencies
- Starts 6 containers: 1 leader + 5 followers
- Leader listens on port 8000
- Followers listen on ports 8001-8005

**Wait 5-10 seconds** for services to initialize.

### Step 2: Verify Services are Running

```powershell
# Check container status
docker-compose ps

# Expected output:
# NAME            STATUS    PORTS
# lab4-leader-1   Up        0.0.0.0:8000->8000/tcp
# lab4-follower1-1  Up      0.0.0.0:8001->8001/tcp
# ...
```

### Step 3: Test Basic Operations

```powershell
# Write a key
curl -X POST http://localhost:8000/set `
  -H "Content-Type: application/json" `
  -d '{"key":"test","value":"hello world"}'

# Output: {"ok":true,"confirmations":1,"required":1,"version":1}

# Read from leader
curl http://localhost:8000/get/test
# Output: {"key":"test","value":"hello world","version":1}

# Read from follower (should have replicated)
curl http://localhost:8001/get/test
# Output: {"key":"test","value":"hello world","version":1}
```

### Step 4: View All Data

```powershell
# View leader's entire store
curl http://localhost:8000/dump

# View follower's store
curl http://localhost:8001/dump
```

## Running Tests

### Integration Test

Tests basic concurrent write functionality:

```powershell
cd Lab4
python test/integration_test.py
```

**What it does:**
- Writes 100 keys concurrently (10 threads)
- Verifies leader returns success for all writes
- Checks write latency

**Expected output:**
```
Testing concurrent writes...
Completed 100 writes in 2.45s
Average latency: 0.245s
✓ All writes successful
```

### Race Condition Test

Verifies versioning prevents race conditions:

```powershell
python test_race_condition.py
```

**What it tests:**

1. **Sequential Writes**: 10 sequential writes, all nodes should reach version 10
2. **Concurrent Writes**: 20 concurrent writes to same key, all nodes converge to same version
3. **Out-of-Order Detection**: Verifies stale writes are rejected

**Expected output:**
```
======================================================================
TEST SUMMARY
======================================================================
  Sequential Writes: ✓ PASSED
  Concurrent Writes: ✓ PASSED
  Out-of-Order Detection: ✓ PASSED

✓ All tests passed! Versioning system is working correctly.
```

### Consistency Verification

Checks all replicas have matching data:

```powershell
python verify_consistency.py
```

**What it does:**
- Dumps data from leader
- Dumps data from all 5 followers
- Compares keys, values, and versions
- Reports any inconsistencies

**Expected output:**
```
Checking consistency across 6 nodes...

Comparing follower1:8001 with leader...
  ✓ All keys match
  ✓ All values match
  ✓ All versions match

[... same for other followers ...]

✓ All followers are consistent with leader!
```

## Performance Analysis

### Running the Analysis

```powershell
python auto_analyze.py
```

**What it does:**
- Tests quorum values from 1 to 5 automatically
- For each quorum: restarts leader, runs 200 concurrent writes
- Measures latency statistics (avg, median, stdev)
- Generates visualization with linear trend lines
- Saves raw data to `quorum_results.json`

**Output:**
```
============================================================
AUTOMATED QUORUM ANALYSIS
============================================================
Testing write quorum values: 1, 2, 3, 4, 5

Restarting leader with WRITE_QUORUM=1...
✓ Leader ready with WRITE_QUORUM=1

============================================================
Testing WRITE_QUORUM = 1
============================================================
✓ Leader is responding

Running 200 concurrent writes...

✓ Completed 200 writes in 6.21s
  Average latency: 0.306s
  Median latency: 0.269s
  Std dev: 0.209s

[... repeats for quorum 2-5 ...]

✓ Saved: latency_vs_quorum.png
  Average trend: y = 0.1412x + 0.1402 (R²=0.989)
  Median trend: y = 0.1600x + 0.0840 (R²=0.992)
```

### Understanding the Results

**Graph Components:**
- **Blue line**: Average latency with trend line
- **Orange line**: Median latency with trend line
- **Dashed lines**: Linear regression fit
- **R² values**: Goodness of fit (closer to 1.0 = more linear)

**Sample Results:**
```
Quorum | Avg Latency | Median | Explanation
-------|-------------|--------|-------------
  1    |   0.306s    | 0.269s | Wait for fastest follower
  2    |   0.411s    | 0.392s | Wait for 2nd fastest
  3    |   0.538s    | 0.534s | Wait for 3rd fastest
  4    |   0.693s    | 0.722s | Wait for 4th fastest
  5    |   0.871s    | 0.904s | Wait for all followers
```

### Why Latency Increases Linearly

**The Math:**
```
Latency = MIN_DELAY + (waiting for Nth fastest follower)

With quorum=1: Return as soon as min(delays) arrives
With quorum=3: Return as soon as 3rd-smallest delay arrives
With quorum=5: Return when max(delays) arrives
```

**Visualization:**
```
Followers:  F1    F2    F3    F4    F5
Delays:     50ms  200ms 400ms 700ms 900ms

Quorum=1: ✓ Return at 50ms  (wait for F1)
Quorum=3: ⏳ Wait... ✓ Return at 400ms (F3 confirms)
Quorum=5: ⏳ Wait... ⏳ Wait... ✓ Return at 900ms (F5 confirms)
```

**Key Insight:**
The random delay range [MIN_DELAY, MAX_DELAY] creates variance. Higher quorum = must wait for slower followers = higher average latency.

**Linear Trend:**
With our test configuration (200 writes, random delays 0-1000ms), we observe:
- **Latency ≈ 0.14 × quorum + 0.14** seconds
- **R² ≈ 0.99** (nearly perfect linear fit)

This confirms the theoretical expectation: **latency increases linearly with quorum size**.

## Data Consistency

### Consistency Model

**Semi-synchronous Replication:**
```
Write Flow:
1. Leader writes locally
2. Leader sends to all 5 followers concurrently
3. Leader waits for WRITE_QUORUM confirmations
4. Leader returns SUCCESS if quorum reached

Result:
- At least WRITE_QUORUM followers have the data
- Remaining followers may still be replicating
- Eventually all followers receive the update (eventual consistency)
```

**Trade-offs:**

| Quorum | Durability | Latency | Use Case |
|--------|------------|---------|----------|
| 1 | Low (1 copy) | Fast | Development, non-critical data |
| 2 | Medium (2 copies) | Medium | Read-heavy workloads |
| 3 | High (3 copies) | Medium | Balanced durability/performance |
| 4 | Very High | Slow | Important data |
| 5 | Maximum | Slowest | Critical data requiring full redundancy |

### Versioning Mechanism

**Problem:** Network delays can cause out-of-order message delivery

**Example Without Versioning:**
```
Time  Event
------|-----------------------------------------------------
t=0   | Leader: Write key="count", value=1
t=1   | Leader: Write key="count", value=2
t=2   | Follower receives value=2 (fast network path)
t=3   | Follower receives value=1 (delayed message arrives)
t=4   | Follower has WRONG value=1 (should be 2)
```

**Solution: Version Numbers**
```
Time  Event
------|-----------------------------------------------------
t=0   | Leader: Write key="count", value=1, version=1
t=1   | Leader: Write key="count", value=2, version=2
t=2   | Follower receives (value=2, version=2) → Accept ✓
t=3   | Follower receives (value=1, version=1) → Reject ✗
      |   (version=1 < current version=2)
t=4   | Follower has CORRECT value=2, version=2
```

**Implementation:**
```python
# Follower's replicate endpoint
@app.post("/replicate")
async def replicate(req: ReplicateRequest):
    current = store.get(req.key)
    
    # Accept only if version is NEWER
    if current is None or req.version > current["version"]:
        store[req.key] = {"value": req.value, "version": req.version}
        return {"ok": True, "applied": True}
    else:
        # Reject stale write
        return {"ok": True, "applied": False}
```

### Testing Consistency

Run the consistency checker:
```powershell
python verify_consistency.py
```

**What it checks:**
1. All keys present on leader also exist on followers
2. All values match between leader and followers
3. All version numbers match

**Sample Output:**
```
Checking consistency across 6 nodes...

Leader store:
  user:1 → {"value": "Alice", "version": 5}
  user:2 → {"value": "Bob", "version": 3}

Comparing follower1:8001 with leader...
  ✓ Keys: {user:1, user:2}
  ✓ Values match for all keys
  ✓ Versions match for all keys

[... checks all 5 followers ...]

======================================================================
CONSISTENCY REPORT
======================================================================
✓ All 5 followers are consistent with leader
✓ Total keys checked: 2
✓ No discrepancies found

Explanation:
With semi-synchronous replication (quorum=1), the leader waits for
at least 1 follower confirmation. Other followers receive updates
concurrently. The versioning system ensures that even if messages
arrive out-of-order due to network delays, only the newest version
is applied, maintaining consistency.
```

## Versioning & Race Conditions

### Race Condition Scenarios

**Scenario 1: Concurrent Writes**
```python
# Two clients write to same key simultaneously
Client A: POST /set {"key": "counter", "value": 10}
Client B: POST /set {"key": "counter", "value": 20}

# Without versioning: Last write wins (non-deterministic)
# With versioning: Both writes get unique version numbers
Result: 
  Client A → version=1
  Client B → version=2
  Final value: 20, version=2 (higher version wins)
```

**Scenario 2: Network Delay**
```python
# Write sequence with network delays
t=0: Leader writes (value=1, version=1)
t=1: Leader writes (value=2, version=2)

# Follower A: Receives messages in order
  → Applies version=1, then version=2 ✓

# Follower B: Delayed network, reversed order
  → Receives version=2 first → Applies ✓
  → Receives version=1 second → REJECTS (1 < 2) ✓
  
Result: All followers converge to version=2
```

### Testing Race Conditions

```powershell
python test_race_condition.py
```

**Test 1: Sequential Writes**
```
Purpose: Verify version increments correctly
Process: 
  1. Write key 10 times sequentially
  2. Check all nodes have version=10

Expected: ✓ All nodes reach version=10
```

**Test 2: Concurrent Writes**
```
Purpose: Verify versioning handles concurrent updates
Process:
  1. 20 threads write same key concurrently
  2. Check all nodes converge to same version

Expected: ✓ All nodes have version=20 (or higher)
Ensures: No lost updates, all writes counted
```

**Test 3: Out-of-Order Detection**
```
Purpose: Verify stale writes are rejected
Process:
  1. Establish baseline (5 writes → version=5)
  2. Wait for full replication
  3. Perform one more write (→ version=6)
  4. Check all nodes at version=6

Expected: ✓ All nodes advance from version=5 to version=6
Ensures: No node accepts stale (older) version
```

## Code Examples

### Example 1: Simple Write and Read

```powershell
# Write a user profile
curl -X POST http://localhost:8000/set `
  -H "Content-Type: application/json" `
  -d '{"key":"user:alice","value":"Alice Johnson"}'

# Response
{
  "ok": true,
  "confirmations": 1,
  "required": 1,
  "version": 1
}

# Read from leader
curl http://localhost:8000/get/user:alice

# Response
{
  "key": "user:alice",
  "value": "Alice Johnson",
  "version": 1
}
```

### Example 2: Multiple Updates (Versioning)

```powershell
# First write
curl -X POST http://localhost:8000/set `
  -H "Content-Type: application/json" `
  -d '{"key":"counter","value":1}'
# Response: {"ok":true,"version":1}

# Second write (same key)
curl -X POST http://localhost:8000/set `
  -H "Content-Type: application/json" `
  -d '{"key":"counter","value":2}'
# Response: {"ok":true,"version":2}

# Read current version
curl http://localhost:8000/get/counter
# Response: {"key":"counter","value":2,"version":2}
```

### Example 3: Testing Different Quorums

```powershell
# Start with quorum=1 (fast)
$env:WRITE_QUORUM=1
docker-compose up -d --force-recreate --no-deps leader

# Measure write latency
Measure-Command {
  curl -X POST http://localhost:8000/set `
    -H "Content-Type: application/json" `
    -d '{"key":"test1","value":"data"}'
}
# TotalMilliseconds: ~300ms

# Change to quorum=5 (slow but durable)
$env:WRITE_QUORUM=5
docker-compose up -d --force-recreate --no-deps leader

# Measure write latency again
Measure-Command {
  curl -X POST http://localhost:8000/set `
    -H "Content-Type: application/json" `
    -d '{"key":"test2","value":"data"}'
}
# TotalMilliseconds: ~900ms
```

### Example 4: Python Client

```python
import requests
import concurrent.futures

LEADER = "http://localhost:8000"

def write_key(key, value):
    """Write to distributed store"""
    response = requests.post(
        f"{LEADER}/set",
        json={"key": key, "value": value},
        timeout=10
    )
    return response.json()

def read_key(key):
    """Read from distributed store"""
    response = requests.get(f"{LEADER}/get/{key}", timeout=5)
    return response.json()

# Single write
result = write_key("user:bob", "Bob Smith")
print(f"Write result: {result}")
# Output: {'ok': True, 'confirmations': 1, 'required': 1, 'version': 1}

# Concurrent writes
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    futures = []
    for i in range(100):
        future = executor.submit(write_key, f"key_{i}", f"value_{i}")
        futures.append(future)
    
    # Wait for all writes
    results = [f.result() for f in concurrent.futures.as_completed(futures)]
    successful = sum(1 for r in results if r['ok'])
    print(f"Completed {successful}/100 writes")

# Read values
data = read_key("key_42")
print(f"Key: {data['key']}, Value: {data['value']}, Version: {data['version']}")
```

### Example 5: Monitoring Replication

```powershell
# Write to leader
curl -X POST http://localhost:8000/set `
  -H "Content-Type: application/json" `
  -d '{"key":"monitor","value":"test123"}'

# Check all nodes (leader + 5 followers)
foreach ($port in 8000..8005) {
    Write-Host "`nNode :$port"
    curl http://localhost:$port/get/monitor
}

# Expected output:
# Node :8000
# {"key":"monitor","value":"test123","version":1}
#
# Node :8001
# {"key":"monitor","value":"test123","version":1}
# ...
# (All nodes should show same value and version)
```

## Troubleshooting

### Issue: Leader won't start

**Symptom:**
```
docker-compose ps
# leader status: Restarting
```

**Solution:**
```powershell
# Check logs
docker-compose logs leader

# Common causes:
# 1. Port 8000 already in use
netstat -ano | findstr :8000

# 2. Invalid environment variables
# Check docker-compose.yml syntax

# 3. Restart all services
docker-compose down
docker-compose up -d
```

### Issue: Writes fail (ok: false)

**Symptom:**
```json
{"ok": false, "confirmations": 0, "required": 3, "version": 5}
```

**Meaning:** Leader couldn't reach WRITE_QUORUM followers

**Solutions:**
```powershell
# 1. Check followers are running
docker-compose ps

# 2. Reduce quorum temporarily
$env:WRITE_QUORUM=1
docker-compose up -d --force-recreate --no-deps leader

# 3. Check follower logs
docker-compose logs follower1

# 4. Increase replication timeout
# Edit docker-compose.yml: REPL_TIMEOUT=10.0
```

### Issue: Inconsistent data across nodes

**Symptom:**
```
python verify_consistency.py
✗ follower3 has different value for key 'test'
```

**Cause:** Race condition or replication lag

**Solutions:**
```powershell
# 1. Wait longer for replication
Start-Sleep -Seconds 10
python verify_consistency.py

# 2. Check if versioning is working
python test_race_condition.py

# 3. Restart all services (clears state)
docker-compose down
docker-compose up -d
```

### Issue: High latency

**Symptom:** Writes taking >2 seconds

**Causes:**
```
1. High MAX_DELAY setting
2. High WRITE_QUORUM requiring slow followers
3. Network issues
```

**Solutions:**
```powershell
# Reduce network delay simulation
$env:MAX_DELAY=100  # Max 100ms instead of 1000ms
docker-compose up -d --force-recreate --no-deps leader

# Reduce quorum
$env:WRITE_QUORUM=1
docker-compose up -d --force-recreate --no-deps leader
```

### Issue: Auto-analyze fails

**Symptom:**
```
Error: Cannot connect to leader
```

**Solutions:**
```powershell
# 1. Ensure containers are running
docker-compose ps

# 2. Check leader is responding
curl http://localhost:8000/dump

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Run with verbose output
python auto_analyze.py
```

---

## Quick Reference

**Start system:**
```powershell
docker-compose up -d
```

**Write key:**
```powershell
curl -X POST http://localhost:8000/set -H "Content-Type: application/json" -d '{"key":"k","value":"v"}'
```

**Read key:**
```powershell
curl http://localhost:8000/get/k
```

**Change quorum:**
```powershell
$env:WRITE_QUORUM=3; docker-compose up -d --force-recreate --no-deps leader
```

**Run tests:**
```powershell
python test_race_condition.py
```

**Performance analysis:**
```powershell
python auto_analyze.py
```

**Stop system:**
```powershell
docker-compose down
```
