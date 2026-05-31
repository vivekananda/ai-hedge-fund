import datetime
import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db.connection import SessionLocal
from src.db.models import DailyPrice, WeeklyPick, WeeklyPipelineRun, Stock
from src.db.queries import (
    get_weekly_picks,
    create_weekly_run,
    update_weekly_run,
    get_weekly_runs
)

router = APIRouter(prefix="/weekly-picks")

# Dependency to get db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class RunPipelineRequest(BaseModel):
    model_name: Optional[str] = "gemini-2.0-flash"
    model_provider: Optional[str] = "Gemini"
    test_mode: Optional[bool] = False
    watchlist_name: Optional[str] = "Nifty 500"


class WeeklyPickResponse(BaseModel):
    id: int
    rank: int
    symbol: str
    name: str
    signal: str
    score: float
    thesis: str
    risk_score: float
    analysis_date: Optional[str] = None
    analysis_price: Optional[float] = None
    current_price_at_analysis: Optional[float] = None
    current_date: Optional[str] = None
    current_price: Optional[float] = None
    price_change_pct: Optional[float] = None
    analysis_details: Optional[dict] = None


class WeeklyRunResponse(BaseModel):
    id: int
    run_date: str
    status: str
    error_message: Optional[str] = None
    test_mode: bool
    created_at: str
    watchlist_name: Optional[str] = None


@router.get("/dates", response_model=List[str])
def get_picks_dates(watchlist_name: Optional[str] = "Nifty 500", db: Session = Depends(get_db)):
    """Retrieve all unique dates for which weekly picks exist."""
    try:
        if watchlist_name == "Nifty 500":
            dates = db.query(WeeklyPick.week_start_date).filter(
                (WeeklyPick.watchlist_name == "Nifty 500") | (WeeklyPick.watchlist_name == None)
            ).distinct().all()
        else:
            dates = db.query(WeeklyPick.week_start_date).filter(
                WeeklyPick.watchlist_name == watchlist_name
            ).distinct().all()
        # Sort descending
        return sorted([d[0] for d in dates if d[0]], reverse=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching dates: {str(e)}")


@router.get("/picks/{date}", response_model=List[WeeklyPickResponse])
def get_picks_by_date(date: str, watchlist_name: Optional[str] = "Nifty 500", db: Session = Depends(get_db)):
    """Retrieve all weekly stock picks for a specific date."""
    try:
        picks = get_weekly_picks(db, date, watchlist_name=watchlist_name)
        response = []
        for p in picks:
            # Join with Stock to get name
            stock = db.query(Stock).filter(Stock.symbol == p.symbol).first()
            name = stock.name if stock else p.symbol
            latest_price = (
                db.query(DailyPrice)
                .filter(DailyPrice.symbol == p.symbol)
                .order_by(DailyPrice.date.desc())
                .first()
            )
            current_price = latest_price.close if latest_price else None
            current_date = latest_price.date if latest_price else None
            analysis_price = p.analysis_price
            price_change_pct = None
            if analysis_price and current_price is not None:
                price_change_pct = round(((current_price - analysis_price) / analysis_price) * 100, 2)

            analysis_details = None
            if p.analysis_details:
                try:
                    analysis_details = json.loads(p.analysis_details)
                except json.JSONDecodeError:
                    analysis_details = {"raw": p.analysis_details}
            
            response.append(
                WeeklyPickResponse(
                    id=p.id,
                    rank=p.rank,
                    symbol=p.symbol,
                    name=name,
                    signal=p.signal,
                    score=p.score or 0.0,
                    thesis=p.thesis or "",
                    risk_score=p.risk_score or 0.0,
                    analysis_date=p.analysis_date or p.week_start_date,
                    analysis_price=analysis_price,
                    current_price_at_analysis=p.current_price_at_analysis,
                    current_date=current_date,
                    current_price=current_price,
                    price_change_pct=price_change_pct,
                    analysis_details=analysis_details,
                )
            )
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching picks for {date}: {str(e)}")


@router.get("/runs", response_model=List[WeeklyRunResponse])
def get_recent_runs(db: Session = Depends(get_db)):
    """Retrieve the recent background runs of the pipeline."""
    try:
        runs = get_weekly_runs(db)
        return [
            WeeklyRunResponse(
                id=r.id,
                run_date=r.run_date,
                status=r.status,
                error_message=r.error_message,
                test_mode=r.test_mode,
                created_at=r.created_at,
                watchlist_name=r.watchlist_name or "Nifty 500"
            ) for r in runs
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching runs: {str(e)}")


def run_pipeline_wrapper(run_id: int, model_name: str, model_provider: str, test_mode: bool, watchlist_name: str = "Nifty 500"):
    """Wrapper function to execute the weekly picks pipeline in the background and update database state."""
    db = SessionLocal()
    try:
        # Update run status to RUNNING
        update_weekly_run(db, run_id, "RUNNING")
        
        # Import the weekly pipeline function
        from pipelines.weekly_top10 import run_weekly_pipeline
        run_weekly_pipeline(model_name=model_name, model_provider=model_provider, test_mode=test_mode, watchlist_name=watchlist_name, run_id=run_id)
        
        # Mark as completed (only if not cancelled in the meantime)
        db.rollback()
        current_run = db.query(WeeklyPipelineRun).filter(WeeklyPipelineRun.id == run_id).first()
        if current_run and current_run.status == "CANCELLED":
            pass
        else:
            update_weekly_run(db, run_id, "COMPLETED")
    except Exception as e:
        # Mark as failed or cancelled with error message
        db.rollback()
        current_run = db.query(WeeklyPipelineRun).filter(WeeklyPipelineRun.id == run_id).first()
        if current_run and current_run.status == "CANCELLED":
            update_weekly_run(db, run_id, "CANCELLED", error_message="Pipeline cancelled by user")
        else:
            update_weekly_run(db, run_id, "FAILED", error_message=str(e))
    finally:
        db.close()


@router.post("/run", response_model=WeeklyRunResponse)
def trigger_pipeline(request: RunPipelineRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Trigger the weekly stock picks pipeline in the background."""
    try:
        # Check if there is already a running pipeline
        active_run = db.query(WeeklyPipelineRun).filter(WeeklyPipelineRun.status == "RUNNING").first()
        if active_run:
            raise HTTPException(
                status_code=400,
                detail=f"A pipeline analysis is already running (started on {active_run.created_at}). Please wait until it completes."
            )
            
        # Create a new run record
        today_str = datetime.date.today().strftime("%Y-%m-%d")
        created_at_str = datetime.datetime.now().isoformat()
        
        run_record = create_weekly_run(
            db=db,
            run_date=today_str,
            status="PENDING",
            test_mode=request.test_mode,
            created_at=created_at_str,
            watchlist_name=request.watchlist_name
        )
        
        # Enqueue the background task
        background_tasks.add_task(
            run_pipeline_wrapper,
            run_id=run_record.id,
            model_name=request.model_name,
            model_provider=request.model_provider,
            test_mode=request.test_mode,
            watchlist_name=request.watchlist_name
        )
        
        return WeeklyRunResponse(
            id=run_record.id,
            run_date=run_record.run_date,
            status=run_record.status,
            error_message=None,
            test_mode=run_record.test_mode,
            created_at=run_record.created_at,
            watchlist_name=run_record.watchlist_name
        )
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error triggering pipeline: {str(e)}")


@router.post("/runs/{run_id}/cancel", response_model=WeeklyRunResponse)
def cancel_pipeline_run(run_id: int, db: Session = Depends(get_db)):
    """Cancel an active or pending weekly pipeline execution."""
    try:
        run = db.query(WeeklyPipelineRun).filter(WeeklyPipelineRun.id == run_id).first()
        if not run:
            raise HTTPException(status_code=404, detail=f"Pipeline run {run_id} not found.")
        
        if run.status not in ["PENDING", "RUNNING"]:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot cancel pipeline run with status: {run.status}."
            )
            
        run.status = "CANCELLED"
        run.error_message = "Cancellation requested..."
        db.commit()
        db.refresh(run)
        
        return WeeklyRunResponse(
            id=run.id,
            run_date=run.run_date,
            status=run.status,
            error_message=run.error_message,
            test_mode=run.test_mode,
            created_at=run.created_at,
            watchlist_name=run.watchlist_name or "Nifty 500"
        )
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error cancelling pipeline run: {str(e)}")
