"""
Data consistency verification script.

This script checks if the data in all replicas (followers) matches 
the data on the leader after writes are completed.
"""

import requests
import json

LEADER = "http://localhost:8000"
FOLLOWERS = [
    "http://localhost:8001",
    "http://localhost:8002",
    "http://localhost:8003",
    "http://localhost:8004",
    "http://localhost:8005",
]


def dump_node(node_url: str) -> dict:
    """Get all data from a node"""
    try:
        r = requests.get(f"{node_url}/dump", timeout=5)
        if r.status_code == 200:
            return r.json()
        return {}
    except Exception as e:
        print(f"✗ Failed to connect to {node_url}: {e}")
        return {}


def compare_stores(leader_store: dict, follower_store: dict, follower_name: str) -> bool:
    """Compare leader and follower stores"""
    leader_keys = set(leader_store.keys())
    follower_keys = set(follower_store.keys())
    
    # Check for missing keys
    missing_in_follower = leader_keys - follower_keys
    extra_in_follower = follower_keys - leader_keys
    
    consistent = True
    
    if missing_in_follower:
        print(f"  ✗ {follower_name}: Missing keys: {missing_in_follower}")
        consistent = False
    
    if extra_in_follower:
        print(f"  ✗ {follower_name}: Extra keys not in leader: {extra_in_follower}")
        consistent = False
    
    # Check values and versions for common keys
    common_keys = leader_keys & follower_keys
    for key in common_keys:
        leader_entry = leader_store[key]
        follower_entry = follower_store[key]
        
        if leader_entry["value"] != follower_entry["value"]:
            print(f"  ✗ {follower_name}: Value mismatch for key '{key}'")
            print(f"    Leader: {leader_entry['value']}, Follower: {follower_entry['value']}")
            consistent = False
        
        if leader_entry["version"] != follower_entry["version"]:
            print(f"  ✗ {follower_name}: Version mismatch for key '{key}'")
            print(f"    Leader: {leader_entry['version']}, Follower: {follower_entry['version']}")
            consistent = False
    
    return consistent


def main():
    print("=" * 70)
    print("DATA CONSISTENCY VERIFICATION")
    print("=" * 70)
    print("\nChecking if all followers have the same data as the leader...\n")
    
    # Get leader data
    print("Fetching data from leader...")
    leader_store = dump_node(LEADER)
    if not leader_store:
        print("✗ Failed to get leader data")
        return
    
    print(f"✓ Leader has {len(leader_store)} keys\n")
    
    # Get follower data and compare
    all_consistent = True
    follower_names = ["Follower1", "Follower2", "Follower3", "Follower4", "Follower5"]
    
    for follower_url, follower_name in zip(FOLLOWERS, follower_names):
        print(f"Checking {follower_name} ({follower_url})...")
        follower_store = dump_node(follower_url)
        
        if not follower_store:
            print(f"  ✗ Failed to get data from {follower_name}")
            all_consistent = False
            continue
        
        print(f"  {follower_name} has {len(follower_store)} keys")
        
        if compare_stores(leader_store, follower_store, follower_name):
            print(f"  ✓ {follower_name} is consistent with leader")
        else:
            all_consistent = False
        print()
    
    # Summary
    print("=" * 70)
    print("CONSISTENCY CHECK SUMMARY")
    print("=" * 70)
    
    if all_consistent:
        print("✓ All followers are consistent with the leader!")
        print("\nExplanation:")
        print("  The semi-synchronous replication with write quorum ensures that")
        print("  a configurable number of followers receive the updates before the")
        print("  write is acknowledged to the client. The versioning system prevents")
        print("  out-of-order writes from network delays. After all writes complete,")
        print("  eventual consistency is achieved across all replicas.")
    else:
        print("✗ Inconsistencies detected!")
        print("\nPossible reasons:")
        print("  1. Some followers may not have received all replication messages")
        print("  2. Network delays caused some replications to be pending")
        print("  3. Some followers may have been down during writes")
        print("  4. Write quorum < number of followers means not all followers")
        print("     are guaranteed to receive updates synchronously")
        print("\nNote: With write quorum < 5, it's normal for some followers to")
        print("      be temporarily behind. They will eventually catch up through")
        print("      the replication mechanism (eventual consistency).")
    
    print("=" * 70)
    
    # Show detailed leader data
    if leader_store:
        print("\nLeader Data Summary:")
        for key in sorted(leader_store.keys()):
            entry = leader_store[key]
            print(f"  {key}: value={entry['value']}, version={entry['version']}")


if __name__ == "__main__":
    main()
