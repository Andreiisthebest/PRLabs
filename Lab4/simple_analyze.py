import os
import time
import requests
import concurrent.futures
import statistics
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

LEADER = os.getenv("LEADER_ADDR", "http://localhost:8000")


def write_once(key, value):
    start = time.time()
    try:
        r = requests.post(LEADER + "/set", json={"key": key, "value": value}, timeout=10)
        return time.time() - start
    except Exception as e:
        print(f"Error: {e}")
        return None


def run_batch_concurrent(total=100, concurrency=10):
    latencies = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = []
        for i in range(total):
            key = f"k_{i%10}"
            futures.append(ex.submit(write_once, key, f"v_{i}"))
        for f in concurrent.futures.as_completed(futures):
            result = f.result()
            if result is not None:
                latencies.append(result)
    return latencies


def main():
    print("=" * 60)
    print("Testing current WRITE_QUORUM setting")
    print("=" * 60)
    
    # Check if leader is responding
    try:
        r = requests.get(LEADER + "/dump", timeout=2)
        print(f"✓ Leader is responding (status: {r.status_code})")
    except Exception as e:
        print(f"✗ Cannot connect to leader: {e}")
        print("Make sure containers are running: docker-compose up -d")
        return
    
    # Run test
    print("\nRunning 100 concurrent writes...")
    start_time = time.time()
    latencies = run_batch_concurrent(100, concurrency=10)
    total_time = time.time() - start_time
    
    if not latencies:
        print("✗ No successful writes! Check if leader is accepting requests.")
        return
    
    print(f"\n✓ Completed {len(latencies)} writes in {total_time:.2f}s")
    print(f"  Average latency: {statistics.mean(latencies):.3f}s")
    print(f"  Min latency: {min(latencies):.3f}s")
    print(f"  Max latency: {max(latencies):.3f}s")
    
    # Create histogram
    plt.figure(figsize=(10, 6))
    plt.hist(latencies, bins=30, color='steelblue', alpha=0.7, edgecolor='black')
    plt.xlabel('Write Latency (s)', fontsize=12)
    plt.ylabel('Frequency', fontsize=12)
    plt.title(f'Distribution of Write Latencies\n(Total: {len(latencies)} writes, Avg: {statistics.mean(latencies):.3f}s)', 
              fontsize=13, fontweight='bold')
    plt.grid(True, alpha=0.3)
    
    output_path = os.path.join(os.getcwd(), 'latency_distribution.png')
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()
    
    if os.path.exists(output_path):
        print(f"\n✓ Graph saved to: {output_path}")
        print(f"  File size: {os.path.getsize(output_path)} bytes")
    else:
        print("\n✗ Failed to save graph")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted by user")
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
