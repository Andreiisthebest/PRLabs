import os
import time
import concurrent.futures
import requests

LEADER = os.getenv("LEADER_ADDR", "http://localhost:8000")


def write_key(key, value):
    start = time.time()
    r = requests.post(LEADER + "/set", json={"key": key, "value": value})
    latency = time.time() - start
    return r.status_code, r.json() if r.content else {}, latency


def run_concurrent_writes(n=10, keys_prefix="k"):
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        futures = []
        for i in range(n):
            key = f"{keys_prefix}_{i%10}"
            futures.append(ex.submit(write_key, key, f"v_{i}"))
        for f in concurrent.futures.as_completed(futures):
            results.append(f.result())
    return results


def main():
    print("Running 10 concurrent writes to leader")
    res = run_concurrent_writes(10)
    for status, body, lat in res:
        print(status, body, f"{lat:.3f}s")


if __name__ == "__main__":
    main()
