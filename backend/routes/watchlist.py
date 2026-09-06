from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import User, Watchlist, WatchlistSymbol
from schemas import WatchlistCreate, SymbolCreate
from auth import get_current_user


router = APIRouter(
    prefix="/watchlists",
    tags=["Watchlists"],
)


# =========================================================
# Create Watchlist
# =========================================================

@router.post("")
def create_watchlist(
    data: WatchlistCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = data.name.strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Watchlist name cannot be empty",
        )

    watchlist = Watchlist(
        user_id=current_user.id,
        name=name,
    )

    db.add(watchlist)
    db.commit()
    db.refresh(watchlist)

    return {
        "id": watchlist.id,
        "name": watchlist.name,
        "symbols": [],
    }


# =========================================================
# Get User's Watchlists
# =========================================================

@router.get("")
def get_watchlists(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    watchlists = (
        db.query(Watchlist)
        .filter(
            Watchlist.user_id == current_user.id
        )
        .all()
    )

    return [
        {
            "id": watchlist.id,
            "name": watchlist.name,
            "symbols": [
                symbol.symbol
                for symbol in watchlist.symbols
            ],
        }
        for watchlist in watchlists
    ]


# =========================================================
# Get Single Watchlist
# =========================================================

@router.get("/{watchlist_id}")
def get_watchlist(
    watchlist_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    watchlist = (
        db.query(Watchlist)
        .filter(
            Watchlist.id == watchlist_id,
            Watchlist.user_id == current_user.id,
        )
        .first()
    )

    if not watchlist:
        raise HTTPException(
            status_code=404,
            detail="Watchlist not found",
        )

    return {
        "id": watchlist.id,
        "name": watchlist.name,
        "symbols": [
            symbol.symbol
            for symbol in watchlist.symbols
        ],
    }


# =========================================================
# Add Symbol
# =========================================================

@router.post("/{watchlist_id}/symbols")
def add_symbol(
    watchlist_id: int,
    data: SymbolCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    watchlist = (
        db.query(Watchlist)
        .filter(
            Watchlist.id == watchlist_id,
            Watchlist.user_id == current_user.id,
        )
        .first()
    )

    if not watchlist:
        raise HTTPException(
            status_code=404,
            detail="Watchlist not found",
        )

    symbol = data.symbol.upper().strip()
    exchange = (
    data.exchange.upper().strip()
    if data.exchange
    else None
)
    if not symbol:
        raise HTTPException(
            status_code=400,
            detail="Symbol cannot be empty",
        )

    existing = (
        db.query(WatchlistSymbol)
        .filter(
            WatchlistSymbol.watchlist_id == watchlist_id,
            WatchlistSymbol.symbol == symbol,
        )
        .first()
    )

    if existing:
        raise HTTPException(
            status_code=409,
            detail="Symbol already exists in watchlist",
        )

    watchlist_symbol = WatchlistSymbol(
        watchlist_id=watchlist_id,
        symbol=symbol,
        exchange=exchange,
    )

    db.add(watchlist_symbol)
    db.commit()
    db.refresh(watchlist_symbol)

    return {
        "message": "Symbol added successfully",
        "symbol": symbol,
        "exchange": exchange,
    }


# =========================================================
# Remove Symbol
# =========================================================

@router.delete("/{watchlist_id}/symbols/{symbol}")
def remove_symbol(
    watchlist_id: int,
    symbol: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    symbol = symbol.upper().strip()

    watchlist_symbol = (
        db.query(WatchlistSymbol)
        .join(Watchlist)
        .filter(
            Watchlist.id == watchlist_id,
            Watchlist.user_id == current_user.id,
            WatchlistSymbol.symbol == symbol,
        )
        .first()
    )

    if not watchlist_symbol:
        raise HTTPException(
            status_code=404,
            detail="Symbol not found",
        )

    db.delete(watchlist_symbol)
    db.commit()

    return {
        "message": "Symbol removed successfully",
        "symbol": symbol,
    }

@router.delete("/{watchlist_id}")
def delete_watchlist(
    watchlist_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    watchlist = (
        db.query(Watchlist)
        .filter(
            Watchlist.id == watchlist_id,
            Watchlist.user_id == current_user.id,
        )
        .first()
    )

    if not watchlist:
        raise HTTPException(
            status_code=404,
            detail="Watchlist not found.",
        )

    # Remove symbols belonging to this watchlist first.
    db.query(WatchlistSymbol).filter(
        WatchlistSymbol.watchlist_id == watchlist.id
    ).delete(
        synchronize_session=False
    )

    db.delete(watchlist)
    db.commit()

    return {
        "status": "ok",
        "message": "Watchlist deleted successfully.",
        "watchlist_id": watchlist_id,
    }