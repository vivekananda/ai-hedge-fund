import os
import datetime
import argparse
from tabulate import tabulate
from sqlalchemy.orm import Session

from src.db.connection import SessionLocal
from src.db.queries import init_db, get_all_stocks, save_weekly_pick, get_weekly_picks
from src.data.universe import sync_nifty500_universe
from src.tools.api import get_price_data, get_prices
from src.agents.technicals import calculate_sma, calculate_rsi
from src.main import run_hedge_fund

def run_weekly_pipeline(model_name: str = "gemini-2.0-flash", model_provider: str = "Gemini", test_mode: bool = False, watchlist_name: str = "Nifty 500"):
    """
    Runs the complete weekly top 10 picks pipeline for Indian stocks.
    """
    print(f"[{datetime.datetime.now()}] Starting Weekly Top 10 Pipeline (Universe: {watchlist_name})...")
    
    # 1. Initialize DB and sync universe
    init_db()
    db = SessionLocal()
    
    try:
        # Sync Nifty 500
        sync_nifty500_universe(db)
        
        # Load stocks based on the selected watchlist
        if watchlist_name and watchlist_name != "Nifty 500":
            from src.db.queries import get_watchlist_by_name
            wl = get_watchlist_by_name(db, watchlist_name)
            if wl:
                watchlist_tickers = [t.strip() for t in wl.tickers.split(",") if t.strip()]
                # Filter stocks in the database to only those in the watchlist
                all_stocks = get_all_stocks(db)
                all_stocks = [s for s in all_stocks if s.symbol in watchlist_tickers]
                print(f"Filtering stock universe to watchlist '{watchlist_name}' ({len(all_stocks)} stocks)")
            else:
                print(f"Watchlist '{watchlist_name}' not found. Defaulting to all stocks.")
                all_stocks = get_all_stocks(db)
        else:
            all_stocks = get_all_stocks(db)
            
        print(f"Total stocks to process: {len(all_stocks)}")
        
        # 2. Compute quantitative factors and score candidates
        scored_candidates = []
        
        print("Screening stocks using technical and fundamental factors...")
        # Use a limit if in test_mode to make it fast
        stocks_to_process = all_stocks[:20] if test_mode else all_stocks
        
        for stock in stocks_to_process:
            symbol = stock.symbol
            # Fetch fundamentals from local DB snapshot
            snap = stock.fundamentals
            
            # Fundamentals default values if no Screener.in CSV ingested yet
            roe = (snap.roe_current or snap.roe_5yr or 0.0) if (snap and (snap.roe_current or snap.roe_5yr)) else 0.0
            roce = (snap.roce_current or snap.roce_5yr or 0.0) if (snap and (snap.roce_current or snap.roce_5yr)) else 0.0
            debt_to_equity = snap.debt_to_equity if (snap and snap.debt_to_equity is not None) else 1.5
            sales_growth = snap.sales_growth_3yr if (snap and snap.sales_growth_3yr is not None) else 0.0
            market_cap = snap.market_cap if (snap and snap.market_cap is not None) else 0.0
            
            # Fetch EOD price history (past 60 days) to compute technical filters
            price_above_44_sma = False
            rsi_val = 50.0
            
            try:
                # Retrieve past 100 days of prices
                start_date = (datetime.date.today() - datetime.timedelta(days=120)).strftime("%Y-%m-%d")
                end_date = datetime.date.today().strftime("%Y-%m-%d")
                
                prices_df = get_price_data(symbol, start_date, end_date)
                if not prices_df.empty and len(prices_df) >= 44:
                    sma_44 = calculate_sma(prices_df, 44)
                    rsi = calculate_rsi(prices_df, 14)
                    
                    price_above_44_sma = prices_df["close"].iloc[-1] > sma_44.iloc[-1]
                    rsi_val = rsi.iloc[-1]
            except Exception as e:
                # If yfinance fails or data is missing, we log it
                pass
                
            # Scoring criteria:
            # 1. Price above 44 SMA
            # 2. ROE > 15%
            # 3. ROCE > 15%
            # 4. Debt to Equity < 1.0
            # 5. Sales growth > 10%
            score = 0
            if price_above_44_sma: score += 1
            if roe > 15.0: score += 1
            if roce > 15.0: score += 1
            if debt_to_equity < 1.0: score += 1
            if sales_growth > 10.0: score += 1
            
            scored_candidates.append({
                "symbol": symbol,
                "name": stock.name,
                "score": score,
                "market_cap": market_cap,
                "roe": roe,
                "roce": roce,
                "debt_to_equity": debt_to_equity,
                "price_above_44": price_above_44_sma,
                "rsi": rsi_val
            })
            
        # Sort candidates: primary by score descending, secondary by market cap descending
        scored_candidates.sort(key=lambda x: (-x["score"], -x["market_cap"]))
        
        # Pick top 100 candidates (or fewer if universe is small)
        top_candidates = scored_candidates[:100]
        candidate_symbols = [c["symbol"] for c in top_candidates]
        print(f"Selected {len(candidate_symbols)} candidates for qualitative scoring.")
        
        # 3. Run LLM Agents on top candidates
        # Batch tickers to avoid hitting API limit and keep LLM context clean
        batch_size = 5
        all_decisions = {}
        
        # Setup mock portfolio for the agents to analyze
        mock_portfolio = {
            "cash": 1000000.0,
            "margin_requirement": 0.0,
            "margin_used": 0.0,
            "positions": {ticker: {"long": 0, "short": 0, "long_cost_basis": 0.0, "short_cost_basis": 0.0, "short_margin_used": 0.0} for ticker in candidate_symbols},
            "realized_gains": {ticker: {"long": 0.0, "short": 0.0} for ticker in candidate_symbols}
        }
        
        start_date_run = (datetime.date.today() - datetime.timedelta(days=30)).strftime("%Y-%m-%d")
        end_date_run = datetime.date.today().strftime("%Y-%m-%d")
        
        # Limit processing in test mode
        candidate_batches = [candidate_symbols[i:i + batch_size] for i in range(0, len(candidate_symbols), batch_size)]
        if test_mode:
            candidate_batches = candidate_batches[:2] # Process only 2 batches in test mode
            
        print(f"Running LLM qualitative agent evaluation across {len(candidate_batches)} batches...")
        
        for idx, batch in enumerate(candidate_batches):
            print(f"Processing batch {idx+1}/{len(candidate_batches)}: {', '.join(batch)}")
            try:
                # Run multi-agent hedge fund execution
                result = run_hedge_fund(
                    tickers=batch,
                    start_date=start_date_run,
                    end_date=end_date_run,
                    portfolio=mock_portfolio,
                    show_reasoning=False,
                    selected_analysts=["technical_analyst", "fundamentals_analyst", "valuation_analyst"],
                    model_name=model_name,
                    model_provider=model_provider
                )
                
                if result and result.get("decisions"):
                    all_decisions.update(result["decisions"])
            except Exception as e:
                print(f"Error running agents for batch {batch}: {e}")
                
        # 4. Filter and select the final Top 10 Picks
        # Sort based on action = "buy" first, then confidence descending, then risk_score ascending
        ranked_picks = []
        for symbol, dec in all_decisions.items():
            action = dec.get("action", "hold")
            confidence = dec.get("confidence", 0.0)
            risk_score = dec.get("risk_score", 5.0)
            reasoning = dec.get("reasoning", "")
            thesis = dec.get("thesis", "")
            
            # We want buy/bullish signals for the top picks
            action_rank = 0
            if action == "buy":
                action_rank = 2
            elif action == "hold":
                action_rank = 1
                
            ranked_picks.append({
                "symbol": symbol,
                "action": action,
                "confidence": confidence,
                "risk_score": risk_score,
                "reasoning": reasoning,
                "thesis": thesis,
                "action_rank": action_rank
            })
            
        # Sort by action_rank (descending), confidence (descending), and risk_score (ascending)
        ranked_picks.sort(key=lambda x: (-x["action_rank"], -x["confidence"], x["risk_score"]))
        
        final_top_10 = ranked_picks[:10]
        
        # 5. Output finalized picks & save to database
        week_start_date = datetime.date.today().strftime("%Y-%m-%d")
        
        print("\n" + "="*80)
        print(f"                WEEKLY TOP 10 INDIAN STOCK PICKS - {week_start_date}")
        print("="*80)
        
        table_data = []
        for rank_idx, pick in enumerate(final_top_10):
            rank = rank_idx + 1
            symbol = pick["symbol"]
            
            # Save weekly pick
            save_weekly_pick(
                db=db,
                week_start_date=week_start_date,
                symbol=symbol,
                rank=rank,
                signal=pick["action"],
                score=pick["confidence"],
                thesis=pick["thesis"],
                risk_score=pick["risk_score"],
                watchlist_name=watchlist_name
            )
            
            table_data.append([
                rank,
                symbol,
                pick["action"].upper(),
                f"{pick['confidence']:.1f}%",
                f"{pick['risk_score']:.1f}/10",
                pick["thesis"]
            ])
            
        print(tabulate(table_data, headers=["Rank", "Ticker", "Signal", "Confidence", "Risk Score", "Qualitative Thesis"], tablefmt="grid"))
        print("="*80)
        print("Successfully generated and saved weekly picks.")
        
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Weekly Top 10 Indian Stock Picks Pipeline")
    parser.add_argument("--model", type=str, default="gemini-2.0-flash", help="LLM model name")
    parser.add_argument("--provider", type=str, default="Gemini", help="LLM provider name")
    parser.add_argument("--test", action="store_true", help="Run in speed test mode with limited tickers")
    parser.add_argument("--watchlist", type=str, default="Nifty 500", help="Watchlist name to filter stocks")
    args = parser.parse_args()
    
    run_weekly_pipeline(model_name=args.model, model_provider=args.provider, test_mode=args.test, watchlist_name=args.watchlist)
