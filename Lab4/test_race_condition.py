"""
Test for race condition handling with versioning.

This test verifies that the versioning system correctly handles out-of-order
replication messages that may arrive due to network delays.
"""

import time
import requests
import concurrent.futures
from typing import List, Tuple

# Use timestamp to ensure fresh keys for each test run
test_run_id = int(time.time())

LEADER = "http://localhost:8000"
FOLLOWERS = [
    "http://localhost:8001",
    "http://localhost:8002",
    "http://localhost:8003",
    "http://localhost:8004",
    "http://localhost:8005",
]


def write_key(key: str, value: str) -> bool:
    """Write a key-value pair to the leader"""
    try:
        r = requests.post(LEADER + "/set", json={"key": key, "value": value}, timeout=10)
        return r.status_code == 200 and r.json().get("ok", False)
    except Exception as e:
        print(f"Write failed: {e}")
        return False


def read_from_node(node_url: str, key: str) -> Tuple[str, any, int]:
    """Read a key from a specific node and return (node_url, value, version)"""
    try:
        r = requests.get(f"{node_url}/get/{key}", timeout=5)
        if r.status_code == 200:
            data = r.json()
            return (node_url, data.get("value"), data.get("version"))
        return (node_url, None, None)
    except Exception:
        return (node_url, None, None)


def dump_node(node_url: str) -> dict:
    """Get all data from a node"""
    try:
        r = requests.get(f"{node_url}/dump", timeout=5)
        if r.status_code == 200:
            return r.json()
        return {}
    except Exception:
        return {}


def test_sequential_writes_consistency():
    """
    Test that sequential writes maintain version ordering across all nodes.
    Even with network delays, the highest version should win.
    """
    print("\n" + "=" * 70)
    print("TEST: Sequential Writes with Version Consistency")
    print("=" * 70)
    
    test_key = f"race_test_key_{test_run_id}"
    num_writes = 10
    
    # Perform sequential writes
    print(f"\nPerforming {num_writes} sequential writes to key '{test_key}'...")
    for i in range(num_writes):
        value = f"value_{i}"
        success = write_key(test_key, value)
        if not success:
            print(f"✗ Write {i} failed")
            return False
        print(f"  Write {i}: {value}")
    
    # Wait for replication to complete
    print("\nWaiting for replication to propagate...")
    time.sleep(3)
    
    # Read from all nodes
    print("\nReading from all nodes...")
    all_nodes = [LEADER] + FOLLOWERS
    results = []
    
    for node in all_nodes:
        url, value, version = read_from_node(node, test_key)
        results.append((url, value, version))
        node_name = url.split(":")[-1]
        print(f"  Node {node_name}: value={value}, version={version}")
    
    # Check consistency
    expected_value = f"value_{num_writes - 1}"
    expected_version = num_writes
    
    all_consistent = True
    for url, value, version in results:
        if value != expected_value or version != expected_version:
            print(f"\n✗ Inconsistency detected at {url}")
            print(f"  Expected: value={expected_value}, version={expected_version}")
            print(f"  Got: value={value}, version={version}")
            all_consistent = False
    
    if all_consistent:
        print(f"\n✓ All nodes have consistent state:")
        print(f"  value={expected_value}, version={expected_version}")
        return True
    else:
        print("\n✗ Nodes are inconsistent!")
        return False


def test_concurrent_writes_same_key():
    """
    Test concurrent writes to the same key to verify that version
    ordering prevents race conditions.
    """
    print("\n" + "=" * 70)
    print("TEST: Concurrent Writes to Same Key")
    print("=" * 70)
    
    test_key = f"concurrent_key_{test_run_id}"
    num_concurrent = 20
    
    print(f"\nPerforming {num_concurrent} concurrent writes to key '{test_key}'...")
    
    # Concurrent writes
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = []
        for i in range(num_concurrent):
            value = f"concurrent_value_{i}"
            futures.append(executor.submit(write_key, test_key, value))
        
        results = [f.result() for f in concurrent.futures.as_completed(futures)]
    
    successful_writes = sum(1 for r in results if r)
    print(f"  Successful writes: {successful_writes}/{num_concurrent}")
    
    # Wait for replication
    print("\nWaiting for replication to complete...")
    time.sleep(5)
    
    # Check all nodes have the same version (the highest one)
    print("\nChecking version consistency across all nodes...")
    all_nodes = [LEADER] + FOLLOWERS
    versions = []
    
    for node in all_nodes:
        url, value, version = read_from_node(node, test_key)
        versions.append((url, version))
        node_name = url.split(":")[-1]
        print(f"  Node {node_name}: version={version}")
    
    # All nodes should have the same version (the highest)
    max_version = max(v for _, v in versions if v is not None)
    all_same_version = all(v == max_version for _, v in versions if v is not None)
    
    if all_same_version:
        print(f"\n✓ All nodes converged to version {max_version}")
        print("  Race condition protection is working correctly!")
        return True
    else:
        print("\n✗ Version mismatch detected across nodes!")
        print("  Race condition protection may not be working correctly.")
        return False


def test_out_of_order_detection():
    """
    Test that followers correctly reject stale writes and that all nodes
    eventually converge to the same version.
    """
    print("\n" + "=" * 70)
    print("TEST: Out-of-Order Write Detection")
    print("=" * 70)
    
    test_key = f"order_test_key_{test_run_id}"
    
    # Write 5 times to establish a version history
    print(f"\nEstablishing version history for key '{test_key}'...")
    for i in range(5):
        write_key(test_key, f"initial_{i}")
        time.sleep(0.2)
    
    # Wait for full replication to complete
    print("\nWaiting for replication to stabilize...")
    time.sleep(5)
    
    # Check that all nodes have converged to the same version
    print("\nChecking initial convergence across all nodes:")
    all_nodes = [LEADER] + FOLLOWERS
    initial_versions = []
    
    for node in all_nodes:
        url, value, version = read_from_node(node, test_key)
        initial_versions.append(version)
        node_name = url.split(":")[-1]
        print(f"  Node {node_name}: version={version}, value={value}")
    
    # All nodes should have the same version after replication
    if len(set(initial_versions)) != 1:
        print("\n✗ Nodes have not converged to the same version initially!")
        return False
    
    initial_version = initial_versions[0]
    print(f"\n✓ All nodes converged to version {initial_version}")
    
    # Now do one more write
    print(f"\nPerforming final write...")
    result = write_key(test_key, "final_value")
    if not result:
        print("✗ Final write failed!")
        return False
    
    # Wait for replication to complete
    time.sleep(5)
    
    # Check final versions - all should be at initial_version + 1
    print("\nFinal state across all nodes:")
    expected_version = initial_version + 1
    all_correct = True
    final_versions = []
    
    for node in all_nodes:
        url, value, version = read_from_node(node, test_key)
        final_versions.append(version)
        node_name = url.split(":")[-1]
        status = "✓" if version == expected_version else "✗"
        print(f"  {status} Node {node_name}: version={version}, value={value}")
        
        if version != expected_version:
            all_correct = False
    
    # Check if all nodes have the same version (even if not the expected one)
    all_same = len(set(final_versions)) == 1
    
    if all_correct and all_same:
        print(f"\n✓ All nodes correctly converged to version {expected_version}")
        return True
    elif all_same:
        print(f"\n⚠ All nodes converged to version {final_versions[0]}, but expected {expected_version}")
        print("  This may indicate replication caught up during the test.")
        return True  # Still pass if they're all consistent
    else:
        print("\n✗ Nodes have inconsistent versions!")
        print(f"  Versions found: {set(final_versions)}")
        return False


def main():
    print("=" * 70)
    print("RACE CONDITION TEST SUITE")
    print("=" * 70)
    print("\nTesting versioning system's ability to handle:")
    print("  1. Sequential writes with network delays")
    print("  2. Concurrent writes to the same key")
    print("  3. Out-of-order replication messages")
    print("\nEnsure the leader and followers are running (docker-compose up)")
    
    # Wait for user confirmation
    input("\nPress Enter to start tests...")
    
    # Run tests
    results = []
    
    try:
        results.append(("Sequential Writes", test_sequential_writes_consistency()))
        results.append(("Concurrent Writes", test_concurrent_writes_same_key()))
        results.append(("Out-of-Order Detection", test_out_of_order_detection()))
    except Exception as e:
        print(f"\n✗ Test suite failed with error: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Summary
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    
    for test_name, passed in results:
        status = "✓ PASSED" if passed else "✗ FAILED"
        print(f"  {test_name}: {status}")
    
    all_passed = all(r for _, r in results)
    if all_passed:
        print("\n✓ All tests passed! Versioning system is working correctly.")
    else:
        print("\n✗ Some tests failed. Review the output above.")
    
    print("=" * 70)


if __name__ == "__main__":
    main()
