from pydantic import BaseModel
from typing import List


class WatchlistCreate(BaseModel):
    name: str


class SymbolCreate(BaseModel):
    symbol: str
    exchange: str | None = None


class SymbolResponse(BaseModel):
    id: int
    symbol: str

    class Config:
        from_attributes = True


class WatchlistResponse(BaseModel):
    id: int
    name: str
    symbols: List[SymbolResponse]

    class Config:
        from_attributes = True