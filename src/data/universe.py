import io
import csv
import requests
from sqlalchemy.orm import Session
from src.db.queries import upsert_stock, get_nifty500_stocks
from src.db.connection import SessionLocal

NIFTY_500_URL = "https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv"

def download_nifty500_constituents() -> list[dict]:
    """
    Downloads the official Nifty 500 constituents CSV from niftyindices.com.
    Returns a list of dictionaries with company details.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    response = requests.get(NIFTY_500_URL, headers=headers)
    if response.status_code != 200:
        raise Exception(f"Failed to download Nifty 500 CSV: HTTP {response.status_code}")
        
    csv_content = response.content.decode("utf-8")
    csv_file = io.StringIO(csv_content)
    
    reader = csv.DictReader(csv_file)
    constituents = []
    
    # Expected headers: 'Company Name', 'Industry', 'Symbol', 'Series'
    for row in reader:
        # Check standard fields, handling potential casing issues
        company_name = row.get("Company Name", row.get("company_name", "")).strip()
        industry = row.get("Industry", row.get("industry", "")).strip()
        symbol = row.get("Symbol", row.get("symbol", "")).strip()
        
        if not symbol:
            continue
            
        if "DUMMYVEDL" in symbol.upper():
            continue
            
        # Append .NS suffix for Yahoo Finance compatibility
        formatted_symbol = f"{symbol}.NS" if not symbol.endswith(".NS") else symbol
        
        constituents.append({
            "name": company_name,
            "sector": industry,
            "symbol": formatted_symbol
        })
        
    return constituents

def sync_nifty500_universe(db: Session = None) -> int:
    """
    Syncs the local DB stocks table with the latest Nifty 500 constituents.
    """
    own_session = False
    if db is None:
        db = SessionLocal()
        own_session = True
        
    try:
        print("Downloading Nifty 500 constituents...")
        constituents = download_nifty500_constituents()
        print(f"Downloaded {len(constituents)} constituents. Syncing with database...")
        
        for c in constituents:
            upsert_stock(
                db=db,
                symbol=c["symbol"],
                name=c["name"],
                sector=c["sector"],
                is_nifty500=True
            )
            
        # Automatically populate/update a "Nifty 500" watchlist
        from src.db.queries import create_or_update_watchlist
        symbols = [c["symbol"] for c in constituents]
        create_or_update_watchlist(db, "Nifty 500", symbols)
            
        return len(constituents)
    finally:
        if own_session:
            db.close()

if __name__ == "__main__":
    from src.db.queries import init_db
    init_db()
    count = sync_nifty500_universe()
    print(f"Successfully synced {count} Nifty 500 stocks to local database.")
