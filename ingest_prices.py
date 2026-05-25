import argparse
import datetime
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from sqlalchemy.orm import Session

from src.db.connection import SessionLocal
from src.db.models import DailyPrice, Stock
from src.db.queries import init_db, save_daily_prices, get_nifty500_stocks
from src.data.universe import sync_nifty500_universe
from src.data.yfinance_client import fetch_yfinance_prices

def get_latest_price_date(db: Session, symbol: str) -> str | None:
    """Retrieve the latest price date for a given symbol from the database."""
    result = db.query(DailyPrice.date).filter(DailyPrice.symbol == symbol).order_by(DailyPrice.date.desc()).first()
    return result[0] if result else None

def ingest_single_stock(symbol: str, force_full: bool) -> int:
    """Ingest price history for a single stock. Returns count of rows added."""
    db: Session = SessionLocal()
    try:
        today = datetime.date.today()
        end_date = today.strftime("%Y-%m-%d")
        
        # Calculate start date
        latest_date_str = get_latest_price_date(db, symbol) if not force_full else None
        
        if latest_date_str:
            latest_date = datetime.datetime.strptime(latest_date_str, "%Y-%m-%d").date()
            if latest_date >= today:
                # Up to date
                return 0
            start_date = (latest_date + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        else:
            # Full 1-year history fallback
            start_date = (today - datetime.timedelta(days=365)).strftime("%Y-%m-%d")
            
        # If start_date >= end_date, skip
        if start_date > end_date:
            return 0
            
        # Fetch prices from yfinance
        df = fetch_yfinance_prices(symbol, start_date, end_date)
        if df.empty:
            return 0
            
        # Save to database
        save_daily_prices(db, symbol, df)
        return len(df)
    except Exception as e:
        print(f"Error ingesting prices for {symbol}: {e}", file=sys.stderr)
        return 0
    finally:
        db.close()

def ingest_all_prices(force_full: bool = False, max_workers: int = 15):
    """Sync universe and ingest price histories concurrently."""
    print("Initializing database...")
    init_db()
    
    # First sync the Nifty 500 universe
    print("Syncing Nifty 500 universe constituents...")
    try:
        count = sync_nifty500_universe()
        print(f"Universe synced. Total {count} Nifty 500 stocks.")
    except Exception as e:
        print(f"Warning: Failed to sync universe constituents: {e}. Proceeding with existing database stocks.")
        
    db = SessionLocal()
    try:
        stocks = get_nifty500_stocks(db)
        if not stocks:
            print("No stocks found in the database. Please check your internet connection or database setup.")
            return
        
        symbols = [s.symbol for s in stocks]
        print(f"Starting price ingestion for {len(symbols)} stocks using {max_workers} threads...")
        
        total_rows_ingested = 0
        success_stocks = 0
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all stock ingestion tasks
            futures = {executor.submit(ingest_single_stock, sym, force_full): sym for sym in symbols}
            
            for index, future in enumerate(as_completed(futures)):
                sym = futures[future]
                try:
                    rows_added = future.result()
                    if rows_added > 0:
                        total_rows_ingested += rows_added
                        success_stocks += 1
                except Exception as e:
                    print(f"Task error for {sym}: {e}", file=sys.stderr)
                    
                if (index + 1) % 50 == 0 or (index + 1) == len(symbols):
                    print(f"Progress: {index + 1}/{len(symbols)} stocks processed...")
                    
        print(f"Price ingestion complete!")
        print(f"Successfully processed {success_stocks} stocks.")
        print(f"Total price rows ingested: {total_rows_ingested}")
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest historical stock prices from yfinance info")
    parser.add_argument("--workers", type=int, default=15, help="Number of concurrent threads")
    parser.add_argument("--force", action="store_true", help="Force full 1-year ingestion, overwriting local prices")
    args = parser.parse_args()
    
    ingest_all_prices(force_full=args.force, max_workers=args.workers)
