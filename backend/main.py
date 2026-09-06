import asyncio
from datetime import datetime, timezone
import exchange_calendars as xcals
from email.utils import quote

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from routes.auth import router as auth_router
from database import engine, Base, get_db
from auth import get_current_user

from market_data import (
    get_quote,
    get_daily_history,
)

from change_engine import calculate_unusual_move
from models import (
    User,
    UserSymbolSnapshot,
    AttentionScore,
    Watchlist,
    WatchlistSymbol,
)

from routes.watchlist import router as watchlist_router
from routes.snapshot import router as snapshot_router

# NEW: background refresh loop that proactively keeps the shared
# quote/history cache warm, off the request path. See
# background_refresh.py for details.
from background_refresh import refresh_loop


app = FastAPI(
    title="Smart Market Watchlist API"
)


# ---------------------------------------------------------
# Database
# ---------------------------------------------------------

Base.metadata.create_all(bind=engine)


# ---------------------------------------------------------
# Routers
# ---------------------------------------------------------

app.include_router(watchlist_router)
app.include_router(snapshot_router)
app.include_router(auth_router)

# ---------------------------------------------------------
# CORS
# ---------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# NEW: Background refresh startup hook
# ---------------------------------------------------------
# Without this, the quote/history cache only ever gets refreshed
# reactively - i.e. whichever user's request happens to land right
# after the 30-minute TTL expires pays the full cold-fetch latency
# (including the Alpha Vantage throttle wait). This background task
# refreshes every symbol tracked by any user on a fixed interval, so
# user-facing requests almost always hit warm cache instead.

@app.on_event("startup")
async def start_background_refresh():
    asyncio.create_task(refresh_loop())


# ---------------------------------------------------------
# NEW: Shared attention-score cache
# ---------------------------------------------------------
# An attention score depends only on (symbol, history, benchmark
# return) - never on which user is asking. Without this cache, two
# users watching the same symbol trigger the identical z-score /
# volume / level computation twice (or N times for N users) on every
# request. This caches the computed analysis per symbol for a short
# TTL so it is computed once per symbol per refresh window and reused
# across every user's request in that window.

_attention_cache: dict[str, tuple[dict, datetime]] = {}
ATTENTION_CACHE_TTL_SECONDS = 300  # 5 minutes


def get_cached_attention(
    symbol: str,
    history: list,
    benchmark_return: float | None,
):
    cached = _attention_cache.get(symbol)

    if cached:
        cached_analysis, computed_at = cached
        age = (
            datetime.now(timezone.utc) - computed_at
        ).total_seconds()

        if age <= ATTENTION_CACHE_TTL_SECONDS:
            return cached_analysis

    analysis = calculate_unusual_move(
        history,
        benchmark_return=benchmark_return,
    )

    if analysis:
        _attention_cache[symbol] = (
            analysis,
            datetime.now(timezone.utc),
        )

    return analysis


# ---------------------------------------------------------
# Helper: Safe Market Data Error
# ---------------------------------------------------------

def unavailable_market_response(
    symbol: str,
    quote: dict | None = None,
):
    """
    Return a consistent response when market data is
    unavailable or malformed.

    This prevents provider/cache failures from becoming
    unhandled 500 errors.
    """

    source = None
    message = (
        "Market data is currently unavailable. "
        "Please try again later."
    )

    if isinstance(quote, dict):
        source = quote.get("data_source")

        provider_message = quote.get("message")

        if provider_message:
            message = provider_message

    return {
        "symbol": symbol,
        "status": "unavailable",
        "current": None,
        "attention": None,
        "since_last_checked": {
            "previous_price": None,
            "change_percent": None,
            "has_previous_snapshot": False,
        },
        "data_quality": {
            "status": "unavailable",
            "source": source,
            "message": message,
        },
        "message": message,
    }


# ---------------------------------------------------------
# Helper: Validate Quote
# ---------------------------------------------------------

def is_valid_quote(quote) -> bool:
    """
    Ensure the quote contains the fields required by the API.

    Prevents malformed Alpha Vantage / Yahoo / cache responses
    from reaching calculations that expect numeric market data.
    """

    if not isinstance(quote, dict):
        return False

    required_fields = [
        "price",
        "change",
        "change_percent",
        "volume",
        "latest_trading_day",
    ]

    for field in required_fields:
        if field not in quote:
            return False

    try:
        float(quote["price"])
        float(quote["change"])
        float(quote["volume"])
    except (TypeError, ValueError):
        return False

    return True


# ---------------------------------------------------------
# Health
# ---------------------------------------------------------

@app.get("/health")
def health_check():

    return {
        "status": "ok",
        "database": "connected",
    }

@app.get("/market/attention-inbox")
async def attention_inbox(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return the most meaningful actionable changes across
    the authenticated user's watchlists.

    Only fresh/current/conflict-aware data is considered
    actionable. Stale or unavailable data is excluded.
    """

    # -----------------------------------------------------
    # Get this user's watchlists
    # -----------------------------------------------------

    watchlists = (
        db.query(Watchlist)
        .filter(
            Watchlist.user_id == current_user.id
        )
        .all()
    )

    # Collect unique symbols across all watchlists.
    symbol_records = {}

    for watchlist in watchlists:
        watchlist_symbols = (
            db.query(WatchlistSymbol)
            .filter(
                WatchlistSymbol.watchlist_id
                == watchlist.id
            )
            .all()
        )

        for item in watchlist_symbols:
            if item.symbol:
                symbol = item.symbol.upper().strip()

                symbol_records[symbol] = {
                    "symbol": symbol,
                    "exchange": (
                        item.exchange.upper().strip()
                        if item.exchange
                        else None
                    ),
                }

    if not symbol_records:
        return {
            "status": "ok",
            "count": 0,
            "items": [],
        }

    # -----------------------------------------------------
    # NEW: Fetch quotes + history for every symbol concurrently
    # instead of one-at-a-time. This was previously an
    # `await get_quote(symbol)` / `await get_daily_history(symbol)`
    # pair inside the per-symbol for-loop below, meaning a request
    # for N symbols meant N sequential round trips. Now it's a
    # single batch of up to N concurrent round trips.
    # -----------------------------------------------------

    symbols_list = sorted(symbol_records.keys())

    quote_results = await asyncio.gather(
        *(get_quote(symbol) for symbol in symbols_list),
        return_exceptions=True,
    )

    quote_by_symbol = {
        symbol: (result if not isinstance(result, Exception) else None)
        for symbol, result in zip(symbols_list, quote_results)
    }

    history_results = await asyncio.gather(
        *(get_daily_history(symbol) for symbol in symbols_list),
        return_exceptions=True,
    )

    history_by_symbol = {
        symbol: (result if not isinstance(result, Exception) else None)
        for symbol, result in zip(symbols_list, history_results)
    }

    # -----------------------------------------------------
    # NEW: Benchmark fetched once for the whole batch.
    # Previously this was `await get_daily_history("SPY")` inside
    # the per-symbol loop - after the first symbol it always hit
    # the warm cache anyway, but it's cleaner and cheaper to fetch
    # it once up front.
    # -----------------------------------------------------

    benchmark_history = await get_daily_history("SPY")

    benchmark_return = None

    if (
        benchmark_history
        and len(benchmark_history) >= 2
    ):
        benchmark_data = sorted(
            benchmark_history,
            key=lambda item: item["date"],
        )

        previous_close = (
            benchmark_data[-2]["close"]
        )

        current_close = (
            benchmark_data[-1]["close"]
        )

        if previous_close != 0:
            benchmark_return = (
                current_close
                - previous_close
            ) / previous_close

    # -----------------------------------------------------
    # NEW: Batch-load this user's snapshots for every symbol in
    # one query, instead of one `.filter(...).first()` query per
    # symbol inside the loop below.
    # -----------------------------------------------------

    snapshots = (
        db.query(UserSymbolSnapshot)
        .filter(
            UserSymbolSnapshot.user_id == current_user.id,
            UserSymbolSnapshot.symbol.in_(symbols_list),
        )
        .all()
    )

    snapshot_by_symbol = {
        snap.symbol: snap for snap in snapshots
    }

    # -----------------------------------------------------
    # Calculate attention for each symbol
    # -----------------------------------------------------

    items = []

    for symbol in symbols_list:
        exchange = symbol_records[symbol]["exchange"]
        try:
            quote = quote_by_symbol.get(symbol)
            if quote and quote.get("exchange"):
                discovered_exchange = quote["exchange"]

                if not symbol_records[symbol]["exchange"]:
                    symbol_records[symbol]["exchange"] = discovered_exchange

                    db.query(WatchlistSymbol).filter(
                        WatchlistSymbol.symbol == symbol,
                        WatchlistSymbol.watchlist_id.in_(
                            [watchlist.id for watchlist in watchlists]
                        ),
                    ).update(
                        {
                            WatchlistSymbol.exchange: discovered_exchange
                        },
                        synchronize_session=False,
                    )

                    db.commit()
            exchange = symbol_records[symbol]["exchange"]
            if not is_valid_quote(quote):
                continue

            history = history_by_symbol.get(symbol)

            if not history:
                continue

            # ---------------------------------------------
            # Attention calculation
            # (NEW: shared per-symbol cache instead of a fresh
            # calculate_unusual_move() call per user per request)
            # ---------------------------------------------

            analysis = get_cached_attention(
                symbol,
                history,
                benchmark_return,
            )

            if not analysis:
                continue

            score = int(
                analysis.get("score", 0)
            )
            

            # ---------------------------------------------
            # Data quality
            # ---------------------------------------------

            data_status = quote.get(
                "data_status",
                "unknown",
            )
            

            data_source = quote.get(
                "data_source",
                "unknown",
            )

            latest_trading_day = quote.get(
                "latest_trading_day"
            )

            quality_state = (
                get_market_session_state(
                    exchange,
                    latest_trading_day,
                )
            )
            
            # Never surface stale/conflicting data
            # as actionable attention.
            if data_status in {
                "stale",
                "conflict",
            }:
                continue

            if quality_state in {
                "data_delayed",
                "unknown",
            }:
                continue

            # ---------------------------------------------
            # Meaningful threshold
            # ---------------------------------------------

            if score < 40:
                continue

            # ---------------------------------------------
            # User's previous snapshot
            # (NEW: looked up from the batch-loaded dict above
            # instead of a per-symbol query)
            # ---------------------------------------------

            snapshot = snapshot_by_symbol.get(symbol)

            previous_price = None
            price_change_since_check = None
            previous_attention_score = None
            attention_score_change = None
            checked_at = None

            if snapshot:

                try:
                    previous_price = float(
                        snapshot.price
                    )
                except (
                    TypeError,
                    ValueError,
                ):
                    previous_price = None

                try:
                    previous_attention_score = (
                        float(
                            snapshot.attention_score
                        )
                    )
                except (
                    TypeError,
                    ValueError,
                ):
                    previous_attention_score = None

                checked_at = snapshot.checked_at

                if (
                    previous_price is not None
                    and previous_price != 0
                ):
                    current_price = float(
                        quote["price"]
                    )

                    price_change_since_check = (
                        (
                            current_price
                            - previous_price
                        )
                        / previous_price
                    ) * 100

                if (
                    previous_attention_score
                    is not None
                ):
                    attention_score_change = (
                        score
                        - previous_attention_score
                    )

            # ---------------------------------------------
            # Add actionable item
            # ---------------------------------------------

            items.append(
                {
                    "symbol": symbol,
                    "score": score,
                    "severity": analysis.get(
                        "severity",
                        "low",
                    ),
                    "explanation": analysis.get(
                        "explanation",
                        "Meaningful market movement detected.",
                    ),
                    "reasons": analysis.get(
                        "reasons",
                        [],
                    ),
                    "current": {
                        "price": quote["price"],
                        "change": quote["change"],
                        "change_percent": quote[
                            "change_percent"
                        ],
                        "volume": quote["volume"],
                        "latest_trading_day": (
                            latest_trading_day
                        ),
                    },
                    "since_last_checked": {
                        "previous_price": (
                            previous_price
                        ),
                        "price_change_percent": (
                            round(
                                price_change_since_check,
                                2,
                            )
                            if price_change_since_check
                            is not None
                            else None
                        ),
                        "previous_attention_score": (
                            previous_attention_score
                        ),
                        "attention_score_change": (
                            round(
                                attention_score_change,
                                2,
                            )
                            if attention_score_change
                            is not None
                            else None
                        ),
                        "checked_at": checked_at,
                        "has_previous_snapshot": (
                            snapshot is not None
                            and previous_price
                            is not None
                        ),
                    },
                    "data_quality": {
                        "status": data_status,
                        "state": quality_state,
                        "source": data_source,
                        "latest_trading_day": (
                            latest_trading_day
                        ),
                    },
                }
            )

        except Exception as error:
            print(
                f"Attention inbox failed for "
                f"{symbol}: {error}"
            )
            continue

    # -----------------------------------------------------
    # Highest attention first
    # -----------------------------------------------------

    items.sort(
        key=lambda item: (
            item["score"],
            item["severity"],
        ),
        reverse=True,
    )

    return {
        "status": "ok",
        "count": len(items),
        "items": items,
    }
# ---------------------------------------------------------
# Current Market Quote
# ---------------------------------------------------------

@app.get("/market/{symbol}")
async def market_quote(symbol: str):

    symbol = symbol.upper().strip()

    if not symbol:

        return {
            "symbol": symbol,
            "status": "invalid_symbol",
            "message": "Stock symbol cannot be empty.",
        }

    quote = await get_quote(symbol)

    # Provider/cache returned nothing
    if quote is None:

        return {
            "symbol": symbol,
            "status": "not_available",
            "message": (
                "Market data is unavailable for this symbol. "
                "It may be invalid, unsupported, or temporarily unavailable."
            ),
        }

    # Provider/cache returned malformed data
    if not is_valid_quote(quote):

        return {
            "symbol": symbol,
            "status": "not_available",
            "data_source": (
                quote.get("data_source")
                if isinstance(quote, dict)
                else None
            ),
            "data_status": "unavailable",
            "message": (
                "Market data was received but is incomplete "
                "or invalid. Please try again later."
            ),
        }

    return quote


# ---------------------------------------------------------
# Historical Market Data
# ---------------------------------------------------------

@app.get("/market/{symbol}/history")
async def market_history(symbol: str):

    symbol = symbol.upper().strip()

    if not symbol:

        return {
            "symbol": symbol,
            "status": "invalid_symbol",
            "message": "Stock symbol cannot be empty.",
        }

    history = await get_daily_history(symbol)

    if not history:

        return {
            "symbol": symbol,
            "status": "not_available",
            "message": "Historical market data unavailable",
        }

    return {
        "symbol": symbol,
        "count": len(history),
        "history": history,
    }


# ---------------------------------------------------------
# Basic Analysis
# ---------------------------------------------------------

@app.get("/market/{symbol}/analysis")
async def market_analysis(symbol: str):

    symbol = symbol.upper().strip()

    if not symbol:

        return {
            "symbol": symbol,
            "status": "invalid_symbol",
            "message": "Stock symbol cannot be empty.",
        }

    history = await get_daily_history(symbol)

    if not history:

        return {
            "symbol": symbol,
            "status": "not_available",
            "message": "Historical market data unavailable",
        }

    # -----------------------------------------------------
    # Get broad-market benchmark
    # -----------------------------------------------------

    benchmark_history = await get_daily_history("SPY")

    benchmark_return = None

    if benchmark_history and len(benchmark_history) >= 2:

        benchmark_data = sorted(
            benchmark_history,
            key=lambda item: item["date"],
        )

        previous_benchmark_close = (
            benchmark_data[-2]["close"]
        )

        current_benchmark_close = (
            benchmark_data[-1]["close"]
        )

        if previous_benchmark_close != 0:

            benchmark_return = (
                current_benchmark_close
                - previous_benchmark_close
            ) / previous_benchmark_close

    # -----------------------------------------------------
    # Calculate unusual move
    # (NEW: shared per-symbol cache instead of a fresh
    # calculate_unusual_move() call per request)
    # -----------------------------------------------------

    analysis = get_cached_attention(
        symbol,
        history,
        benchmark_return,
    )
    

    if analysis is None:

        return {
            "symbol": symbol,
            "status": "insufficient_data",
            "message": "Not enough historical data",
        }

    return {
        "symbol": symbol,
        "status": "ok",
        "analysis": analysis,
    }

# =========================================================
# Market session detection
# =========================================================

def get_market_session_state(
    exchange: str | None,
    latest_trading_day: str | None,
) -> str:

    if not exchange:
        return "unknown"

    exchange = exchange.upper().strip()

    exchange_calendars = {
    "NMS": "XNAS",
    "NYQ": "XNYS",
    "NASDAQ": "XNAS",
    "NAS": "XNAS",
    "NYSE": "XNYS",
    "BSE": "XBOM",
    "BOM": "XBOM",
}

    calendar_name = exchange_calendars.get(exchange)

    if not calendar_name:
        return "unknown"

    try:
        calendar = xcals.get_calendar(
            calendar_name
        )

        today = datetime.now(
            timezone.utc
        ).date()

        today_timestamp = (
            f"{today.isoformat()} 00:00"
        )

        sessions = calendar.sessions_in_range(
            today_timestamp,
            today_timestamp,
        )

        if len(sessions) == 0:
            return "market_closed"

        if latest_trading_day == today.isoformat():
            return "current"

        return "data_delayed"

    except Exception as error:

        print(
            "Market calendar check failed:",
            error,
        )

        return "unknown"
# ---------------------------------------------------------
# Smart Analysis
# ---------------------------------------------------------

@app.get("/market/{symbol}/smart-analysis")
async def smart_analysis(
    symbol: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    symbol = symbol.upper().strip()

    # -----------------------------------------------------
    # Validate symbol
    # -----------------------------------------------------

    if not symbol:

        return {
            "symbol": symbol,
            "status": "invalid_symbol",
            "message": "Stock symbol cannot be empty.",
            "current": None,
            "attention": None,
        }

    # -----------------------------------------------------
    # Get current quote
    # -----------------------------------------------------

    quote = await get_quote(symbol)

    # IMPORTANT:
    # Never assume the provider/cache response contains
    # "price". Validate the entire quote first.

    if not is_valid_quote(quote):

        return unavailable_market_response(
            symbol,
            quote if isinstance(quote, dict) else None,
        )

    # -----------------------------------------------------
    # Get historical data
    # -----------------------------------------------------

    history = await get_daily_history(symbol)

    if not history:

        return {
            "symbol": symbol,
            "status": "insufficient_data",
            "message": "Historical market data unavailable",
            "current": {
                "price": quote["price"],
                "change": quote["change"],
                "change_percent": quote["change_percent"],
                "volume": quote["volume"],
                "latest_trading_day": quote["latest_trading_day"],
                "data_source": quote.get(
                    "data_source",
                    "unknown",
                ),
                "data_status": quote.get(
                    "data_status",
                    "unknown",
                ),
            },
            "attention": None,
            "since_last_checked": {
                "previous_price": None,
                "change_percent": None,
                "has_previous_snapshot": False,
            },
            "data_quality": {
            "status": quote.get(
                "data_status",
                "unknown",
            ),
            "source": quote.get(
                "data_source"
            ),
            "message": (
                quote.get(
                    "data_quality_message"
                )
                or quote.get(
                    "stale_reason"
                )
                or (
                    f"Market data received from "
                    f"{quote.get('data_source', 'provider')}."
                )
            ),
            "provider_comparison": quote.get(
                "provider_comparison"
            ),
        },
        }

    # -----------------------------------------------------
    # Calculate benchmark return
    # -----------------------------------------------------

    benchmark_history = await get_daily_history("SPY")

    benchmark_return = None

    if benchmark_history and len(benchmark_history) >= 2:

        benchmark_data = sorted(
            benchmark_history,
            key=lambda item: item["date"],
        )

        previous_close = benchmark_data[-2]["close"]
        current_close = benchmark_data[-1]["close"]

        if previous_close != 0:

            benchmark_return = (
                current_close
                - previous_close
            ) / previous_close

    # -----------------------------------------------------
    # Calculate attention score
    # (NEW: shared per-symbol cache instead of a fresh
    # calculate_unusual_move() call per user per request)
    # -----------------------------------------------------

    analysis = get_cached_attention(
        symbol,
        history,
        benchmark_return,
    )
    # -----------------------------------------------------
    # Persist attention score for audit/history
    # -----------------------------------------------------
    if analysis:
        metrics = analysis.get("metrics", {})

        current_score = int(analysis.get("score", 0))
        current_today_return = str(
            metrics.get("today_return_percent", 0)
        )
        current_volume_ratio = str(
            metrics.get("volume_ratio", 0)
        )

        latest_attention = (
            db.query(AttentionScore)
            .filter(AttentionScore.symbol == symbol)
            .order_by(AttentionScore.computed_at.desc())
            .first()
        )

        # Store a new history record only when the signal changes.
        if not (
            latest_attention
            and latest_attention.score == current_score
            and latest_attention.today_return == current_today_return
            and latest_attention.volume_ratio == current_volume_ratio
        ):
            attention_history = AttentionScore(
                symbol=symbol,
                score=current_score,
                reasons=analysis.get("reasons", []),
                severity=analysis.get("severity", "low"),
                computed_at=datetime.now(timezone.utc),
                today_return=current_today_return,
                volume_ratio=current_volume_ratio,
                explanation=analysis.get(
                    "explanation",
                    "No explanation available."
                ),
            )

            db.add(attention_history)
            db.commit()
    if not analysis:

        return {
            "symbol": symbol,
            "status": "insufficient_data",
            "message": "Not enough historical data",
            "current": {
                "price": quote["price"],
                "change": quote["change"],
                "change_percent": quote["change_percent"],
                "volume": quote["volume"],
                "latest_trading_day": quote["latest_trading_day"],
                "data_source": quote.get(
                    "data_source",
                    "unknown",
                ),
                "data_status": quote.get(
                    "data_status",
                    "unknown",
                ),
            },
            "attention": None,
            "since_last_checked": {
                "previous_price": None,
                "change_percent": None,
                "has_previous_snapshot": False,
            },
            "data_quality": {
                "status": quote.get(
                    "data_status",
                    "unknown",
                ),
                "source": quote.get(
                    "data_source",
                    "unknown",
                ),
                "message": (
                    "Not enough historical data "
                    "to calculate an attention score."
                ),
            },
        }

    # -----------------------------------------------------
    # User's previous snapshot
    # -----------------------------------------------------

    snapshot = (
        db.query(UserSymbolSnapshot)
        .filter(
            UserSymbolSnapshot.user_id == current_user.id,
            UserSymbolSnapshot.symbol == symbol,
        )
        .first()
    )

    previous_price = None
    since_last_checked = None
    previous_attention_score = None
    attention_score_change = None
    checked_at = None

    if snapshot:
        try:
            previous_price = float(snapshot.price)
        except (TypeError, ValueError):
            previous_price = None

        try:
            previous_attention_score = float(
                snapshot.attention_score
            )
        except (TypeError, ValueError):
            previous_attention_score = None

        checked_at = snapshot.checked_at

        if previous_price is not None and previous_price != 0:
            current_price = float(quote["price"])

            since_last_checked = (
                (
                    current_price
                    - previous_price
                )
                / previous_price
            ) * 100

        if previous_attention_score is not None:
            current_attention_score = float(
                analysis["score"]
            )

            attention_score_change = (
                current_attention_score
                - previous_attention_score
            )

    # -----------------------------------------------------
    # Data quality
    # -----------------------------------------------------

    data_status = quote.get(
        "data_status",
        "unknown",
    )

    data_source = quote.get(
        "data_source",
        "unknown",
    )

    latest_trading_day = quote.get(
        "latest_trading_day"
    )

    # Resolve exchange metadata from the current quote.
    exchange = quote.get("exchange")

    quality_state = get_market_session_state(
        exchange,
        latest_trading_day,
    )


    if data_status == "stale":

        quality_message = (
            "Live market data is unavailable. "
            "Showing last-known-good data."
        )

        quality_state = "stale"


    elif data_status == "conflict":

        quality_message = (
            quote.get(
                "data_quality_message"
            )
            or (
                "Live providers returned "
                "conflicting market data."
            )
        )

        quality_state = "conflict"


    elif quality_state == "market_closed":

        quality_message = (
            f"The market is closed today. "
            f"Showing the latest available data "
            f"from {latest_trading_day}."
        )


    elif quality_state == "current":

        quality_message = (
            f"Current market data received "
            f"from {data_source}."
        )


    elif quality_state == "data_delayed":

        quality_message = (
            f"Today is a trading day, but today's "
            f"market data is not yet available. "
            f"Latest available data is from "
            f"{latest_trading_day}."
        )


    else:

        quality_message = (
            "Market data freshness could not "
            "be verified."
        )

        quality_state = "unknown"

    # -----------------------------------------------------
    # Current quote response
    # -----------------------------------------------------

    current = {

        "price": quote["price"],

        "change": quote["change"],

        "change_percent": (
            quote["change_percent"]
        ),

        "volume": quote["volume"],

        "latest_trading_day": (
            quote["latest_trading_day"]
        ),

        "data_source": data_source,

        "data_status": data_status,

    }

    # -----------------------------------------------------
    # Final response
    # -----------------------------------------------------

    return {

        "symbol": symbol,

        "status": "ok",

        "current": current,

        "data_quality": {

            "status": data_status,
            "state": quality_state,
            "source": data_source,
            "message": quality_message,
            "latest_trading_day": latest_trading_day,

        },

        "attention": analysis,

        "since_last_checked": {
        "previous_price": previous_price,
        "change_percent": (
            round(
                since_last_checked,
                2,
            )
            if since_last_checked is not None
            else None
        ),
        "has_previous_snapshot": (
            snapshot is not None
            and previous_price is not None
        ),
        "previous_attention_score": previous_attention_score,
        "attention_score_change": (
            round(attention_score_change, 2)
            if attention_score_change is not None
            else None
        ),
        "checked_at": checked_at,
    },

    }

@app.get("/market/{symbol}/attention-history")
def get_attention_history(
    symbol: str,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    symbol = symbol.upper().strip()

    if limit < 1:
        limit = 1

    if limit > 100:
        limit = 100

    history = (
        db.query(AttentionScore)
        .filter(AttentionScore.symbol == symbol)
        .order_by(AttentionScore.computed_at.desc())
        .limit(limit)
        .all()
    )

    return {
        "symbol": symbol,
        "count": len(history),
        "history": [
            {
                "id": item.id,
                "score": item.score,
                "severity": item.severity,
                "reasons": item.reasons or [],
                "today_return": float(item.today_return or 0),
                "volume_ratio": float(item.volume_ratio or 0),
                "explanation": item.explanation,
                "computed_at": item.computed_at,
            }
            for item in history
        ],
    }