from datetime import datetime, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session

from app.backend.models.schemas import StockResponse, StockPrice, StockFundamental
from src.db.connection import SessionLocal
from src.db.models import Stock, DailyPrice, FundamentalsSnapshot

router = APIRouter(prefix="/stocks")

# Dependency to get db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.get("", response_model=List[StockResponse])
def get_stocks(db: Session = Depends(get_db)):
    """
    Get all stocks in the database along with their fundamental snapshot metrics
    and computed 1-year price performance.
    """
    try:
        # Load all stocks
        stocks = db.query(Stock).all()
        
        # Load all fundamentals snapshot
        fundamentals = db.query(FundamentalsSnapshot).all()
        fund_map = {f.symbol: f for f in fundamentals}
        
        # Load last 1 year of close prices to calculate 1-year performance
        one_year_ago = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
        price_records = db.query(
            DailyPrice.symbol, 
            DailyPrice.date, 
            DailyPrice.close
        ).filter(DailyPrice.date >= one_year_ago).order_by(DailyPrice.date.asc()).all()
        
        # Group close prices by symbol to compute performance
        symbol_prices = {}
        for pr in price_records:
            if pr.symbol not in symbol_prices:
                symbol_prices[pr.symbol] = []
            symbol_prices[pr.symbol].append(pr.close)
            
        response = []
        for stock in stocks:
            # Calculate performance
            perf = None
            closes = symbol_prices.get(stock.symbol)
            if closes and len(closes) >= 2:
                oldest = closes[0]
                latest = closes[-1]
                if oldest > 0:
                    perf = ((latest - oldest) / oldest) * 100
            
            # Fetch fundamentals
            snap = fund_map.get(stock.symbol)
            fund_data = None
            if snap:
                fund_data = StockFundamental(
                    as_of_date=snap.as_of_date,
                    market_cap=snap.market_cap,
                    pe_ratio=snap.pe_ratio,
                    pb_ratio=snap.pb_ratio,
                    roe=snap.roe_current or snap.roe_5yr,
                    roce=snap.roce_current or snap.roce_5yr,
                    debt_to_equity=snap.debt_to_equity,
                    sales_growth_3yr=snap.sales_growth_3yr
                )
                
            response.append(
                StockResponse(
                    symbol=stock.symbol,
                    name=stock.name,
                    sector=stock.sector,
                    performance_1y=perf,
                    fundamentals=fund_data
                )
            )
            
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving stocks: {str(e)}")

@router.get("/{symbol}/prices", response_model=List[StockPrice])
def get_stock_prices(symbol: str, db: Session = Depends(get_db)):
    """
    Get the last 1 year of daily historical prices for a given stock.
    """
    try:
        one_year_ago = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
        prices = db.query(DailyPrice).filter(
            DailyPrice.symbol == symbol,
            DailyPrice.date >= one_year_ago
        ).order_by(DailyPrice.date.asc()).all()
        
        return [
            StockPrice(
                date=p.date,
                open=p.open,
                high=p.high,
                low=p.low,
                close=p.close,
                volume=p.volume
            ) for p in prices
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving prices for {symbol}: {str(e)}")

@router.post("/sync")
def sync_stock_prices(background_tasks: BackgroundTasks):
    """
    Trigger daily price ingestion for all stocks in the background.
    """
    from ingest_prices import ingest_all_prices
    background_tasks.add_task(ingest_all_prices, force_full=False, max_workers=10)
    return {"message": "Price sync started in background."}
