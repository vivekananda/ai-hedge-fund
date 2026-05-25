from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
import asyncio
import uuid
import json
from datetime import datetime
from sqlalchemy.orm import Session

from app.backend.models.schemas import ErrorResponse, HedgeFundRequest
from app.backend.models.events import StartEvent, ProgressUpdateEvent, ErrorEvent, CompleteEvent
from app.backend.services.graph import create_graph, parse_hedge_fund_response, run_graph_async
from app.backend.services.portfolio import create_portfolio
from src.utils.progress import progress
from src.db.connection import SessionLocal
from src.db.queries import (
    save_simulation_run,
    update_simulation_run,
    get_simulation_runs,
    get_simulation_run,
    delete_simulation_run
)

router = APIRouter(prefix="/hedge-fund")

# Dependency to get db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()



@router.post(
    path="/run",
    responses={
        200: {"description": "Successful response with streaming updates"},
        400: {"model": ErrorResponse, "description": "Invalid request parameters"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def run_hedge_fund(request: HedgeFundRequest, db: Session = Depends(get_db)):
    try:
        # Get the start date if not provided
        start_date = request.get_start_date()

        # Create the portfolio
        portfolio = create_portfolio(request.initial_cash, request.margin_requirement, request.tickers)

        # Construct agent graph
        graph = create_graph(request.selected_agents)
        graph = graph.compile()

        # Log a test progress update for debugging
        progress.update_status("system", None, "Preparing hedge fund run")

        # Convert model_provider to string if it's an enum
        model_provider = request.model_provider
        if hasattr(model_provider, "value"):
            model_provider = model_provider.value

        # Generate a unique run ID
        run_id = str(uuid.uuid4())
        created_at_str = datetime.now().isoformat()
        
        # Save run in pending/running status
        save_simulation_run(
            db=db,
            run_id=run_id,
            created_at=created_at_str,
            tickers=",".join(request.tickers),
            selected_agents=",".join(request.selected_agents),
            model_name=request.model_name,
            model_provider=model_provider,
            initial_cash=request.initial_cash,
            margin_requirement=request.margin_requirement,
            status="RUNNING"
        )

        # Set up streaming response
        async def event_generator():
            # Queue for progress updates
            progress_queue = asyncio.Queue()
            events_log = []

            # Simple handler to add updates to the queue and the log
            def progress_handler(agent_name, ticker, status, timestamp):
                event = ProgressUpdateEvent(agent=agent_name, ticker=ticker, status=status, timestamp=timestamp)
                progress_queue.put_nowait(event)
                events_log.append(event.model_dump())

            # Register our handler with the progress tracker
            progress.register_handler(progress_handler)

            try:
                # Start the graph execution in a background task
                run_task = asyncio.create_task(
                    run_graph_async(
                        graph=graph,
                        portfolio=portfolio,
                        tickers=request.tickers,
                        start_date=start_date,
                        end_date=request.end_date,
                        model_name=request.model_name,
                        model_provider=model_provider,
                    )
                )
                # Send initial message (with run_id)
                yield StartEvent(run_id=run_id).to_sse()

                # Stream progress updates until run_task completes
                while not run_task.done():
                    # Either get a progress update or wait a bit
                    try:
                        event = await asyncio.wait_for(progress_queue.get(), timeout=1.0)
                        yield event.to_sse()
                    except asyncio.TimeoutError:
                        # Just continue the loop
                        pass

                # Get the final result
                result = run_task.result()

                # Run session database connection for updating state
                run_db = SessionLocal()
                try:
                    if not result or not result.get("messages"):
                        error_msg = "Failed to generate hedge fund decisions"
                        yield ErrorEvent(message=error_msg).to_sse()
                        update_simulation_run(
                            db=run_db,
                            run_id=run_id,
                            status="ERROR",
                            logs=json.dumps(events_log)
                        )
                        return

                    decisions = parse_hedge_fund_response(result.get("messages", [])[-1].content)
                    analyst_signals = result.get("data", {}).get("analyst_signals", {})
                    
                    # Send the final result
                    final_data = CompleteEvent(
                        data={
                            "decisions": decisions,
                            "analyst_signals": analyst_signals,
                        }
                    )
                    yield final_data.to_sse()
                    
                    # Cache completed run in DB
                    update_simulation_run(
                        db=run_db,
                        run_id=run_id,
                        status="COMPLETE",
                        decisions=json.dumps(decisions) if decisions else None,
                        analyst_signals=json.dumps(analyst_signals) if analyst_signals else None,
                        logs=json.dumps(events_log)
                    )
                finally:
                    run_db.close()

            except Exception as e:
                error_msg = f"Task execution failed: {str(e)}"
                yield ErrorEvent(message=error_msg).to_sse()
                run_db = SessionLocal()
                try:
                    update_simulation_run(
                        db=run_db,
                        run_id=run_id,
                        status="ERROR",
                        logs=json.dumps(events_log)
                    )
                finally:
                    run_db.close()
            finally:
                # Clean up
                progress.unregister_handler(progress_handler)
                if "run_task" in locals() and not run_task.done():
                    run_task.cancel()

        # Return a streaming response
        return StreamingResponse(event_generator(), media_type="text/event-stream")

    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred while processing the request: {str(e)}")


@router.get("/runs")
def list_past_simulation_runs(db: Session = Depends(get_db)):
    """Retrieve all past simulation runs (metadata only for speed)."""
    try:
        runs = get_simulation_runs(db)
        return [
            {
                "id": r.id,
                "created_at": r.created_at,
                "tickers": r.tickers.split(",") if r.tickers else [],
                "selected_agents": r.selected_agents.split(",") if r.selected_agents else [],
                "model_name": r.model_name,
                "model_provider": r.model_provider,
                "status": r.status
            } for r in runs
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving simulation runs: {str(e)}")


@router.get("/runs/{run_id}")
def get_past_simulation_run(run_id: str, db: Session = Depends(get_db)):
    """Retrieve full details of a past simulation run."""
    try:
        run = get_simulation_run(db, run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Simulation run not found")
        
        return {
            "id": run.id,
            "created_at": run.created_at,
            "tickers": run.tickers.split(",") if run.tickers else [],
            "selected_agents": run.selected_agents.split(",") if run.selected_agents else [],
            "model_name": run.model_name,
            "model_provider": run.model_provider,
            "initial_cash": run.initial_cash,
            "margin_requirement": run.margin_requirement,
            "status": run.status,
            "decisions": json.loads(run.decisions) if run.decisions else None,
            "analyst_signals": json.loads(run.analyst_signals) if run.analyst_signals else None,
            "logs": json.loads(run.logs) if run.logs else []
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving simulation run details: {str(e)}")


@router.delete("/runs/{run_id}")
def delete_past_simulation_run(run_id: str, db: Session = Depends(get_db)):
    """Delete a past simulation run."""
    try:
        deleted = delete_simulation_run(db, run_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Simulation run not found")
        return {"message": "Simulation run deleted successfully."}
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting simulation run: {str(e)}")

