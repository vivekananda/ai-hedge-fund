from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List

from src.db.connection import SessionLocal
from src.db.queries import (
    get_watchlists,
    create_or_update_watchlist,
    delete_watchlist,
    ensure_stock,
)

router = APIRouter(prefix="/watchlists")

# Dependency to get db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class WatchlistRequest(BaseModel):
    name: str
    tickers: List[str]


class WatchlistResponse(BaseModel):
    id: int
    name: str
    tickers: List[str]
    created_at: str


def normalize_ticker(ticker: str) -> str:
    """Normalize wishlist tickers to the NSE yfinance symbol style used by the app."""
    clean = ticker.strip().upper()
    if not clean:
        return ""
    return clean if "." in clean else f"{clean}.NS"


@router.get("", response_model=List[WatchlistResponse])
def list_watchlists(db: Session = Depends(get_db)):
    """Retrieve all saved named watchlists."""
    try:
        watchlists = get_watchlists(db)
        
        # Check if "Nifty 500" watchlist exists. If not, dynamically construct it using the synced nifty 500 stocks.
        nifty500_exists = any(w.name == "Nifty 500" for w in watchlists)
        if not nifty500_exists:
            from src.db.queries import get_nifty500_stocks
            nifty_stocks = get_nifty500_stocks(db)
            if nifty_stocks:
                create_or_update_watchlist(db, "Nifty 500", [s.symbol for s in nifty_stocks])
                watchlists = get_watchlists(db) # Refresh list
                
        return [
            WatchlistResponse(
                id=w.id,
                name=w.name,
                tickers=w.tickers.split(",") if w.tickers else [],
                created_at=w.created_at
            ) for w in watchlists
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching watchlists: {str(e)}")


@router.post("", response_model=WatchlistResponse)
def save_watchlist(request: WatchlistRequest, db: Session = Depends(get_db)):
    """Create or update a named watchlist."""
    try:
        if not request.name.strip():
            raise HTTPException(status_code=400, detail="Watchlist name cannot be empty")

        tickers = []
        seen = set()
        for ticker in request.tickers:
            normalized = normalize_ticker(ticker)
            if normalized and normalized not in seen:
                tickers.append(normalized)
                seen.add(normalized)

        for ticker in tickers:
            ensure_stock(db, symbol=ticker, name=ticker, is_nifty500=False)
        
        watchlist = create_or_update_watchlist(
            db=db,
            name=request.name.strip(),
            tickers=tickers
        )
        return WatchlistResponse(
            id=watchlist.id,
            name=watchlist.name,
            tickers=watchlist.tickers.split(",") if watchlist.tickers else [],
            created_at=watchlist.created_at
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving watchlist: {str(e)}")


@router.delete("/{name}")
def remove_watchlist(name: str, db: Session = Depends(get_db)):
    """Delete a watchlist by name."""
    try:
        deleted = delete_watchlist(db, name)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Watchlist with name '{name}' not found")
        return {"message": f"Watchlist '{name}' deleted successfully"}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting watchlist: {str(e)}")
