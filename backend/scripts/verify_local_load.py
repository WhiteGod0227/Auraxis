"""Bounded read-only local HTTP smoke test, not production load certification."""

import asyncio
import json
import statistics
import time
from pathlib import Path

import httpx


async def main():
    limits = asyncio.Semaphore(4)
    timings = []
    async with httpx.AsyncClient(
        base_url="http://127.0.0.1:8010", timeout=30
    ) as client:

        async def check(path):
            async with limits:
                before = time.perf_counter()
                response = await client.get(path)
                response.raise_for_status()
                response.json()
                timings.append((time.perf_counter() - before) * 1000)

        paths = ["/health", "/api/meta", "/api/spreads?pair=GOLDTEN-GOLDPETAL"] * 8
        await asyncio.gather(*(check(path) for path in paths))
        assert (await client.get("/api/auth/security")).status_code == 401
        assert (await client.get("/api/alerts/rules")).status_code == 401
        forbidden = await client.put(
            "/api/alerts/rules",
            headers={"Origin": "https://evil.test"},
            json={"revision": 0, "rules": []},
        )
        assert forbidden.status_code == 403
    result = {
        "requests": len(paths),
        "concurrency": 4,
        "all_http_200": True,
        "median_ms": round(statistics.median(timings), 2),
        "maximum_ms": round(max(timings), 2),
        "private_auth_guards": "passed",
        "foreign_origin": "rejected",
        "limit": "Local read-only smoke check; not production certification.",
    }
    output = Path(__file__).resolve().parents[1] / ".tmp" / "local-load-smoke.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    asyncio.run(main())
