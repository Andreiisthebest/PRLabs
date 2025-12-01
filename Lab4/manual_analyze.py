"""
Manual analysis script - run this after manually changing WRITE_QUORUM in docker-compose.yml
This avoids the Docker restart complexity and matplotlib bugs.

Usage:
1. Edit docker-compose.yml and set WRITE_QUORUM=1
2. Run: docker-compose up -d --force-recreate leader
3. Run: python manual_analyze.py 1
4. Repeat for quorum values 2,3,4,5
5. After all runs, execute: python manual_analyze.py plot
"""

import os
import sys
import time
import json
import requests
import concurrent.futures
import statistics


LEADER = os.getenv("LEADER_ADDR", "http://localhost:8000")
RESULTS_FILE = "quorum_results.json"


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


def measure_quorum(quorum_value):
    print("=" * 60)
    print(f"Testing WRITE_QUORUM = {quorum_value}")
    print("=" * 60)
    
    # Check leader
    try:
        r = requests.get(LEADER + "/dump", timeout=2)
        print(f"✓ Leader is responding")
    except Exception as e:
        print(f"✗ Cannot connect to leader: {e}")
        return None
    
    # Run test
    print(f"\nRunning 100 concurrent writes...")
    start_time = time.time()
    latencies = run_batch_concurrent(100, concurrency=10)
    total_time = time.time() - start_time
    
    if not latencies:
        print("✗ No successful writes!")
        return None
    
    avg = statistics.mean(latencies)
    stdev = statistics.stdev(latencies) if len(latencies) > 1 else 0
    
    print(f"\n✓ Completed {len(latencies)} writes in {total_time:.2f}s")
    print(f"  Average latency: {avg:.3f}s")
    print(f"  Std dev: {stdev:.3f}s")
    print(f"  Min: {min(latencies):.3f}s")
    print(f"  Max: {max(latencies):.3f}s")
    
    return {
        "quorum": quorum_value,
        "total_time": total_time,
        "avg_latency": avg,
        "stdev": stdev,
        "count": len(latencies)
    }


def save_result(result):
    # Load existing results
    if os.path.exists(RESULTS_FILE):
        with open(RESULTS_FILE, 'r') as f:
            results = json.load(f)
    else:
        results = []
    
    # Update or append
    found = False
    for i, r in enumerate(results):
        if r["quorum"] == result["quorum"]:
            results[i] = result
            found = True
            break
    if not found:
        results.append(result)
    
    # Save
    with open(RESULTS_FILE, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\n✓ Result saved to {RESULTS_FILE}")


def plot_results():
    if not os.path.exists(RESULTS_FILE):
        print(f"✗ No results file found: {RESULTS_FILE}")
        return
    
    with open(RESULTS_FILE, 'r') as f:
        results = json.load(f)
    
    if not results:
        print("✗ No results to plot")
        return
    
    # Sort by quorum
    results.sort(key=lambda x: x["quorum"])
    
    quorums = [r["quorum"] for r in results]
    total_times = [r["total_time"] for r in results]
    avg_latencies = [r["avg_latency"] for r in results]
    stdevs = [r["stdev"] for r in results]
    
    print(f"\nPlotting {len(results)} results...")
    
    # Use minimal matplotlib to avoid deepcopy bug
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    
    # Create separate figures (don't reuse)
    # Figure 1: Total time
    fig1 = plt.figure(figsize=(7, 5))
    ax1 = fig1.add_subplot(111)
    ax1.bar(quorums, total_times, color='steelblue', alpha=0.7)
    ax1.set_xlabel('Write Quorum', fontsize=12)
    ax1.set_ylabel('Total Time for 100 Writes (s)', fontsize=12)
    ax1.set_title('Total Execution Time vs Write Quorum', fontsize=13, fontweight='bold')
    ax1.grid(True, alpha=0.3)
    ax1.set_xticks(quorums)
    for q, t in zip(quorums, total_times):
        ax1.text(q, t, f'{t:.1f}s', ha='center', va='bottom', fontsize=10)
    
    output1 = os.path.join(os.getcwd(), 'total_time_vs_quorum.png')
    fig1.savefig(output1, dpi=150, bbox_inches='tight')
    plt.close(fig1)
    print(f"✓ Saved: {output1}")
    
    # Figure 2: Average latency
    fig2 = plt.figure(figsize=(7, 5))
    ax2 = fig2.add_subplot(111)
    ax2.errorbar(quorums, avg_latencies, yerr=stdevs, 
                 marker='o', markersize=8, linewidth=2, capsize=5, color='darkgreen')
    ax2.set_xlabel('Write Quorum', fontsize=12)
    ax2.set_ylabel('Average Write Latency (s)', fontsize=12)
    ax2.set_title('Average Latency vs Write Quorum', fontsize=13, fontweight='bold')
    ax2.grid(True, alpha=0.3)
    ax2.set_xticks(quorums)
    
    output2 = os.path.join(os.getcwd(), 'avg_latency_vs_quorum.png')
    fig2.savefig(output2, dpi=150, bbox_inches='tight')
    plt.close(fig2)
    print(f"✓ Saved: {output2}")
    
    print("\n" + "=" * 60)
    print("Analysis complete!")
    print("=" * 60)


def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python manual_analyze.py <quorum_value>  - Run test for specific quorum")
        print("  python manual_analyze.py plot            - Plot all collected results")
        return
    
    arg = sys.argv[1]
    
    if arg.lower() == 'plot':
        plot_results()
    else:
        try:
            quorum = int(arg)
            if quorum < 1 or quorum > 5:
                print("Quorum value must be between 1 and 5")
                return
            
            result = measure_quorum(quorum)
            if result:
                save_result(result)
                print(f"\nNext: Change WRITE_QUORUM to {quorum+1}, restart leader, and run:")
                print(f"  python manual_analyze.py {quorum+1}")
        except ValueError:
            print(f"Invalid argument: {arg}")


if __name__ == "__main__":
    main()
