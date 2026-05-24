import argparse
import csv
import os
import re
from datetime import datetime
from sqlalchemy.orm import Session
from src.db.connection import SessionLocal
from src.db.queries import init_db, save_fundamentals, get_all_stocks

# Clean numeric values from CSV (handles commas, percent signs, etc.)
def clean_numeric(val: str) -> float | None:
    if not val or val.strip() == "" or val.strip() == "-":
        return None
    cleaned = re.sub(r"[^\d\.\-]", "", val)
    try:
        return float(cleaned)
    except ValueError:
        return None

# Find the best column name match based on standard variations
def find_column(headers: list[str], patterns: list[str]) -> str | None:
    for pattern in patterns:
        for header in headers:
            # Check for case-insensitive match
            if re.search(pattern, header, re.IGNORECASE):
                return header
    return None

def ingest_screener_csv(csv_path: str):
    """
    Ingest Screener.in CSV export and map to stock database.
    """
    if not os.path.exists(csv_path):
        print(f"Error: File {csv_path} does not exist.")
        return

    db: Session = SessionLocal()
    
    # Pre-load all database stocks for lookup
    stocks = get_all_stocks(db)
    # Map name -> stock (lowercase, stripped of suffixes like 'Ltd', 'Limited')
    def clean_name(name):
        n = name.lower()
        n = re.sub(r"\b(ltd|limited|corp|corporation|industries|ind|co)\b", "", n)
        return re.sub(r"[^\w]", "", n)

    db_stocks_by_symbol = {s.symbol.split(".")[0].upper(): s for s in stocks}
    db_stocks_by_name = {clean_name(s.name): s for s in stocks}

    try:
        with open(csv_path, mode="r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            headers = [h.strip() for h in next(reader)]
            
            # Reset file pointer to read rows as dictionaries
            f.seek(0)
            next(reader) # Skip header again
            dict_reader = csv.DictReader(f, fieldnames=headers)
            
            # Map headers to required fields
            symbol_col = find_column(headers, [r"^symbol$", r"^ticker$", r"^code$"])
            name_col = find_column(headers, [r"^name$", r"^company$", r"^company name$"])
            
            market_cap_col = find_column(headers, [r"market cap", r"market capitalization", r"m cap"])
            pe_col = find_column(headers, [r"p/e", r"price to earning", r"pe ratio"])
            pb_col = find_column(headers, [r"p/b", r"price to book", r"pb ratio"])
            roe_5yr_col = find_column(headers, [r"roe 5yr", r"roe 5 yr", r"return on equity 5 years", r"average return on equity 5years"])
            roce_5yr_col = find_column(headers, [r"roce 5yr", r"roce 5 yr", r"return on capital employed 5 years", r"average return on capital employed 5years"])
            debt_equity_col = find_column(headers, [r"debt to equity", r"d/e", r"debt/equity"])
            sales_growth_col = find_column(headers, [r"sales growth 3yr", r"sales growth 3 years", r"sales growth \(3yrs\)"])
            roe_current_col = find_column(headers, [r"return on equity", r"^roe$", r"roe %"])
            roce_current_col = find_column(headers, [r"return on capital employed", r"^roce$", r"roce %"])

            print(f"Header mappings identified:")
            print(f"  Symbol Col: {symbol_col}")
            print(f"  Name Col: {name_col}")
            print(f"  Market Cap: {market_cap_col}")
            print(f"  P/E: {pe_col}")
            print(f"  P/B: {pb_col}")
            print(f"  ROE 5Yr: {roe_5yr_col}")
            print(f"  ROCE 5Yr: {roce_5yr_col}")
            print(f"  D/E: {debt_equity_col}")
            
            success_count = 0
            as_of_date = datetime.now().strftime("%Y-%m-%d")

            for row in dict_reader:
                row_name = row.get(name_col) if name_col else None
                row_sym = row.get(symbol_col) if symbol_col else None
                
                if not row_name and not row_sym:
                    continue
                
                target_stock = None
                # Try matching by symbol first
                if row_sym:
                    sym_clean = row_sym.strip().upper()
                    target_stock = db_stocks_by_symbol.get(sym_clean)
                
                # Try matching by name as fallback
                if not target_stock and row_name:
                    name_clean = clean_name(row_name)
                    target_stock = db_stocks_by_name.get(name_clean)
                    
                if not target_stock:
                    # Logging missing mapping is good for debug but avoid spamming
                    continue
                
                metrics = {
                    "as_of_date": as_of_date,
                    "market_cap": clean_numeric(row.get(market_cap_col)) if market_cap_col else None,
                    "pe_ratio": clean_numeric(row.get(pe_col)) if pe_col else None,
                    "pb_ratio": clean_numeric(row.get(pb_col)) if pb_col else None,
                    "roe_5yr": clean_numeric(row.get(roe_5yr_col)) if roe_5yr_col else None,
                    "roce_5yr": clean_numeric(row.get(roce_5yr_col)) if roce_5yr_col else None,
                    "debt_to_equity": clean_numeric(row.get(debt_equity_col)) if debt_equity_col else None,
                    "sales_growth_3yr": clean_numeric(row.get(sales_growth_col)) if sales_growth_col else None,
                    "roe_current": clean_numeric(row.get(roe_current_col)) if roe_current_col else None,
                    "roce_current": clean_numeric(row.get(roce_current_col)) if roce_current_col else None,
                }
                
                save_fundamentals(db, target_stock.symbol, metrics)
                success_count += 1
                
            print(f"Successfully ingested fundamentals for {success_count} stocks.")
            
    finally:
        db.close()

if __name__ == "__main__":
    init_db()
    parser = argparse.ArgumentParser(description="Ingest Screener.in CSV fundamentals")
    parser.add_argument("csv_path", type=str, help="Path to the Screener.in CSV file")
    args = parser.parse_args()
    ingest_screener_csv(args.csv_path)
