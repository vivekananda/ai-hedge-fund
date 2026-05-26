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
    Get all stocks in the database along with their fundamental snapshot metrics,
    computed 1-year price performance, RS rating, and strategy preset matching flags.
    """
    try:
        # Load all stocks
        stocks = db.query(Stock).all()
        
        # Load all fundamentals snapshot
        fundamentals = db.query(FundamentalsSnapshot).all()
        fund_map = {f.symbol: f for f in fundamentals}
        
        # Load last 1 year of close prices to calculate performance and technical indicators
        one_year_ago = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
        price_records = db.query(
            DailyPrice.symbol, 
            DailyPrice.date, 
            DailyPrice.close
        ).filter(DailyPrice.date >= one_year_ago).order_by(DailyPrice.date.asc()).all()
        
        # Group close prices by symbol
        symbol_prices = {}
        for pr in price_records:
            if pr.symbol not in symbol_prices:
                symbol_prices[pr.symbol] = []
            symbol_prices[pr.symbol].append(pr.close)
            
        # Step 1: Calculate 1-year performance and technical indicators for all stocks
        stock_metrics = {}
        for stock in stocks:
            closes = symbol_prices.get(stock.symbol)
            perf = None
            latest_price = None
            sma_50 = None
            sma_150 = None
            sma_200 = None
            sma_200_20 = None
            high_52w = None
            low_52w = None
            
            if closes and len(closes) >= 2:
                latest_price = closes[-1]
                oldest = closes[0]
                if oldest > 0:
                    perf = ((latest_price - oldest) / oldest) * 100
                
                high_52w = max(closes)
                low_52w = min(closes)
                
                L = len(closes)
                if L >= 50:
                    sma_50 = sum(closes[-50:]) / 50.0
                if L >= 150:
                    sma_150 = sum(closes[-150:]) / 150.0
                if L >= 200:
                    sma_200 = sum(closes[-200:]) / 200.0
                if L >= 220:
                    # 200 SMA 20 trading days ago
                    sma_200_20 = sum(closes[-220:-20]) / 200.0
            
            stock_metrics[stock.symbol] = {
                "perf": perf,
                "latest_price": latest_price,
                "sma_50": sma_50,
                "sma_150": sma_150,
                "sma_200": sma_200,
                "sma_200_20": sma_200_20,
                "high_52w": high_52w,
                "low_52w": low_52w
            }
            
        # Step 2: Rank the stocks by performance_1y and assign rs_rating
        valid_stocks = [sym for sym, m in stock_metrics.items() if m["perf"] is not None]
        valid_stocks.sort(key=lambda sym: stock_metrics[sym]["perf"])
        
        num_valid = len(valid_stocks)
        rs_ratings = {}
        for idx, sym in enumerate(valid_stocks):
            if num_valid > 1:
                rs_ratings[sym] = float(round(1 + (idx / (num_valid - 1)) * 98))
            else:
                rs_ratings[sym] = 99.0
                
        # Step 3: Evaluate strategy criteria and assemble response
        response = []
        for stock in stocks:
            metrics = stock_metrics[stock.symbol]
            rs_val = rs_ratings.get(stock.symbol)
            
            # Fetch fundamentals
            snap = fund_map.get(stock.symbol)
            fund_data = None
            roe_val = None
            roce_val = None
            sales_growth = None
            
            if snap:
                roe_val = snap.roe_current or snap.roe_5yr
                roce_val = snap.roce_current or snap.roce_5yr
                sales_growth = snap.sales_growth_3yr
                fund_data = StockFundamental(
                    as_of_date=snap.as_of_date,
                    market_cap=snap.market_cap,
                    pe_ratio=snap.pe_ratio,
                    pb_ratio=snap.pb_ratio,
                    roe=roe_val,
                    roce=roce_val,
                    debt_to_equity=snap.debt_to_equity,
                    sales_growth_3yr=sales_growth
                )
            
            # Calculate Minervini Stage 2 uptrend
            is_minervini = False
            p = metrics["latest_price"]
            s50 = metrics["sma_50"]
            s150 = metrics["sma_150"]
            s200 = metrics["sma_200"]
            s200_20 = metrics["sma_200_20"]
            h52 = metrics["high_52w"]
            l52 = metrics["low_52w"]
            
            if (p is not None and s50 is not None and s150 is not None and s200 is not None 
                    and s200_20 is not None and h52 is not None and l52 is not None and rs_val is not None):
                cond1 = p > s150 and p > s200
                cond2 = s150 > s200
                cond3 = s200 > s200_20
                cond4 = s50 > s150 and s50 > s200
                cond5 = p > s50
                cond6 = p >= 1.30 * l52
                cond7 = p >= 0.75 * h52
                cond8 = rs_val >= 70
                
                if cond1 and cond2 and cond3 and cond4 and cond5 and cond6 and cond7 and cond8:
                    is_minervini = True
                    
            # Calculate CANSLIM Growth status
            is_canslim_status = False
            if (p is not None and s50 is not None and h52 is not None and rs_val is not None):
                fund_cond1 = False
                if roe_val is not None and roe_val > 15:
                    fund_cond1 = True
                if roce_val is not None and roce_val > 15:
                    fund_cond1 = True
                    
                fund_cond2 = sales_growth is not None and sales_growth > 10
                price_cond1 = p >= 0.80 * h52
                price_cond2 = p > s50
                rs_cond = rs_val >= 75
                
                if fund_cond1 and fund_cond2 and price_cond1 and price_cond2 and rs_cond:
                    is_canslim_status = True
                    
            response.append(
                StockResponse(
                    symbol=stock.symbol,
                    name=stock.name,
                    sector=stock.sector,
                    performance_1y=metrics["perf"],
                    fundamentals=fund_data,
                    rs_rating=rs_val,
                    is_minervini_trend=is_minervini,
                    is_canslim=is_canslim_status
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

def run_unified_sync():
    """Sync both daily price series and yfinance fundamental snapshots."""
    try:
        from ingest_prices import ingest_all_prices
        from fundamentals_yfinance_ingest import ingest_all_fundamentals
        # 1. Sync prices (syncs universe + pulls historical prices)
        ingest_all_prices(force_full=False, max_workers=10)
        # 2. Sync fundamentals snapshots
        ingest_all_fundamentals(max_workers=10)
    except Exception as e:
        import sys
        print(f"Error during unified stock sync: {e}", file=sys.stderr)


@router.post("/sync")
def sync_stock_prices(background_tasks: BackgroundTasks):
    """
    Trigger daily price ingestion and fundamentals snapshot sync in the background.
    """
    background_tasks.add_task(run_unified_sync)
    return {"message": "Price and fundamentals sync started in background."}
