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
        "intrinsic_value_analyst_agent": {
            "ABC.NS": {
                "signal": "bullish",
                "confidence": 91,
                "reasoning": {
                    "intrinsic_value": {
                        "intrinsic_value_per_share": 125.0,
                        "current_price": 90.0,
                        "margin_of_safety": 0.3889,
                        "method": "discounted_cash_flow",
                        "source": "estimated",
                        "currency": "INR",
                    },
                    "assumptions": {"growth_rate": 0.05},
                    "metrics": {"free_cash_flow_per_share": 8.0},
                },
            }
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


def test_complete_candidate_decisions_keeps_symbols_missing_from_agent_output():
    complete_decisions, missing_symbols = weekly_top10._complete_candidate_decisions(
        ["AAA.NS", "BBB.NS", "CCC.NS"],
        {
            "AAA.NS": {
                "action": "buy",
                "confidence": 85,
                "risk_score": 3.0,
                "reasoning": "Strong setup",
            },
            "UNREQUESTED.NS": {"action": "buy"},
        },
        {"CCC.NS": "The qualitative analysis request timed out."},
    )

    assert list(complete_decisions) == ["AAA.NS", "BBB.NS", "CCC.NS"]
    assert missing_symbols == ["BBB.NS", "CCC.NS"]
    assert complete_decisions["AAA.NS"]["action"] == "buy"
    assert complete_decisions["BBB.NS"] == {
        "action": "error",
        "confidence": 0.0,
        "risk_score": 0.0,
        "reasoning": "The portfolio manager returned no decision for this symbol.",
        "thesis": "Analysis error: The portfolio manager returned no decision for this symbol.",
        "analysis_error": {
            "message": "The portfolio manager returned no decision for this symbol.",
            "stage": "qualitative analysis",
            "retryable": True,
        },
    }
    assert complete_decisions["CCC.NS"]["analysis_error"]["message"] == "The qualitative analysis request timed out."


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


def test_extract_intrinsic_value_normalizes_agent_signal():
    intrinsic = weekly_top10._extract_intrinsic_value("ABC.NS", _sample_signals())

    assert intrinsic["intrinsic_value_per_share"] == 125.0
    assert intrinsic["current_price"] == 90.0
    assert intrinsic["margin_of_safety"] == 0.3889
    assert intrinsic["method"] == "discounted_cash_flow"
    assert intrinsic["source"] == "estimated"
    assert intrinsic["signal"] == "bullish"
    assert intrinsic["confidence"] == 91
    assert intrinsic["assumptions"]["growth_rate"] == 0.05


def test_extract_intrinsic_value_returns_none_when_signal_missing():
    assert weekly_top10._extract_intrinsic_value("XYZ.NS", _sample_signals()) is None


def test_weekly_pipeline_saves_analysis_errors_when_decisions_are_missing(monkeypatch):
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
        assert "intrinsic_value_analyst" in kwargs["selected_analysts"]
        return {
            "decisions": {
                ticker: {
                    "action": "buy",
                    "quantity": 1,
                    "confidence": 80,
                    "reasoning": "Portfolio manager likes the setup",
                }
                for ticker in tickers[:1]
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
                "intrinsic_value_analyst_agent": {
                    ticker: {
                        "signal": "bullish",
                        "confidence": 85,
                        "reasoning": {
                            "intrinsic_value": {
                                "intrinsic_value_per_share": 140.0,
                                "current_price": 100.0,
                                "margin_of_safety": 0.4,
                                "method": "discounted_cash_flow",
                                "source": "estimated",
                                "currency": "INR",
                            },
                            "assumptions": {"growth_rate": 0.04},
                            "metrics": {"free_cash_flow_per_share": 10.0},
                        },
                    }
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

    analyzed_pick = next(pick for pick in saved_picks if pick["symbol"] == "AAA.NS")
    assert "Agent view:" in analyzed_pick["thesis"]
    assert 1.0 <= analyzed_pick["risk_score"] <= 10.0

    fallback_pick = next(pick for pick in saved_picks if pick["symbol"] == "BBB.NS")
    assert fallback_pick["signal"] == "error"
    assert fallback_pick["score"] == 0.0
    assert "Analysis error" in fallback_pick["thesis"]

    import json
    for pick in saved_picks:
        details = json.loads(pick["analysis_details"])
        assert details["screen_metrics"]["sales_growth"] == 16.0
        assert details["intrinsic_value"]["intrinsic_value_per_share"] == 140.0
        assert details["intrinsic_value"]["margin_of_safety"] == 0.4

    fallback_details = json.loads(fallback_pick["analysis_details"])
    assert fallback_details["analysis_error"]["retryable"] is True



def test_delete_weekly_picks_removes_stale_legacy_nifty_rows_before_replacing_list():
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
                thesis="fresh top 50 pick",
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


def test_weekly_pipeline_cancel(monkeypatch):
    import pytest
    from src.db.models import WeeklyPipelineRun
    from pipelines.weekly_top10 import PipelineCancelledException, check_cancelled

    db = _db_session()
    try:
        # Create a run that will be cancelled
        run = WeeklyPipelineRun(run_date="2026-05-30", status="CANCELLED", test_mode=True, created_at="2026-05-30T10:00:00")
        db.add(run)
        db.commit()

        # check_cancelled should return True for this run
        assert check_cancelled(db, run.id) is True

        # Now mock the DB and run pipeline to test termination
        monkeypatch.setattr(weekly_top10, "init_db", lambda: None)
        monkeypatch.setattr(weekly_top10, "sync_nifty500_universe", lambda db: None)
        monkeypatch.setattr(weekly_top10, "SessionLocal", lambda: db)
        monkeypatch.setattr(
            weekly_top10,
            "get_all_stocks",
            lambda db: [
                _stock("AAA.NS", 3000),
            ],
        )

        with pytest.raises(PipelineCancelledException):
            weekly_top10.run_weekly_pipeline(
                model_name="google/gemma-4-e4b",
                model_provider="LMStudio",
                test_mode=True,
                run_id=run.id,
            )
    finally:
        db.close()
