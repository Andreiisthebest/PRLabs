import os
import asyncio
import random
import json
from typing import List, Dict, Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

app = FastAPI()

# In-memory key-value store with versioning
# store[key] = {"value": actual_value, "version": int}
store: Dict[str, Dict[str, Any]] = {}

# Environment configuration
ROLE = os.getenv("ROLE", "follower")
PORT = int(os.getenv("PORT", "8000"))
FOLLOWERS = os.getenv("FOLLOWERS", "").split(",") if os.getenv("FOLLOWERS") else []
WRITE_QUORUM = int(os.getenv("WRITE_QUORUM", "1"))
MIN_DELAY_MS = int(os.getenv("MIN_DELAY", "0"))
MAX_DELAY_MS = int(os.getenv("MAX_DELAY", "0"))
REPL_TIMEOUT = float(os.getenv("REPL_TIMEOUT", "5.0"))


class SetRequest(BaseModel):
    key: str
    value: Any


class ReplicateRequest(BaseModel):
    key: str
    value: Any
    version: int


async def replicate_to_follower(follower_url: str, key: str, value: Any, version: int) -> bool:
    # Simulate network lag per follower
    delay_ms = random.randint(MIN_DELAY_MS, MAX_DELAY_MS)
    await asyncio.sleep(delay_ms / 1000.0)
    try:
        async with httpx.AsyncClient(timeout=REPL_TIMEOUT) as client:
            r = await client.post(follower_url + "/replicate", json={"key": key, "value": value, "version": version})
            return r.status_code == 200
    except Exception:
        return False


@app.post("/set")
async def set_value(req: SetRequest):
    # Both leader and followers accept requests concurrently; but only leader accepts external writes.
    if ROLE != "leader":
        raise HTTPException(status_code=403, detail="Only leader accepts writes")

    # Increment version for this key
    current_version = store.get(req.key, {}).get("version", 0)
    new_version = current_version + 1
    
    # write locally first with version
    store[req.key] = {"value": req.value, "version": new_version}

    # start replication to followers concurrently
    tasks = []
    for f in FOLLOWERS:
        f = f.strip()
        if not f:
            continue
        # follower_url is like http://follower1:8001
        if not f.startswith("http"):
            follower_url = f"http://{f}"
        else:
            follower_url = f
        tasks.append(asyncio.create_task(replicate_to_follower(follower_url, req.key, req.value, new_version)))

    # wait for confirmations (semi-synchronous): need WRITE_QUORUM follower confirmations
    confirmations = 0
    if tasks:
        # as tasks complete, count successes until quorum met or all finish
        for coro in asyncio.as_completed(tasks, timeout=REPL_TIMEOUT):
            try:
                res = await coro
            except asyncio.TimeoutError:
                res = False
            if res:
                confirmations += 1
            if confirmations >= WRITE_QUORUM:
                break

    success = confirmations >= WRITE_QUORUM
    return {"ok": success, "confirmations": confirmations, "required": WRITE_QUORUM, "version": new_version}


@app.post("/replicate")
async def replicate(req: ReplicateRequest):
    # Only apply update if version is greater than current version (prevents stale writes)
    current = store.get(req.key)
    if current is None or req.version > current["version"]:
        store[req.key] = {"value": req.value, "version": req.version}
        return {"ok": True, "applied": True}
    else:
        # Stale or duplicate write - reject
        return {"ok": True, "applied": False, "reason": "stale_version"}


@app.get("/get/{key}")
async def get_value(key: str):
    if key not in store:
        raise HTTPException(status_code=404, detail="Not found")
    entry = store[key]
    return {"key": key, "value": entry["value"], "version": entry["version"]}


@app.get("/dump")
async def dump_store():
    return store


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=PORT, log_level="info")
