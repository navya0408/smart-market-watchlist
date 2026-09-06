import os
import time
import json
import httpx
import asyncio

from datetime import datetime

from dotenv import load_dotenv

from database import SessionLocal
from models import MarketQuoteCache, MarketHistoryCache


load_dotenv()


# =========================================================
# Configuration
# =========================================================

API_KEY = os.getenv("ALPHA_VANTAGE_API_KEY")

ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query"
# =========================================================
# Alpha Vantage request throttling
# =========================================================

_alpha_request_lock = asyncio.Lock()
_last_alpha_request_time = 0.0

# NEW: tracks how many requests are currently waiting on the
# Alpha Vantage throttle lock. Exposed via get_alpha_queue_depth()
# so the background refresher (background_refresh.py) can back off
# and prioritize live user requests when the free-tier budget is
# already under pressure, instead of piling more requests behind
# the ones already queued.
_alpha_queue_depth = 0


async def _alpha_get(params: dict):
    """
    Space Alpha Vantage requests so concurrent dashboard
    requests do not hit the free-tier burst limit.
    """
    global _last_alpha_request_time, _alpha_queue_depth

    _alpha_queue_depth += 1

    try:
        async with _alpha_request_lock:
            elapsed = time.time() - _last_alpha_request_time

            if elapsed < 1.1:
                await asyncio.sleep(1.1 - elapsed)

            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    ALPHA_VANTAGE_URL,
                    params=params,
                )

            _last_alpha_request_time = time.time()

            return response
    finally:
        _alpha_queue_depth -= 1


def get_alpha_queue_depth() -> int:
    """
    NEW: How many requests are currently queued behind the Alpha
    Vantage throttle lock. Used by the background refresher to
    detect when the shared rate-limit budget is under pressure and
    to slow itself down rather than compete with live user
    requests for the same limited quota.
    """
    return _alpha_queue_depth


YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart"


# =========================================================
# In-memory cache
# =========================================================

quote_cache = {}
history_cache = {}

# 30 minutes
CACHE_TTL = 1800


# =========================================================
# In-memory cache helpers
# =========================================================

def _get_cached(
    cache: dict,
    symbol: str,
    allow_stale: bool = False,
):
    """
    Get an item from the in-memory cache.

    Fresh entries are returned normally.

    Stale entries are returned only when allow_stale=True.

    This is important because stale data should not prevent
    the application from trying the external providers again.
    """

    item = cache.get(symbol)

    if not item:
        return None

    data, cached_at = item

    # Defensive handling in case an old cache entry contains
    # a datetime instead of a Unix timestamp.
    if isinstance(cached_at, datetime):
        age = (
            datetime.now() - cached_at
        ).total_seconds()
    else:
        try:
            age = time.time() - float(cached_at)
        except (TypeError, ValueError):
            return None

    # Fresh
    if age <= CACHE_TTL:
        return data

    # Stale
    if allow_stale:
        return data

    return None


def _set_cached(
    cache: dict,
    symbol: str,
    data,
):
    """
    Store data using one consistent timestamp format:
    Unix time as float.
    """

    cache[symbol] = (
        data,
        time.time(),
    )


# =========================================================
# Alpha Vantage - Current Quote
# =========================================================

async def _alpha_quote(symbol: str):

    if not API_KEY:
        return None

    params = {
        "function": "GLOBAL_QUOTE",
        "symbol": symbol,
        "apikey": API_KEY,
    }

    try:

        response = await _alpha_get(params)

        response.raise_for_status()

        data = response.json()

        # API information / quota response
        if "Information" in data:
            print("Alpha Vantage returned an informational response.")
            return None

        # API rate limit response
        if "Note" in data:

            print(
                "Alpha Vantage rate limit reached - using fallback."
            )

            return None

        quote = data.get("Global Quote")

        if not quote:
            return None

        raw_price = quote.get("05. price")

        if raw_price is None:
            return None

        return {
            "symbol": (
                quote.get("01. symbol")
                or symbol
            ),

            "price": float(raw_price),

            "change": float(
                quote.get("09. change", 0)
            ),

            "change_percent": (
                quote.get(
                    "10. change percent",
                    "0.00%",
                )
            ),

            "volume": int(
                float(
                    quote.get(
                        "06. volume",
                        0,
                    )
                )
            ),

            "latest_trading_day": (
                quote.get(
                    "07. latest trading day"
                )
            ),

            "data_source": "Alpha Vantage",

            "data_status": "fresh",
            "exchange": None,  # Alpha Vantage does not provide exchange info
        }

    except Exception as error:

        print(
            "Alpha Vantage error:",
            error,
        )

        return None


# =========================================================
# Alpha Vantage - Historical Data
# =========================================================

async def _alpha_history(symbol: str):

    if not API_KEY:
        return None

    params = {
        "function": "TIME_SERIES_DAILY",
        "symbol": symbol,
        "outputsize": "compact",
        "apikey": API_KEY,
    }

    try:

        response = await _alpha_get(params)

        response.raise_for_status()

        data = response.json()

        if "Information" in data:

            print("Alpha Vantage History returned an informational response.")

            return None

        if "Note" in data:

            print(
                "Alpha Vantage rate limit reached - using fallback."
            )

            return None

        time_series = data.get(
            "Time Series (Daily)"
        )

        if not time_series:
            return None

        history = []

        for date, values in time_series.items():

            try:

                history.append(
                    {
                        "date": date,

                        "open": float(
                            values["1. open"]
                        ),

                        "high": float(
                            values["2. high"]
                        ),

                        "low": float(
                            values["3. low"]
                        ),

                        "close": float(
                            values["4. close"]
                        ),

                        "volume": int(
                            float(
                                values[
                                    "5. volume"
                                ]
                            )
                        ),
                    }
                )

            except (
                KeyError,
                TypeError,
                ValueError,
            ):

                continue

        # Oldest → newest
        history.sort(
            key=lambda item: item["date"]
        )

        if not history:
            return None

        return history

    except Exception as error:

        print(
            "Alpha Vantage history error:",
            error,
        )

        return None

async def _resolve_yahoo_symbol(symbol: str):
    """
    Resolve ambiguous symbols through Yahoo Finance search.

    Returns the best matching Yahoo ticker, or the original symbol
    when no better match is found.
    """

    url = "https://query1.finance.yahoo.com/v1/finance/search"

    params = {
        "q": symbol,
        "quotesCount": 10,
        "newsCount": 0,
    }

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
            headers={"User-Agent": "Mozilla/5.0"},
        ) as client:
            response = await client.get(
                url,
                params=params,
            )

        response.raise_for_status()

        data = response.json()
        quotes = data.get("quotes", [])

        if not quotes:
            return symbol

        # Prefer an exact ticker match.
        exact_matches = [
            item
            for item in quotes
            if str(item.get("symbol", "")).upper() == symbol.upper()
        ]

        if exact_matches:
            return exact_matches[0].get("symbol", symbol)

        # Otherwise use the first valid equity result.
        for item in quotes:
            if item.get("quoteType") == "EQUITY":
                resolved = item.get("symbol")
                if resolved:
                    return resolved

        return symbol

    except Exception as error:
        print(
            f"Yahoo symbol resolution failed for {symbol}: {error}"
        )
        return symbol
# =========================================================
# Yahoo Finance Fallback
# =========================================================

async def _yahoo_data(symbol: str):
    """
    Yahoo Finance provides both:

    - current quote
    - daily OHLCV history

    Returns:

    {
        "quote": {...},
        "history": [...]
    }
    """

    resolved_symbol = await _resolve_yahoo_symbol(symbol)

    url = f"{YAHOO_URL}/{resolved_symbol}"

    params = {
        "range": "1y",
        "interval": "1d",
        "includePrePost": "false",
        "events": "div,splits",
    }

    try:

        async with httpx.AsyncClient(
            timeout=15.0,
            headers={
                "User-Agent": "Mozilla/5.0"
            },
        ) as client:

            response = await client.get(
                url,
                params=params,
            )

        response.raise_for_status()

        data = response.json()

        result = (
            data
            .get("chart", {})
            .get("result")
        )

        if not result:
            return None

        result = result[0]

        timestamps = result.get(
            "timestamp",
            [],
        )

        indicators = result.get(
            "indicators",
            {},
        )

        quote_data = indicators.get(
            "quote",
            [{}],
        )[0]

        opens = quote_data.get(
            "open",
            [],
        )

        highs = quote_data.get(
            "high",
            [],
        )

        lows = quote_data.get(
            "low",
            [],
        )

        closes = quote_data.get(
            "close",
            [],
        )

        volumes = quote_data.get(
            "volume",
            [],
        )

        history = []

        for index, timestamp in enumerate(
            timestamps
        ):

            if index >= len(closes):
                continue

            close = closes[index]

            if close is None:
                continue

            open_price = (
                opens[index]
                if index < len(opens)
                else None
            )

            high_price = (
                highs[index]
                if index < len(highs)
                else None
            )

            low_price = (
                lows[index]
                if index < len(lows)
                else None
            )

            volume = (
                volumes[index]
                if index < len(volumes)
                else 0
            )

            if open_price is None:
                open_price = close

            if high_price is None:
                high_price = close

            if low_price is None:
                low_price = close

            if volume is None:
                volume = 0

            # Unix timestamp → YYYY-MM-DD
            date = time.strftime(
                "%Y-%m-%d",
                time.gmtime(timestamp),
            )

            try:

                history.append(
                    {
                        "date": date,

                        "open": float(
                            open_price
                        ),

                        "high": float(
                            high_price
                        ),

                        "low": float(
                            low_price
                        ),

                        "close": float(
                            close
                        ),

                        "volume": int(
                            volume
                        ),
                    }
                )

            except (
                TypeError,
                ValueError,
            ):

                continue

        # Oldest → newest
        history.sort(
            key=lambda item: item["date"]
        )

        if not history:
            return None

        # -------------------------------------------------
        # Current quote
        # -------------------------------------------------

        meta = result.get(
            "meta",
            {},
        )
        exchange = (
    meta.get("exchangeName")
    or meta.get("fullExchangeName")
    or meta.get("exchange")
)
       
        current_price = meta.get(
            "regularMarketPrice"
        )

        previous_close = meta.get(
            "previousClose"
        )

        # Fallback to latest historical close
        if current_price is None:

            current_price = history[-1][
                "close"
            ]

        if previous_close is None:

            if len(history) > 1:

                previous_close = history[-2][
                    "close"
                ]

            else:

                previous_close = current_price

        try:

            current_price = float(
                current_price
            )

            previous_close = float(
                previous_close
            )

        except (
            TypeError,
            ValueError,
        ):

            return None

        change = (
            current_price
            - previous_close
        )

        if previous_close != 0:

            change_percent_value = (
                change
                / previous_close
            ) * 100

        else:

            change_percent_value = 0

        latest_volume = history[-1][
            "volume"
        ]

        latest_trading_day = history[-1][
            "date"
        ]

        quote = {
            "symbol": symbol,
            "provider_symbol": resolved_symbol,
            "price": round(
                current_price,
                2,
            ),

            "change": round(
                change,
                2,
            ),

            "change_percent": (
                f"{change_percent_value:.2f}%"
            ),

            "volume": latest_volume,

            "latest_trading_day": (
                latest_trading_day
            ),

            "data_source": "Yahoo Finance",

            "data_status": "fresh",
            "exchange": exchange,
            "exchange_name": meta.get("fullExchangeName"),
        }

        return {
            "quote": quote,
            "history": history,
        }

    except Exception as error:

        print(
            "Yahoo Finance error:",
            error,
        )

        return None


# =========================================================
# PostgreSQL - Quote Cache Read
# =========================================================

def _get_cached_quote_from_db(
    symbol: str,
):

    db = SessionLocal()

    try:

        cached = (
            db.query(MarketQuoteCache)
            .filter(
                MarketQuoteCache.symbol
                == symbol
            )
            .first()
        )

        if not cached:
            return None

        return {
            "symbol": cached.symbol,

            "price": float(
                cached.price
            ),

            "change": float(
                cached.change
            ),

            "change_percent": (
                cached.change_percent
            ),

            "volume": int(
                float(cached.volume)
            ),

            "latest_trading_day": (
                cached.latest_trading_day
            ),

            "data_source": (
                cached.data_source
            ),

            "data_status": "stale",

            "stale_reason": (
                "Live providers were unavailable. "
                "Showing last-known-good data "
                "from persistent cache."
            ),
        }

    except Exception as error:

        print(
            "Persistent quote cache read failed:",
            error,
        )

        return None

    finally:

        db.close()


# =========================================================
# PostgreSQL - Quote Cache Save
# =========================================================

def _save_quote_to_db(
    quote: dict,
):

    if not isinstance(
        quote,
        dict,
    ):
        return

    symbol = quote.get(
        "symbol"
    )

    if not symbol:
        return

    required_fields = [
        "price",
        "change",
        "change_percent",
        "volume",
        "latest_trading_day",
    ]

    for field in required_fields:

        if field not in quote:
            return

    symbol = (
        str(symbol)
        .upper()
        .strip()
    )

    db = SessionLocal()

    try:

        cached = (
            db.query(MarketQuoteCache)
            .filter(
                MarketQuoteCache.symbol
                == symbol
            )
            .first()
        )

        if cached:

            cached.price = str(
                quote["price"]
            )

            cached.change = str(
                quote["change"]
            )

            cached.change_percent = str(
                quote["change_percent"]
            )

            cached.volume = str(
                quote["volume"]
            )

            cached.latest_trading_day = str(
                quote["latest_trading_day"]
            )

            cached.data_source = quote.get(
                "data_source",
                "Unknown",
            )

            cached.cached_at = (
                datetime.utcnow()
            )

        else:

            cached = MarketQuoteCache(

                symbol=symbol,

                price=str(
                    quote["price"]
                ),

                change=str(
                    quote["change"]
                ),

                change_percent=str(
                    quote["change_percent"]
                ),

                volume=str(
                    quote["volume"]
                ),

                latest_trading_day=str(
                    quote["latest_trading_day"]
                ),

                data_source=quote.get(
                    "data_source",
                    "Unknown",
                ),

                cached_at=(
                    datetime.utcnow()
                ),
            )

            db.add(cached)

        db.commit()

    except Exception as error:

        db.rollback()

        print(
            "Persistent quote cache save failed:",
            error,
        )

    finally:

        db.close()


# =========================================================
# PostgreSQL - History Cache Read
# =========================================================

def _get_cached_history_from_db(
    symbol: str,
):

    db = SessionLocal()

    try:

        cached = (
            db.query(MarketHistoryCache)
            .filter(
                MarketHistoryCache.symbol
                == symbol
            )
            .first()
        )

        if not cached:
            return None

        history = json.loads(
            cached.history_json
        )

        if not isinstance(
            history,
            list,
        ):
            return None

        return history

    except Exception as error:

        print(
            "Persistent history cache read failed:",
            error,
        )

        return None

    finally:

        db.close()


# =========================================================
# PostgreSQL - History Cache Save
# =========================================================

def _save_history_to_db(
    symbol: str,
    history: list,
):

    if not history:
        return

    db = SessionLocal()

    try:

        cached = (
            db.query(MarketHistoryCache)
            .filter(
                MarketHistoryCache.symbol
                == symbol
            )
            .first()
        )

        history_json = json.dumps(
            history
        )

        if cached:

            cached.history_json = (
                history_json
            )

            cached.cached_at = (
                datetime.utcnow()
            )

        else:

            cached = MarketHistoryCache(

                symbol=symbol,

                history_json=history_json,

                cached_at=(
                    datetime.utcnow()
                ),
            )

            db.add(cached)

        db.commit()

    except Exception as error:

        db.rollback()

        print(
            "Persistent history cache save failed:",
            error,
        )

    finally:

        db.close()

# =========================================================
# Provider Conflict Detection
# =========================================================

def _compare_provider_quotes(
    primary_quote: dict,
    secondary_quote: dict,
):
    """
    Compare live provider prices.

    A small difference is expected because providers may update
    at slightly different times. A large difference is treated
    as a provider conflict.
    """

    if not isinstance(primary_quote, dict):
        return None

    if not isinstance(secondary_quote, dict):
        return None

    try:
        primary_price = float(primary_quote["price"])
        secondary_price = float(secondary_quote["price"])
    except (KeyError, TypeError, ValueError):
        return None

    if primary_price <= 0 or secondary_price <= 0:
        return None

    difference_percent = (
        abs(primary_price - secondary_price)
        / ((primary_price + secondary_price) / 2)
    ) * 100

    conflict_threshold = 2.0

    return {
        "status": (
            "conflict"
            if difference_percent > conflict_threshold
            else "agree"
        ),
        "primary_source": primary_quote.get(
            "data_source",
            "Unknown",
        ),
        "secondary_source": secondary_quote.get(
            "data_source",
            "Unknown",
        ),
        "primary_price": round(primary_price, 2),
        "secondary_price": round(secondary_price, 2),
        "difference_percent": round(
            difference_percent,
            2,
        ),
        "threshold_percent": conflict_threshold,
    }
# =========================================================
# Public: Current Quote
# =========================================================

async def get_quote(
    symbol: str,
):

    symbol = (
        symbol
        .upper()
        .strip()
    )

    if not symbol:
        return None

    # -----------------------------------------------------
    # 1. Fresh in-memory cache
    # -----------------------------------------------------

    cached = _get_cached(
        quote_cache,
        symbol,
        allow_stale=False,
    )

    if cached:

        return {
            **cached,
            "data_status": "fresh",
        }

    # -----------------------------------------------------
    # 2. Alpha Vantage + Yahoo provider comparison
    # -----------------------------------------------------

    quote = await _alpha_quote(
        symbol
    )

    if quote:

        # Ask the secondary provider as well so we can
        # detect conflicting live market data.
        yahoo_result = await _yahoo_data(
            symbol
        )

        yahoo_quote = None

        if yahoo_result:
            yahoo_quote = yahoo_result.get(
                "quote"
            )
        if yahoo_quote and yahoo_quote.get("exchange"):
            quote["exchange"] = yahoo_quote["exchange"]
        provider_comparison = _compare_provider_quotes(
            quote,
            yahoo_quote,
        )
        
        if provider_comparison:

            quote["provider_comparison"] = (
                provider_comparison
            )

            if provider_comparison["status"] == "conflict":

                quote["data_status"] = "conflict"

                quote["data_quality_message"] = (
                    "Live providers returned materially "
                    "different prices. Alpha Vantage is "
                    "being used as the primary source."
                )

                print(
                    f"Provider conflict detected for {symbol}: "
                    f"{provider_comparison['primary_price']} "
                    f"vs "
                    f"{provider_comparison['secondary_price']} "
                    f"("
                    f"{provider_comparison['difference_percent']}%"
                    f")"
                )

            else:

                quote["data_quality_message"] = (
                    "Live providers agree within the "
                    "configured tolerance."
                )

        _set_cached(
            quote_cache,
            symbol,
            quote,
        )

        _save_quote_to_db(
            quote
        )

        return quote

    

        

    # -----------------------------------------------------
    # 3. Yahoo Finance fallback
    # -----------------------------------------------------

    yahoo_result = await _yahoo_data(
        symbol
    )

    if yahoo_result:

        yahoo_quote = yahoo_result.get(
            "quote"
        )

        if yahoo_quote:

            _set_cached(
                quote_cache,
                symbol,
                yahoo_quote,
            )

            _save_quote_to_db(
                yahoo_quote
            )

            return yahoo_quote

    # -----------------------------------------------------
    # 4. PostgreSQL persistent cache
    # -----------------------------------------------------

    persistent_cache = (
        _get_cached_quote_from_db(
            symbol
        )
    )

    if persistent_cache:

        return persistent_cache

    # -----------------------------------------------------
    # 5. Stale in-memory cache
    # -----------------------------------------------------

    stale_cache = _get_cached(
        quote_cache,
        symbol,
        allow_stale=True,
    )

    if stale_cache:

        return {
            **stale_cache,
            "data_status": "stale",
            "stale_reason": (
                "Live providers were unavailable. "
                "Showing last-known-good in-memory data."
            ),
        }

    # -----------------------------------------------------
    # 6. Nothing available
    # -----------------------------------------------------

    return None


# =========================================================
# Public: Historical Data
# =========================================================

async def get_daily_history(
    symbol: str,
):

    symbol = (
        symbol
        .upper()
        .strip()
    )

    if not symbol:
        return None

    # -----------------------------------------------------
    # 1. Fresh in-memory cache
    # -----------------------------------------------------

    cached = _get_cached(
        history_cache,
        symbol,
        allow_stale=False,
    )

    if cached:

        return cached

    # -----------------------------------------------------
    # 2. Alpha Vantage
    # -----------------------------------------------------

    alpha_history = await _alpha_history(
        symbol
    )

    if alpha_history:

        _set_cached(
            history_cache,
            symbol,
            alpha_history,
        )

        _save_history_to_db(
            symbol,
            alpha_history,
        )

        return alpha_history

    # -----------------------------------------------------
    # 3. Yahoo Finance fallback
    # -----------------------------------------------------

    yahoo_result = await _yahoo_data(
        symbol
    )

    if yahoo_result:

        history = yahoo_result.get(
            "history"
        )

        yahoo_quote = yahoo_result.get(
            "quote"
        )

        if history:

            _set_cached(
                history_cache,
                symbol,
                history,
            )

            _save_history_to_db(
                symbol,
                history,
            )

        if yahoo_quote:

            _set_cached(
                quote_cache,
                symbol,
                yahoo_quote,
            )

            _save_quote_to_db(
                yahoo_quote
            )

        if history:

            return history

    # -----------------------------------------------------
    # 4. PostgreSQL persistent cache
    # -----------------------------------------------------

    persistent_history = (
        _get_cached_history_from_db(
            symbol
        )
    )

    if persistent_history:

        return persistent_history

    # -----------------------------------------------------
    # 5. Stale in-memory cache
    # -----------------------------------------------------

    stale_history = _get_cached(
        history_cache,
        symbol,
        allow_stale=True,
    )

    if stale_history:

        return stale_history

    # -----------------------------------------------------
    # 6. Nothing available
    # -----------------------------------------------------

    return None