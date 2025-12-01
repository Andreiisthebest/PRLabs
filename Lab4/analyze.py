import os
import time
import requests
import concurrent.futures
import statistics
import subprocess
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt

LEADER = os.getenv("LEADER_ADDR", "http://localhost:8000")


def write_once(key, value):
    start = time.time()
    try:
        r = requests.post(LEADER + "/set", json={"key": key, "value": value}, timeout=10)
        return time.time() - start
    except Exception as e:
        print(f"Error writing key {key}: {e}")
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


def restart_leader_with_quorum(quorum):
    """Restart leader container with new WRITE_QUORUM value"""
    print(f"Restarting leader with WRITE_QUORUM={quorum}...")
    try:
        # Set environment variable and restart
        env = os.environ.copy()
        env['WRITE_QUORUM'] = str(quorum)
        subprocess.run(['docker-compose', 'up', '-d', '--force-recreate', 'leader'], 
                      env=env, check=True, capture_output=True)
        # Wait for leader to be ready
        time.sleep(5)
        # Verify leader is responding
        for attempt in range(10):
            try:
                r = requests.get(LEADER + "/dump", timeout=2)
                if r.status_code == 200:
                    print(f"Leader ready with quorum={quorum}")
                    return True
            except:
                time.sleep(2)
        return False
    except Exception as e:
        print(f"Error restarting leader: {e}")
        return False


def measure_for_quorum(quorum):
    print(f"\n{'='*60}")
    print(f"Testing WRITE_QUORUM = {quorum}")
    print(f"{'='*60}")
    
    # Run batch and measure total time
    start_time = time.time()
    latencies = run_batch_concurrent(100, concurrency=10)
    total_time = time.time() - start_time
    
    if latencies:
        avg_latency = statistics.mean(latencies)
        stdev_latency = statistics.stdev(latencies) if len(latencies) > 1 else 0
        print(f"Completed 100 writes in {total_time:.2f}s")
        print(f"Average latency: {avg_latency:.3f}s")
        print(f"Std dev: {stdev_latency:.3f}s")
        return total_time, avg_latency, stdev_latency
    else:
        print("No successful writes!")
        return total_time, 0, 0


def main():
    quorums = [1, 2, 3, 4, 5]
    total_times = []
    averages = []
    stdevs = []
    
    print("Starting performance analysis...")
    print("This will automatically restart the leader for each quorum value.\n")
    
    for q in quorums:
        if not restart_leader_with_quorum(q):
            print(f"Failed to restart leader with quorum={q}, skipping...")
            continue
        
        total_time, avg, sd = measure_for_quorum(q)
        total_times.append(total_time)
        averages.append(avg)
        stdevs.append(sd)
    
    # Create figure with two subplots
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
    
    # Plot 1: Total time for 100 writes
    ax1.bar(quorums[:len(total_times)], total_times, color='steelblue', alpha=0.7)
    ax1.set_xlabel('Write Quorum', fontsize=12)
    ax1.set_ylabel('Total Time for 100 Writes (s)', fontsize=12)
    ax1.set_title('Total Execution Time vs Write Quorum', fontsize=13, fontweight='bold')
    ax1.grid(True, alpha=0.3)
    ax1.set_xticks(quorums[:len(total_times)])
    for i, (q, t) in enumerate(zip(quorums[:len(total_times)], total_times)):
        ax1.text(q, t, f'{t:.1f}s', ha='center', va='bottom', fontsize=10)
    
    # Plot 2: Average latency per write
    ax2.errorbar(quorums[:len(averages)], averages, yerr=stdevs, 
                 marker='o', markersize=8, linewidth=2, capsize=5, color='darkgreen')
    ax2.set_xlabel('Write Quorum', fontsize=12)
    ax2.set_ylabel('Average Write Latency (s)', fontsize=12)
    ax2.set_title('Average Latency vs Write Quorum', fontsize=13, fontweight='bold')
    ax2.grid(True, alpha=0.3)
    ax2.set_xticks(quorums[:len(averages)])
    
    plt.tight_layout()
    
    # Save with absolute path
    output_path = os.path.join(os.getcwd(), 'results.png')
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()
    
    print('\n' + '='*60)
    print(f'Analysis complete! Saved plots to: {output_path}')
    print('='*60)
    
    # Verify file exists
    if os.path.exists(output_path):
        print(f'✓ File saved successfully ({os.path.getsize(output_path)} bytes)')
    else:
        print('✗ Warning: File was not saved!')


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nAnalysis interrupted by user")
    except Exception as e:
        print(f"\nError during analysis: {e}")
        import traceback
        traceback.print_exc()
