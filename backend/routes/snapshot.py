from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import UserSymbolSnapshot
from auth import get_current_user


router = APIRouter(prefix="/snapshots", tags=["Snapshots"])


@router.get("/{symbol}")
def get_snapshot(
    symbol: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    normalized_symbol = symbol.upper().strip()

    snapshot = (
        db.query(UserSymbolSnapshot)
        .filter(
            UserSymbolSnapshot.user_id == current_user.id,
            UserSymbolSnapshot.symbol == normalized_symbol,
        )
        .first()
    )

    if not snapshot:
        return {
            "status": "no_snapshot",
            "symbol": normalized_symbol,
            "has_previous_snapshot": False,
            "previous_price": None,
            "previous_attention_score": None,
            "checked_at": None,
        }

    return {
        "status": "ok",
        "symbol": normalized_symbol,
        "has_previous_snapshot": True,
        "previous_price": snapshot.price,
        "previous_attention_score": snapshot.attention_score,
        "checked_at": snapshot.checked_at,
    }


@router.post("/{symbol}")
def save_snapshot(
    symbol: str,
    price: float,
    attention_score: float,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    normalized_symbol = symbol.upper().strip()

    if not normalized_symbol:
        raise HTTPException(
            status_code=400,
            detail="Symbol cannot be empty.",
        )

    if price <= 0:
        raise HTTPException(
            status_code=400,
            detail="Price must be greater than zero.",
        )

    if attention_score < 0 or attention_score > 100:
        raise HTTPException(
            status_code=400,
            detail="Attention score must be between 0 and 100.",
        )

    snapshot = (
        db.query(UserSymbolSnapshot)
        .filter(
            UserSymbolSnapshot.user_id == current_user.id,
            UserSymbolSnapshot.symbol == normalized_symbol,
        )
        .first()
    )

    now = datetime.now(timezone.utc)

    if snapshot:
        snapshot.price = price
        snapshot.attention_score = attention_score
        snapshot.checked_at = now
    else:
        snapshot = UserSymbolSnapshot(
            user_id=current_user.id,
            symbol=normalized_symbol,
            price=price,
            attention_score=attention_score,
            checked_at=now,
        )

        db.add(snapshot)

    db.commit()
    db.refresh(snapshot)

    return {
        "status": "ok",
        "message": "Baseline saved successfully.",
        "symbol": normalized_symbol,
        "price": snapshot.price,
        "attention_score": snapshot.attention_score,
        "checked_at": snapshot.checked_at,
    }