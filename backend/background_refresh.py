# background_refresh.py
import asyncio
from datetime import datetime

from database import SessionLocal
from models import WatchlistSymbol
from market_data import get_quote, get_daily_history, get_alpha_queue_depth

REFRESH_INTERVAL_SECONDS = 60 * 5  # check every 5 minutes


async def _get_all_tracked_symbols() -> list[str]:
    """
    All distinct symbols across every user's watchlist.
    This is the shared refresh target — one fetch per symbol
    benefits every user watching it, regardless of how many
    users that is.
    """
    db = SessionLocal()
    try:
        rows = db.query(WatchlistSymbol.symbol).distinct().all()
        return [row[0].upper().strip() for row in rows if row[0]]
    finally:
        db.close()


async def refresh_loop():
    """
    Background task: proactively refresh quote + history cache
    for every symbol currently being tracked by any user.

    Why: without this, cache staleness is only ever discovered
    and paid for by whichever user's request happens to land
    after TTL expiry — meaning that user eats the full cold-fetch
    latency (including Alpha Vantage throttling) synchronously.
    With this loop, refreshes happen off the request path, so
    user-facing requests almost always hit warm cache.
    """
    while True:
        try:
            symbols = await _get_all_tracked_symbols()

            for symbol in symbols:
                # Back off if the provider queue is already under
                # pressure — don't compete with live user requests.
                if get_alpha_queue_depth() > 3:
                    await asyncio.sleep(2)

                await get_quote(symbol)
                await get_daily_history(symbol)

            # Always keep the benchmark warm too
            await get_quote("SPY")
            await get_daily_history("SPY")

        except Exception as error:
            print("Background refresh error:", error)

        await asyncio.sleep(REFRESH_INTERVAL_SECONDS)