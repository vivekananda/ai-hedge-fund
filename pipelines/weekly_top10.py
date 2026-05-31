import datetime
import argparse
import json
import html
from tabulate import tabulate
from sqlalchemy.orm import Session
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from src.db.connection import SessionLocal
from src.db.queries import init_db, get_all_stocks, save_weekly_pick, delete_weekly_picks
from src.data.universe import sync_nifty500_universe
from src.tools.api import get_price_data, get_prices
from src.agents.technicals import calculate_sma, calculate_rsi
from src.main import run_hedge_fund
from src.utils.llm import call_llm


class WeeklyPickReview(BaseModel):
    thesis: str = Field(description="Plain text qualitative thesis for the weekly pick")
    risk_score: float = Field(description="Risk score from 1.0 low risk to 10.0 high risk")


class WeeklyPickReviews(BaseModel):
    reviews: dict[str, WeeklyPickReview] = Field(description="Ticker symbol to weekly pick review")


def _safe_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _format_pct(value) -> str:
    return f"{_safe_float(value):.1f}%"


def _candidate_metrics_text(candidate: dict | None) -> str:
    if not candidate:
        return "screen metrics unavailable"

    trend = "above" if candidate.get("price_above_44") else "below"
    return (
        f"screen score {candidate.get('score', 0)}/5, "
        f"ROE {_format_pct(candidate.get('roe'))}, "
        f"ROCE {_format_pct(candidate.get('roce'))}, "
        f"D/E {_safe_float(candidate.get('debt_to_equity'), 0.0):.2f}, "
        f"sales growth {_format_pct(candidate.get('sales_growth'))}, "
        f"price {trend} 44-SMA, RSI {_safe_float(candidate.get('rsi'), 50.0):.1f}"
    )


def _compact_signal_summary(symbol: str, analyst_signals: dict) -> list[str]:
    summary = []
    for agent_name, signals in (analyst_signals or {}).items():
        if agent_name == "risk_management_agent":
            continue

        signal = (signals or {}).get(symbol)
        if not signal:
            continue

        label = agent_name.replace("_agent", "").replace("_", " ")
        summary.append(
            f"{label}: {signal.get('signal', 'n/a')} "
            f"({_safe_float(signal.get('confidence'), 0.0):.0f}% confidence)"
        )

    return summary


def _fallback_risk_score(symbol: str, candidate: dict | None, analyst_signals: dict) -> float:
    risk_signal = (analyst_signals or {}).get("risk_management_agent", {}).get(symbol, {})
    volatility = (
        risk_signal.get("volatility_metrics", {}).get("annualized_volatility")
        if risk_signal
        else None
    )

    if volatility is not None:
        score = max(1.0, min(10.0, _safe_float(volatility) * 20.0))
    else:
        score = 5.0

    if candidate:
        if _safe_float(candidate.get("debt_to_equity"), 0.0) > 1.0:
            score += 1.0
        if not candidate.get("price_above_44"):
            score += 0.75

        rsi = _safe_float(candidate.get("rsi"), 50.0)
        if rsi > 70 or rsi < 30:
            score += 0.75

    signals = []
    for agent_signals in (analyst_signals or {}).values():
        payload = (agent_signals or {}).get(symbol)
        if payload and payload.get("signal") in {"bullish", "bearish"}:
            signals.append(payload["signal"])
    if "bullish" in signals and "bearish" in signals:
        score += 0.5

    return round(max(1.0, min(10.0, score)), 1)


def _fallback_thesis(symbol: str, decision: dict, candidate: dict | None, analyst_signals: dict) -> str:
    signal_summary = _compact_signal_summary(symbol, analyst_signals)
    analyst_text = "; ".join(signal_summary) if signal_summary else "analyst signals were limited"
    reasoning = decision.get("reasoning") or "portfolio manager did not add a separate note"
    action = str(decision.get("action", "hold")).upper()
    confidence = _safe_float(decision.get("confidence"), 0.0)

    return (
        f"{action} with {confidence:.0f}% confidence. "
        f"The screen shows {_candidate_metrics_text(candidate)}. "
        f"Agent view: {analyst_text}. "
        f"Portfolio note: {reasoning}."
    )


def _generate_weekly_pick_reviews(
    picks: list[dict],
    candidate_lookup: dict[str, dict],
    analyst_signals: dict,
    model_name: str,
    model_provider: str,
) -> dict[str, WeeklyPickReview]:
    fallback_reviews = {
        pick["symbol"]: WeeklyPickReview(
            thesis=_fallback_thesis(
                pick["symbol"],
                pick,
                candidate_lookup.get(pick["symbol"]),
                analyst_signals,
            ),
            risk_score=_fallback_risk_score(
                pick["symbol"],
                candidate_lookup.get(pick["symbol"]),
                analyst_signals,
            ),
        )
        for pick in picks
    }

    if not picks:
        return fallback_reviews

    payload = {}
    for pick in picks:
        symbol = pick["symbol"]
        payload[symbol] = {
            "portfolio_decision": {
                "action": pick.get("action"),
                "confidence": pick.get("confidence"),
                "reasoning": pick.get("reasoning"),
            },
            "screen_metrics": candidate_lookup.get(symbol, {}),
            "analyst_summary": _compact_signal_summary(symbol, analyst_signals),
            "fallback_risk_score": fallback_reviews[symbol].risk_score,
        }

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You write weekly stock-pick reviews for an Indian equity dashboard. "
                "Use only the supplied metrics and agent summaries. "
                "Return JSON only. Each thesis must be plain text, balanced, and under 65 words. "
                "Risk score is 1.0 low risk to 10.0 high risk.",
            ),
            (
                "human",
                "Create a review for each ticker.\n\n"
                "Input:\n{payload}\n\n"
                "Format:\n"
                "{{\"reviews\":{{\"TICKER\":{{\"thesis\":\"...\",\"risk_score\":5.0}}}}}}",
            ),
        ]
    ).invoke({"payload": json.dumps(payload, default=str)})

    state = {
        "metadata": {
            "model_name": model_name,
            "model_provider": model_provider,
        }
    }

    try:
        llm_reviews = call_llm(
            prompt=prompt,
            pydantic_model=WeeklyPickReviews,
            agent_name="weekly_thesis_agent",
            state=state,
            max_retries=2,
            default_factory=lambda: WeeklyPickReviews(reviews=fallback_reviews),
        )
    except Exception as exc:
        print(f"Weekly thesis generation failed; using fallback reviews: {exc}")
        return fallback_reviews

    reviews = dict(fallback_reviews)
    for symbol, review in llm_reviews.reviews.items():
        if symbol not in reviews:
            continue

        thesis = (review.thesis or "").strip()
        risk_score = max(1.0, min(10.0, _safe_float(review.risk_score, reviews[symbol].risk_score)))
        if thesis:
            reviews[symbol] = WeeklyPickReview(
                thesis=thesis,
                risk_score=round(risk_score, 1),
            )

    for symbol, review in reviews.items():
        reviews[symbol] = WeeklyPickReview(
            thesis=html.escape(review.thesis),
            risk_score=review.risk_score,
        )

    return reviews


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
        all_analyst_signals = {}
        
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
                    for agent_name, signals in (result.get("analyst_signals") or {}).items():
                        all_analyst_signals.setdefault(agent_name, {}).update(signals or {})
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

        candidate_lookup = {candidate["symbol"]: candidate for candidate in top_candidates}
        qualitative_reviews = _generate_weekly_pick_reviews(
            picks=final_top_10,
            candidate_lookup=candidate_lookup,
            analyst_signals=all_analyst_signals,
            model_name=model_name,
            model_provider=model_provider,
        )
        for pick in final_top_10:
            review = qualitative_reviews.get(pick["symbol"])
            if review:
                pick["thesis"] = review.thesis
                pick["risk_score"] = review.risk_score
        
        # 5. Output finalized picks & save to database
        week_start_date = datetime.date.today().strftime("%Y-%m-%d")
        
        print("\n" + "="*80)
        print(f"                WEEKLY TOP 10 INDIAN STOCK PICKS - {week_start_date}")
        print("="*80)

        # Replace the cached list for this date/watchlist so symbols that dropped out
        # of the top 10 do not remain visible from a previous run.
        delete_weekly_picks(db, week_start_date, watchlist_name=watchlist_name)
        
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
