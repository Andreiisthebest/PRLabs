"""
Automated analysis script for distributed key-value store.

Usage:
  python auto_analyze.py              # Test all quorums 1-5 (restarts leader)
  python auto_analyze.py --simple     # Test current quorum only (no restart)
  python auto_analyze.py --verify     # Just verify consistency (no writes)
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
FOLLOWERS = [
    "http://localhost:8001",
    "http://localhost:8002",
    "http://localhost:8003",
    "http://localhost:8004",
    "http://localhost:8005",
]
RESULTS_FILE = "quorum_results.json"


def verify_consistency():
    """Check if all followers have consistent data with the leader"""
    print("\n" + "-" * 60)
    print("CONSISTENCY VERIFICATION")
    print("-" * 60)
    
    try:
        # Get leader data
        leader_resp = requests.get(LEADER + "/dump", timeout=5)
        if leader_resp.status_code != 200:
            print("✗ Failed to get leader data")
            return None
        
        leader_data = leader_resp.json()
        leader_keys = set(leader_data.keys())
        print(f"Leader has {len(leader_keys)} keys")
        
        # Get follower data
        follower_data = []
        for follower_url in FOLLOWERS:
            try:
                resp = requests.get(follower_url + "/dump", timeout=5)
                if resp.status_code == 200:
                    follower_data.append((follower_url, resp.json()))
                else:
                    print(f"✗ Failed to get data from {follower_url}")
                    follower_data.append((follower_url, None))
            except Exception as e:
                print(f"✗ Error connecting to {follower_url}: {e}")
                follower_data.append((follower_url, None))
        
        # Compare each follower with leader
        inconsistencies = []
        all_consistent = True
        
        for follower_url, data in follower_data:
            port = follower_url.split(":")[-1]
            
            if data is None:
                print(f"\n✗ Follower :{port} - No data (connection failed)")
                all_consistent = False
                inconsistencies.append(port)
                continue
            
            follower_keys = set(data.keys())
            
            # Check key count
            missing_keys = leader_keys - follower_keys
            extra_keys = follower_keys - leader_keys
            
            # Check values and versions for common keys
            value_mismatches = []
            version_mismatches = []
            
            for key in leader_keys & follower_keys:
                leader_entry = leader_data[key]
                follower_entry = data[key]
                
                if leader_entry.get("value") != follower_entry.get("value"):
                    value_mismatches.append(key)
                
                if leader_entry.get("version") != follower_entry.get("version"):
                    version_mismatches.append(key)
            
            # Report results for this follower
            if missing_keys or extra_keys or value_mismatches or version_mismatches:
                print(f"\n✗ Follower :{port} - INCONSISTENT")
                if missing_keys:
                    print(f"  Missing keys: {len(missing_keys)} - {list(missing_keys)[:5]}")
                if extra_keys:
                    print(f"  Extra keys: {len(extra_keys)} - {list(extra_keys)[:5]}")
                if value_mismatches:
                    print(f"  Value mismatches: {len(value_mismatches)} - {value_mismatches[:5]}")
                if version_mismatches:
                    print(f"  Version mismatches: {len(version_mismatches)} - {version_mismatches[:5]}")
                all_consistent = False
                inconsistencies.append(port)
            else:
                print(f"✓ Follower :{port} - Consistent ({len(follower_keys)} keys)")
        
        # Summary
        print("\n" + "-" * 60)
        if all_consistent:
            print("✓ ALL REPLICAS ARE CONSISTENT WITH LEADER")
            print(f"  All {len(FOLLOWERS)} followers have matching data")
            print(f"  Total keys: {len(leader_keys)}")
            return True, []
        else:
            print(f"✗ INCONSISTENCIES DETECTED")
            print(f"  {len(inconsistencies)}/{len(FOLLOWERS)} followers have mismatches")
            print(f"  Inconsistent followers: {inconsistencies}")
            return False, inconsistencies
        
    except Exception as e:
        print(f"✗ Consistency check failed: {e}")
        return None, None


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


def restart_all_containers():
    """Restart all containers to clear data"""
    print("\nRestarting all containers to clear old data...")
    
    try:
        # Down all containers
        cmd = ['docker-compose', 'down']
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=os.getcwd())
        
        if result.returncode != 0:
            print(f"Warning during shutdown: {result.stderr}")
        
        time.sleep(2)
        
        # Up all containers
        cmd = ['docker-compose', 'up', '-d']
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=os.getcwd())
        
        if result.returncode != 0:
            print(f"Error starting containers: {result.stderr}")
            return False
        
        # Wait for all containers to be ready
        print("Waiting for all containers to be ready...")
        time.sleep(10)
        
        # Verify all are responding
        all_nodes = [LEADER] + FOLLOWERS
        for node in all_nodes:
            port = node.split(":")[-1]
            try:
                r = requests.get(node + "/dump", timeout=2)
                if r.status_code == 200:
                    print(f"  ✓ Node :{port} ready")
            except Exception as e:
                print(f"  ✗ Node :{port} not responding: {e}")
                return False
        
        print("✓ All containers ready with clean state")
        return True
        
    except Exception as e:
        print(f"Error: {e}")
        return False


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
    
    # Wait for replication to fully propagate
    print("\nWaiting for replication to complete...")
    time.sleep(5)
    
    # Verify consistency
    consistent, inconsistent_followers = verify_consistency()
    
    return {
        "quorum": quorum_value,
        "total_time": total_time,
        "avg_latency": avg,
        "stdev": stdev,
        "count": len(latencies),
        "latencies": latencies,
        "consistency": {
            "consistent": consistent if consistent is not None else False,
            "inconsistent_followers": inconsistent_followers or []
        },
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
    
    print(f"\nGenerating plot for {len(results)} results...")
    
    # Use minimal matplotlib to avoid deepcopy bug in Python 3.14
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    
    # Disable all tight layout features that trigger deepcopy
    plt.rcParams['figure.autolayout'] = False
    plt.rcParams['figure.constrained_layout.use'] = False
    
    # Calculate linear regression for average latency
    x = np.array(quorums)
    y_avg = np.array(avg_latencies)
    
    z_avg = np.polyfit(x, y_avg, 1)
    p_avg = np.poly1d(z_avg)
    r2_avg = 1 - (np.sum((y_avg - p_avg(x))**2) / np.sum((y_avg - np.mean(y_avg))**2))
    
    # Create plot matching reference image style
    fig, ax = plt.subplots(figsize=(7, 4))
    
    # Plot line with points
    ax.plot(x, y_avg, linewidth=2, color='#4472C4', marker='o', 
            markersize=8, markerfacecolor='#4472C4', markeredgecolor='#4472C4')
    
    ax.set_xlabel('Write Quorum', fontsize=11)
    ax.set_ylabel('Average Latency (s)', fontsize=11)
    ax.set_title('Write Quorum vs Average Latency', fontsize=13)
    ax.grid(True, alpha=0.3, linestyle='-', linewidth=0.5)
    ax.set_xticks(quorums)
    
    # Set clean background
    ax.set_facecolor('white')
    fig.patch.set_facecolor('white')
    
    output = os.path.join(os.getcwd(), 'latency_vs_quorum.png')
    fig.savefig(output, dpi=150, format='png', bbox_inches='tight', facecolor='white')
    plt.close(fig)
    del fig, ax
    print(f"✓ Saved: {output}")
    print(f"  Linear trend: y = {z_avg[0]:.4f}x + {z_avg[1]:.4f} (R²={r2_avg:.3f})")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Analyze distributed key-value store performance and consistency')
    parser.add_argument('--simple', action='store_true', help='Test current quorum only (no restart)')
    parser.add_argument('--verify', action='store_true', help='Just verify consistency (no writes)')
    args = parser.parse_args()
    
    # Mode 1: Just verify consistency
    if args.verify:
        print("=" * 70)
        print("CONSISTENCY VERIFICATION ONLY")
        print("=" * 70)
        verify_consistency()
        return
    
    # Mode 2: Simple test (current quorum, no restart)
    if args.simple:
        print("=" * 70)
        print("SIMPLE PERFORMANCE TEST (Current Quorum)")
        print("=" * 70)
        
        # Check if leader is running
        try:
            r = requests.get(LEADER + "/dump", timeout=2)
            print("✓ Leader is responding\n")
        except Exception as e:
            print(f"✗ Cannot connect to leader: {e}")
            print("  Make sure Docker containers are running: docker-compose up -d")
            return
        
        # Run test without restarting
        print("Running 100 concurrent writes...")
        start_time = time.time()
        latencies = run_batch_concurrent(100, concurrency=10)
        total_time = time.time() - start_time
        
        if not latencies:
            print("✗ No successful writes!")
            return
        
        # Display statistics
        avg = statistics.mean(latencies)
        median = statistics.median(latencies)
        stdev = statistics.stdev(latencies) if len(latencies) > 1 else 0
        
        print(f"\n✓ Write Test Results:")
        print(f"  Successful writes: {len(latencies)}/100")
        print(f"  Total time: {total_time:.2f}s")
        print(f"  Average latency: {avg:.3f}s")
        print(f"  Median latency: {median:.3f}s")
        print(f"  Std deviation: {stdev:.3f}s")
        print(f"  Min latency: {min(latencies):.3f}s")
        print(f"  Max latency: {max(latencies):.3f}s")
        
        # Wait and verify consistency
        print("\n" + "=" * 70)
        print("Waiting 5 seconds for replication to complete...")
        print("=" * 70)
        time.sleep(5)
        
        consistent, inconsistencies = verify_consistency()
        
        # Explanation
        print("\n" + "=" * 70)
        print("RESULTS EXPLANATION")
        print("=" * 70)
        if consistent:
            print("""
✓ SUCCESS: All replicas are consistent!

This demonstrates:
  - Semi-synchronous replication working correctly
  - Eventual consistency achieved after writes
  - Versioning prevents out-of-order updates
  - All followers successfully replicated all data
""")
        elif consistent is False:
            print(f"""
⚠ Some inconsistencies detected (followers: {inconsistencies})

Possible reasons:
  - Low WRITE_QUORUM setting (not all followers waited)
  - Replication still in progress (wait longer)
  - Network delays or follower issues

This is normal with quorum < 5. Followers will eventually catch up.
""")
        print("=" * 70)
        return
    
    # Mode 3: Full automated analysis (all quorums)
    print("=" * 60)
    print("AUTOMATED QUORUM ANALYSIS")
    print("=" * 60)
    print("Testing write quorum values: 1, 2, 3, 4, 5")
    print("This will automatically restart the leader for each value.\n")
    
    # First, restart all containers to clear old data
    if not restart_all_containers():
        print("✗ Failed to restart containers. Aborting.")
        sys.exit(1)
    
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
        
        # Consistency summary
        print("\n" + "=" * 60)
        print("CONSISTENCY ANALYSIS")
        print("=" * 60)
        
        consistent_count = sum(1 for r in all_results 
                              if r.get("consistency", {}).get("consistent", False))
        total_tests = len(all_results)
        
        print(f"\nConsistency across {total_tests} quorum tests:")
        for r in all_results:
            quorum = r["quorum"]
            consistency = r.get("consistency", {})
            if consistency and consistency.get("consistent"):
                print(f"  Quorum {quorum}: ✓ All replicas consistent")
            elif consistency and not consistency.get("consistent"):
                inconsistent = consistency.get("inconsistent_followers", [])
                print(f"  Quorum {quorum}: ✗ Inconsistent (followers: {inconsistent})")
            else:
                print(f"  Quorum {quorum}: ⚠ Verification failed")
        
        print(f"\nOverall: {consistent_count}/{total_tests} tests had full consistency")
        
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
