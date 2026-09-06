from __future__ import annotations

from statistics import mean, pstdev
from typing import Any


# =========================================================
# Configuration
# =========================================================

PRICE_SCORE_MAX = 40
VOLUME_SCORE_MAX = 30
LEVEL_SCORE_MAX = 20
RELATIVE_SCORE_MAX = 10

TOTAL_SCORE_MAX = 100


# =========================================================
# Helpers
# =========================================================

def safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None

        return float(value)

    except (TypeError, ValueError):
        return None


def clamp(
    value: float,
    minimum: float,
    maximum: float,
) -> float:
    return max(minimum, min(value, maximum))


def calculate_return(
    previous_close: float,
    current_close: float,
) -> float | None:

    if previous_close == 0:
        return None

    return (
        current_close - previous_close
    ) / previous_close


# =========================================================
# Severity
# =========================================================

def get_severity(score: int) -> str:

    if score >= 70:
        return "high"

    if score >= 40:
        return "medium"

    return "low"


# =========================================================
# Main Attention Engine
# =========================================================

def calculate_unusual_move(
    history: list[dict[str, Any]],
    benchmark_return: float | None = None,
) -> dict[str, Any] | None:

    if not history or len(history) < 2:
        return None

    # -----------------------------------------------------
    # Clean historical records
    # -----------------------------------------------------

    cleaned: list[dict[str, float]] = []

    for item in history:

        close = safe_float(item.get("close"))
        volume = safe_float(item.get("volume"))

        if close is None or close <= 0:
            continue

        cleaned.append(
            {
                "close": close,
                "volume": volume if volume is not None else 0,
            }
        )

    if len(cleaned) < 2:
        return None

    # -----------------------------------------------------
    # Latest and previous close
    # -----------------------------------------------------

    current_close = cleaned[-1]["close"]
    previous_close = cleaned[-2]["close"]

    today_return = calculate_return(
        previous_close,
        current_close,
    )

    if today_return is None:
        return None

    today_return_percent = today_return * 100

    # -----------------------------------------------------
    # Recent returns
    # -----------------------------------------------------

    recent_returns: list[float] = []

    for index in range(
        1,
        len(cleaned),
    ):
        previous = cleaned[index - 1]["close"]
        current = cleaned[index]["close"]

        daily_return = calculate_return(
            previous,
            current,
        )

        if daily_return is not None:
            recent_returns.append(daily_return)

    # Exclude today's return when establishing the baseline
    baseline_returns = recent_returns[:-1]

    # We need enough history for a meaningful baseline
    if len(baseline_returns) < 5:
        return None

    average_return = mean(
        baseline_returns
    )

    return_std = pstdev(
        baseline_returns
    )

    # -----------------------------------------------------
    # Price movement score
    # -----------------------------------------------------

    if return_std > 0:

        z_score = (
            today_return - average_return
        ) / return_std

    else:
        z_score = 0.0

    absolute_z = abs(z_score)

    price_score = clamp(
        absolute_z / 4.0 * PRICE_SCORE_MAX,
        0,
        PRICE_SCORE_MAX,
    )

    # -----------------------------------------------------
    # Volume score
    # -----------------------------------------------------

    recent_volumes = [
        item["volume"]
        for item in cleaned[-21:-1]
        if item["volume"] > 0
    ]

    current_volume = cleaned[-1]["volume"]

    volume_ratio: float | None = None

    volume_score = 0.0

    if recent_volumes and current_volume > 0:

        average_volume = mean(
            recent_volumes
        )

        if average_volume > 0:

            volume_ratio = (
                current_volume
                / average_volume
            )

            volume_score = clamp(
                (volume_ratio - 1.0)
                / 3.0
                * VOLUME_SCORE_MAX,
                0,
                VOLUME_SCORE_MAX,
            )

    # -----------------------------------------------------
    # 52-week level score
    # -----------------------------------------------------

    closes = [
        item["close"]
        for item in cleaned
    ]

    recent_52w = closes[-252:]

    highest_52w = max(
        recent_52w
    )

    lowest_52w = min(
        recent_52w
    )

    level_score = 0.0

    level_signal: str | None = None

    # New 52-week high
    if (
        current_close >= highest_52w
        and len(recent_52w) > 1
    ):

        level_score = LEVEL_SCORE_MAX
        level_signal = "52-week high"

    # New 52-week low
    elif (
        current_close <= lowest_52w
        and len(recent_52w) > 1
    ):

        level_score = LEVEL_SCORE_MAX
        level_signal = "52-week low"

    else:

        # Proximity to 52-week extremes
        high_distance = (
            highest_52w - current_close
        ) / highest_52w

        low_distance = (
            current_close - lowest_52w
        ) / lowest_52w

        if high_distance <= 0.03:

            level_score = LEVEL_SCORE_MAX * 0.6
            level_signal = "near 52-week high"

        elif low_distance <= 0.03:

            level_score = LEVEL_SCORE_MAX * 0.6
            level_signal = "near 52-week low"

    # -----------------------------------------------------
    # Market-relative score
    # -----------------------------------------------------

    relative_score = 0.0
    relative_return = None

    if benchmark_return is not None:

        relative_return = (
            today_return
            - benchmark_return
        )

        relative_score = clamp(
            abs(relative_return)
            / 0.05
            * RELATIVE_SCORE_MAX,
            0,
            RELATIVE_SCORE_MAX,
        )

    # -----------------------------------------------------
    # Final score
    # -----------------------------------------------------

    raw_score = (
        price_score
        + volume_score
        + level_score
        + relative_score
    )

    score = int(
        round(
            clamp(
                raw_score,
                0,
                TOTAL_SCORE_MAX,
            )
        )
    )

    severity = get_severity(score)

    # -----------------------------------------------------
    # Build explanations
    # -----------------------------------------------------

    reasons: list[str] = []
    signals: list[str] = []

    # Price signal
    if absolute_z >= 2:

        direction = (
            "up"
            if today_return_percent > 0
            else "down"
        )

        reasons.append(
            f"Price moved {abs(today_return_percent):.2f}% "
            f"{direction}, which is unusual versus recent trading."
        )

        signals.append(
            "Unusual price movement"
        )

    elif abs(today_return_percent) >= 2:

        reasons.append(
            f"Price moved {abs(today_return_percent):.2f}% today."
        )

        signals.append(
            "Large price movement"
        )

    # Volume signal
    if volume_ratio is not None:

        if volume_ratio >= 2:

            reasons.append(
                f"Trading volume is {volume_ratio:.1f}× "
                "the recent average."
            )

            signals.append(
                "Volume spike"
            )

        elif volume_ratio >= 1.5:

            reasons.append(
                f"Trading volume is {volume_ratio:.1f}× "
                "the recent average."
            )

            signals.append(
                "Elevated volume"
            )

    # 52-week signal
    if level_signal:

        reasons.append(
            f"Stock is at a {level_signal}."
        )

        signals.append(
            level_signal.capitalize()
        )

    # Relative signal
    if relative_return is not None:

        relative_percent = (
            relative_return * 100
        )

        if abs(relative_percent) >= 1:

            direction = (
                "outperformed"
                if relative_percent > 0
                else "underperformed"
            )

            reasons.append(
                f"Stock {direction} the broad market "
                f"by {abs(relative_percent):.2f}%."
            )

            signals.append(
                "Market-relative movement"
            )

    # -----------------------------------------------------
    # Fallback explanation
    # -----------------------------------------------------

    if not reasons:

        reasons.append(
            "No major unusual signal was detected."
        )

    if not signals:

        signals.append(
            "Normal market movement"
        )

    # -----------------------------------------------------
    # Human-readable summary
    # -----------------------------------------------------

    if severity == "high":

        explanation = (
            "Multiple meaningful signals suggest "
            "this stock deserves attention now."
        )

    elif severity == "medium":

        explanation = (
            "The stock shows some unusual activity "
            "worth monitoring."
        )

    else:

        explanation = (
            "No strong abnormal movement was detected."
        )

    # -----------------------------------------------------
    # Return analysis
    # -----------------------------------------------------

    return {
        "score": score,

        "severity": severity,

        "explanation": explanation,

        "reasons": reasons,

        "signals": signals,

        "metrics": {
            "today_return_percent": round(
                today_return_percent,
                2,
            ),

            "z_score": round(
                z_score,
                2,
            ),

            "volume_ratio": (
                round(
                    volume_ratio,
                    2,
                )
                if volume_ratio is not None
                else None
            ),

            "relative_return_percent": (
                round(
                    relative_return * 100,
                    2,
                )
                if relative_return is not None
                else None
            ),

            "highest_52w": round(
                highest_52w,
                2,
            ),

            "lowest_52w": round(
                lowest_52w,
                2,
            ),
        },

        "score_breakdown": {
            "price_move": round(
                price_score,
                1,
            ),

            "volume": round(
                volume_score,
                1,
            ),

            "52_week_level": round(
                level_score,
                1,
            ),

            "market_relative": round(
                relative_score,
                1,
            ),
        },
    }