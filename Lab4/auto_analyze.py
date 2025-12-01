"""
Automated analysis script - automatically tests all quorum values 1-5
This script handles Docker container restarts automatically.
"""

import os
import sys
import time
import json
import subprocess
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


def restart_leader_with_quorum(quorum_value):
    """Restart leader container with specified quorum"""
    print(f"\nRestarting leader with WRITE_QUORUM={quorum_value}...")
    
    try:
        # Set environment variable and restart using PowerShell syntax
        env = os.environ.copy()
        env['WRITE_QUORUM'] = str(quorum_value)
        
        # Use docker-compose with environment variable
        cmd = ['docker-compose', 'up', '-d', '--force-recreate', '--no-deps', 'leader']
        result = subprocess.run(cmd, env=env, capture_output=True, text=True, cwd=os.getcwd())
        
        if result.returncode != 0:
            print(f"Error restarting leader: {result.stderr}")
            return False
        
        # Wait for leader to be ready
        print("Waiting for leader to be ready...")
        time.sleep(8)
        
        # Verify leader is responding
        for attempt in range(15):
            try:
                r = requests.get(LEADER + "/dump", timeout=2)
                if r.status_code == 200:
                    print(f"✓ Leader ready with WRITE_QUORUM={quorum_value}")
                    return True
            except:
                time.sleep(2)
        
        print("✗ Leader did not start properly")
        return False
        
    except Exception as e:
        print(f"Error: {e}")
        return False


def measure_quorum(quorum_value):
    print("\n" + "=" * 60)
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
    print(f"\nRunning 200 concurrent writes...")
    start_time = time.time()
    latencies = run_batch_concurrent(200, concurrency=10)
    total_time = time.time() - start_time
    
    if not latencies:
        print("✗ No successful writes!")
        return None
    
    avg = statistics.mean(latencies)
    stdev = statistics.stdev(latencies) if len(latencies) > 1 else 0
    
    median = statistics.median(latencies)
    print(f"\n✓ Completed {len(latencies)} writes in {total_time:.2f}s")
    print(f"  Average latency: {avg:.3f}s")
    print(f"  Median latency: {median:.3f}s")
    print(f"  Std dev: {stdev:.3f}s")
    print(f"  Min: {min(latencies):.3f}s")
    print(f"  Max: {max(latencies):.3f}s")
    
    return {
        "quorum": quorum_value,
        "total_time": total_time,
        "avg_latency": avg,
        "stdev": stdev,
        "count": len(latencies),
        "latencies": latencies,
    }


def plot_results(results):
    """Generate plots from results"""
    if not results:
        print("✗ No results to plot")
        return
    
    # Sort by quorum
    results.sort(key=lambda x: x["quorum"])
    
    quorums = [r["quorum"] for r in results]
    avg_latencies = [r["avg_latency"] for r in results]
    
    # Calculate medians from raw latencies
    medians = []
    for r in results:
        lats = r.get("latencies", [])
        if lats:
            medians.append(statistics.median(lats))
        else:
            medians.append(0)
    
    print(f"\nGenerating plot for {len(results)} results...")
    
    # Use minimal matplotlib to avoid deepcopy bug in Python 3.14
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    
    # Disable all tight layout features that trigger deepcopy
    plt.rcParams['figure.autolayout'] = False
    plt.rcParams['figure.constrained_layout.use'] = False
    
    # Calculate linear regression trend lines
    x = np.array(quorums)
    
    # Average trend line
    y_avg = np.array(avg_latencies)
    z_avg = np.polyfit(x, y_avg, 1)
    p_avg = np.poly1d(z_avg)
    r2_avg = 1 - (np.sum((y_avg - p_avg(x))**2) / np.sum((y_avg - np.mean(y_avg))**2))
    
    # Median trend line
    y_med = np.array(medians)
    z_med = np.polyfit(x, y_med, 1)
    p_med = np.poly1d(z_med)
    r2_med = 1 - (np.sum((y_med - p_med(x))**2) / np.sum((y_med - np.mean(y_med))**2))
    
    # Single plot: Average and Median latency with trend lines
    fig, ax = plt.subplots(figsize=(10, 6))
    
    # Data points and lines
    ax.plot(quorums, avg_latencies, marker='o', markersize=10, linewidth=0, 
            color='steelblue', label=f'Average Latency (R²={r2_avg:.3f})', zorder=5)
    ax.plot(quorums, medians, marker='s', markersize=10, linewidth=0, 
            color='darkorange', label=f'Median Latency (R²={r2_med:.3f})', zorder=5)
    
    # Trend lines
    ax.plot(x, p_avg(x), '--', linewidth=2, color='steelblue', alpha=0.6, zorder=3)
    ax.plot(x, p_med(x), '--', linewidth=2, color='darkorange', alpha=0.6, zorder=3)
    
    ax.set_xlabel('Write Quorum', fontsize=12, fontweight='bold')
    ax.set_ylabel('Write Latency (s)', fontsize=12, fontweight='bold')
    ax.set_title('Average and Median Latency vs Write Quorum (Linear Trend)', fontsize=14, fontweight='bold')
    ax.grid(True, alpha=0.3)
    ax.set_xticks(quorums)
    ax.legend(fontsize=10, loc='best')
    
    output = os.path.join(os.getcwd(), 'latency_vs_quorum.png')
    fig.savefig(output, dpi=150, format='png')
    plt.close(fig)
    del fig, ax
    print(f"✓ Saved: {output}")
    print(f"  Average trend: y = {z_avg[0]:.4f}x + {z_avg[1]:.4f} (R²={r2_avg:.3f})")
    print(f"  Median trend: y = {z_med[0]:.4f}x + {z_med[1]:.4f} (R²={r2_med:.3f})")


def main():
    print("=" * 60)
    print("AUTOMATED QUORUM ANALYSIS")
    print("=" * 60)
    print("Testing write quorum values: 1, 2, 3, 4, 5")
    print("This will automatically restart the leader for each value.\n")
    
    quorums = [1, 2, 3, 4, 5]
    all_results = []
    
    for q in quorums:
        # Restart leader with new quorum
        if not restart_leader_with_quorum(q):
            print(f"Skipping quorum={q} due to restart failure")
            continue
        
        # Measure performance
        result = measure_quorum(q)
        if result:
            all_results.append(result)
        
        # Small delay between tests
        time.sleep(2)
    
    # Save results
    if all_results:
        with open(RESULTS_FILE, 'w') as f:
            json.dump(all_results, f, indent=2)
        print(f"\n✓ Results saved to {RESULTS_FILE}")
        
        # Generate plots
        plot_results(all_results)
        
        print("\n" + "=" * 60)
        print("ANALYSIS COMPLETE!")
        print("=" * 60)
        print(f"Generated files:")
        print(f"  - {RESULTS_FILE}")
        print(f"  - latency_vs_quorum.png")
    else:
        print("\n✗ No successful measurements")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInterrupted by user")
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
