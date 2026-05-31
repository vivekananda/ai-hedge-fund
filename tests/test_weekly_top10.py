from types import SimpleNamespace

import pandas as pd
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from pipelines import weekly_top10
from src.db.connection import Base
from src.db.models import Stock
from src.db.queries import delete_weekly_picks, get_weekly_picks, save_weekly_pick


def _db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    return db


def _sample_pick():
    return {
        "symbol": "ABC.NS",
        "action": "buy",
        "confidence": 82,
        "reasoning": "Signals align",
    }


def _sample_candidate():
    return {
        "symbol": "ABC.NS",
        "score": 5,
        "roe": 21.4,
        "roce": 18.2,
        "debt_to_equity": 0.35,
        "sales_growth": 14.0,
        "price_above_44": True,
        "rsi": 58.0,
    }


def _sample_signals():
    return {
        "technical_analyst_agent": {
            "ABC.NS": {"signal": "bullish", "confidence": 75}
        },
        "fundamentals_analyst_agent": {
            "ABC.NS": {"signal": "bullish", "confidence": 80}
        },
        "valuation_analyst_agent": {
            "ABC.NS": {"signal": "neutral", "confidence": 40}
        },
        "risk_management_agent": {
            "ABC.NS": {
                "volatility_metrics": {
                    "annualized_volatility": 0.24,
                }
            }
        },
    }


def _stock(symbol, market_cap):
    return SimpleNamespace(
        symbol=symbol,
        name=f"{symbol} Ltd",
        fundamentals=SimpleNamespace(
            roe_current=22.0,
            roe_5yr=None,
            roce_current=19.0,
            roce_5yr=None,
            debt_to_equity=0.3,
            sales_growth_3yr=16.0,
            market_cap=market_cap,
        ),
    )


def test_weekly_pick_reviews_fallback_generates_thesis_and_risk(monkeypatch):
    def raise_llm_error(*args, **kwargs):
        raise RuntimeError("local model returned invalid JSON")

    monkeypatch.setattr(weekly_top10, "call_llm", raise_llm_error)

    reviews = weekly_top10._generate_weekly_pick_reviews(
        picks=[_sample_pick()],
        candidate_lookup={"ABC.NS": _sample_candidate()},
        analyst_signals=_sample_signals(),
        model_name="google/gemma-4-e4b",
        model_provider="LMStudio",
    )

    review = reviews["ABC.NS"]
    assert review.thesis
    assert "Agent view:" in review.thesis
    assert 1.0 <= review.risk_score <= 10.0


def test_weekly_pick_reviews_escape_llm_thesis_and_clamp_risk(monkeypatch):
    def fake_call_llm(*args, **kwargs):
        return weekly_top10.WeeklyPickReviews(
            reviews={
                "ABC.NS": weekly_top10.WeeklyPickReview(
                    thesis="<script>alert('x')</script> Bullish setup with disciplined risk.",
                    risk_score=99.0,
                )
            }
        )

    monkeypatch.setattr(weekly_top10, "call_llm", fake_call_llm)

    reviews = weekly_top10._generate_weekly_pick_reviews(
        picks=[_sample_pick()],
        candidate_lookup={"ABC.NS": _sample_candidate()},
        analyst_signals=_sample_signals(),
        model_name="google/gemma-4-e4b",
        model_provider="LMStudio",
    )

    review = reviews["ABC.NS"]
    assert "&lt;script&gt;" in review.thesis
    assert review.risk_score == 10.0


def test_weekly_pick_reviews_fallback_only_for_missing_llm_review(monkeypatch):
    def fake_call_llm(*args, **kwargs):
        return weekly_top10.WeeklyPickReviews(
            reviews={
                "ABC.NS": weekly_top10.WeeklyPickReview(
                    thesis="ABC has supportive fundamentals and aligned technical signals.",
                    risk_score=3.2,
                )
            }
        )

    monkeypatch.setattr(weekly_top10, "call_llm", fake_call_llm)

    second_pick = {
        "symbol": "XYZ.NS",
        "action": "hold",
        "confidence": 51,
        "reasoning": "Mixed signals",
    }
    reviews = weekly_top10._generate_weekly_pick_reviews(
        picks=[_sample_pick(), second_pick],
        candidate_lookup={
            "ABC.NS": _sample_candidate(),
            "XYZ.NS": {
                **_sample_candidate(),
                "symbol": "XYZ.NS",
                "price_above_44": False,
            },
        },
        analyst_signals={
            **_sample_signals(),
            "technical_analyst_agent": {
                "ABC.NS": {"signal": "bullish", "confidence": 75},
                "XYZ.NS": {"signal": "bearish", "confidence": 60},
            },
        },
        model_name="google/gemma-4-e4b",
        model_provider="LMStudio",
    )

    assert reviews["ABC.NS"].thesis == "ABC has supportive fundamentals and aligned technical signals."
    assert reviews["ABC.NS"].risk_score == 3.2
    assert reviews["XYZ.NS"].thesis
    assert "Mixed signals" in reviews["XYZ.NS"].thesis
    assert 1.0 <= reviews["XYZ.NS"].risk_score <= 10.0


def test_weekly_pipeline_saves_non_empty_fallback_thesis_when_decisions_have_no_thesis(monkeypatch):
    saved_picks = []

    monkeypatch.setattr(weekly_top10, "init_db", lambda: None)
    monkeypatch.setattr(weekly_top10, "sync_nifty500_universe", lambda db: None)
    monkeypatch.setattr(weekly_top10, "SessionLocal", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(weekly_top10, "delete_weekly_picks", lambda *args, **kwargs: 0)
    monkeypatch.setattr(
        weekly_top10,
        "get_all_stocks",
        lambda db: [
            _stock("AAA.NS", 3000),
            _stock("BBB.NS", 2000),
            _stock("CCC.NS", 1000),
        ],
    )

    prices = pd.DataFrame({"close": [100.0] * 60})
    monkeypatch.setattr(weekly_top10, "get_price_data", lambda *args, **kwargs: prices)
    monkeypatch.setattr(weekly_top10, "calculate_sma", lambda df, window: pd.Series([90.0] * len(df)))
    monkeypatch.setattr(weekly_top10, "calculate_rsi", lambda df, window: pd.Series([55.0] * len(df)))
    monkeypatch.setattr(
        weekly_top10,
        "call_llm",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("local model returned prose")),
    )

    def fake_run_hedge_fund(tickers, *args, **kwargs):
        return {
            "decisions": {
                ticker: {
                    "action": "buy",
                    "quantity": 1,
                    "confidence": 80,
                    "reasoning": "Portfolio manager likes the setup",
                }
                for ticker in tickers
            },
            "analyst_signals": {
                "technical_analyst_agent": {
                    ticker: {"signal": "bullish", "confidence": 70}
                    for ticker in tickers
                },
                "fundamentals_analyst_agent": {
                    ticker: {"signal": "bullish", "confidence": 80}
                    for ticker in tickers
                },
                "risk_management_agent": {
                    ticker: {
                        "volatility_metrics": {
                            "annualized_volatility": 0.18,
                        }
                    }
                    for ticker in tickers
                },
            },
        }

    def fake_save_weekly_pick(**kwargs):
        saved_picks.append(kwargs)
        return SimpleNamespace(**kwargs)

    monkeypatch.setattr(weekly_top10, "run_hedge_fund", fake_run_hedge_fund)
    monkeypatch.setattr(weekly_top10, "save_weekly_pick", fake_save_weekly_pick)

    weekly_top10.run_weekly_pipeline(
        model_name="google/gemma-4-e4b",
        model_provider="LMStudio",
        test_mode=True,
    )

    assert len(saved_picks) == 3
    assert all(pick["thesis"] for pick in saved_picks)
    assert all("Agent view:" in pick["thesis"] for pick in saved_picks)
    assert all(1.0 <= pick["risk_score"] <= 10.0 for pick in saved_picks)


def test_delete_weekly_picks_removes_stale_legacy_nifty_rows_before_replacing_top_10():
    db = _db_session()
    try:
        for idx in range(11):
            symbol = f"STK{idx:02d}.NS"
            db.add(Stock(symbol=symbol, name=f"Stock {idx}", is_nifty500=True))
        db.commit()

        week_start_date = "2026-05-30"
        for idx in range(11):
            symbol = f"STK{idx:02d}.NS"
            watchlist_name = None if idx == 10 else "Nifty 500"
            save_weekly_pick(
                db=db,
                week_start_date=week_start_date,
                symbol=symbol,
                rank=idx + 1,
                signal="buy",
                score=80.0 - idx,
                thesis="old cached pick",
                risk_score=4.0,
                watchlist_name=watchlist_name,
            )

        assert len(get_weekly_picks(db, week_start_date, watchlist_name="Nifty 500")) == 11

        deleted_count = delete_weekly_picks(db, week_start_date, watchlist_name="Nifty 500")
        assert deleted_count == 11

        for idx in range(10):
            save_weekly_pick(
                db=db,
                week_start_date=week_start_date,
                symbol=f"STK{idx:02d}.NS",
                rank=idx + 1,
                signal="buy",
                score=90.0 - idx,
                thesis="fresh top 10 pick",
                risk_score=3.0,
                watchlist_name="Nifty 500",
            )

        picks = get_weekly_picks(db, week_start_date, watchlist_name="Nifty 500")
        assert len(picks) == 10
        assert [pick.rank for pick in picks] == list(range(1, 11))
        assert {pick.symbol for pick in picks} == {f"STK{idx:02d}.NS" for idx in range(10)}
    finally:
        db.close()


def test_delete_weekly_picks_only_removes_requested_watchlist():
    db = _db_session()
    try:
        for symbol in ("AAA.NS", "BBB.NS", "CCC.NS"):
            db.add(Stock(symbol=symbol, name=symbol, is_nifty500=True))
        db.commit()

        week_start_date = "2026-05-30"
        save_weekly_pick(db, week_start_date, "AAA.NS", 1, "buy", 80.0, "nifty", 4.0, "Nifty 500")
        save_weekly_pick(db, week_start_date, "BBB.NS", 1, "buy", 80.0, "growth", 4.0, "Growth")
        save_weekly_pick(db, week_start_date, "CCC.NS", 2, "buy", 79.0, "growth", 4.0, "Growth")

        deleted_count = delete_weekly_picks(db, week_start_date, watchlist_name="Growth")

        assert deleted_count == 2
        assert [pick.symbol for pick in get_weekly_picks(db, week_start_date, "Nifty 500")] == ["AAA.NS"]
        assert get_weekly_picks(db, week_start_date, "Growth") == []
    finally:
        db.close()
