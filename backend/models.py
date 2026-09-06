from sqlalchemy import (
    Column,
    Integer,
    String,
    ForeignKey,
    DateTime,
    UniqueConstraint,
    Text,
    JSON,
)
from sqlalchemy.orm import relationship
from datetime import datetime

from database import Base


# =========================================================
# User
# =========================================================

class User(Base):
    __tablename__ = "users"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )
    name = Column(String(100), nullable=True)
    email = Column(
        String,
        unique=True,
        nullable=False,
        index=True,
    )

    password_hash = Column(
        String,
        nullable=False,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )

    watchlists = relationship(
        "Watchlist",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    snapshots = relationship(
        "UserSymbolSnapshot",
        back_populates="user",
        cascade="all, delete-orphan",
    )


# =========================================================
# Watchlist
# =========================================================

class Watchlist(Base):
    __tablename__ = "watchlists"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    name = Column(
        String,
        nullable=False,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )

    user = relationship(
        "User",
        back_populates="watchlists",
    )

    symbols = relationship(
        "WatchlistSymbol",
        back_populates="watchlist",
        cascade="all, delete-orphan",
    )


# =========================================================
# Watchlist Symbol
# =========================================================

class WatchlistSymbol(Base):
    __tablename__ = "watchlist_symbols"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    watchlist_id = Column(
        Integer,
        ForeignKey("watchlists.id"),
        nullable=False,
    )

    symbol = Column(
        String,
        nullable=False,
    )
    exchange = Column(
    String,
    nullable=True,
)

    added_at = Column(
        DateTime,
        default=datetime.utcnow,
    )

    watchlist = relationship(
        "Watchlist",
        back_populates="symbols",
    )

    __table_args__ = (
        UniqueConstraint(
            "watchlist_id",
            "symbol",
            name="unique_watchlist_symbol",
        ),
    )


# =========================================================
# User Symbol Snapshot
# =========================================================

class UserSymbolSnapshot(Base):
    __tablename__ = "user_symbol_snapshots"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    symbol = Column(
        String,
        nullable=False,
    )

    price = Column(
        String,
        nullable=False,
    )

    attention_score = Column(
        Integer,
        default=0,
    )
    checked_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    viewed_at = Column(
        DateTime,
        default=datetime.utcnow,
    )

    user = relationship(
        "User",
        back_populates="snapshots",
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "symbol",
            name="unique_user_symbol_snapshot",
        ),
    )


# =========================================================
# Attention Score
# =========================================================

class AttentionScore(Base):
    __tablename__ = "attention_scores"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    symbol = Column(
        String,
        nullable=False,
    )

    score = Column(
        Integer,
        nullable=False,
    )
    reasons = Column(JSON, nullable=False, default=list)
    severity = Column(
        String,
        nullable=False,
    )

    computed_at = Column(DateTime(timezone=True), nullable=False)

    today_return = Column(
        String,
        nullable=False,
    )

    volume_ratio = Column(
        String,
        nullable=False,
    )

    explanation = Column(
        String,
        nullable=False,
    )

    calculated_at = Column(
        DateTime,
        default=datetime.utcnow,
    )


# =========================================================
# Persistent Market Quote Cache
# =========================================================

class MarketQuoteCache(Base):
    __tablename__ = "market_quote_cache"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    symbol = Column(
        String,
        unique=True,
        nullable=False,
        index=True,
    )

    price = Column(
        String,
        nullable=False,
    )

    change = Column(
        String,
        nullable=False,
    )

    change_percent = Column(
        String,
        nullable=False,
    )

    volume = Column(
        String,
        nullable=False,
    )

    latest_trading_day = Column(
        String,
        nullable=False,
    )

    data_source = Column(
        String,
        nullable=False,
    )

    cached_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )


# =========================================================
# Persistent Market History Cache
# =========================================================

class MarketHistoryCache(Base):
    __tablename__ = "market_history_cache"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    symbol = Column(
        String,
        unique=True,
        nullable=False,
        index=True,
    )

    history_json = Column(
        Text,
        nullable=False,
    )

    cached_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )