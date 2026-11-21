"""On-chain gold API: tokenized gold (PAXG, XAUT) against MCX gold.

Read-only. Token prices and on-chain supply come from the background
``app.data.onchain`` service; MCX prices are the live last-traded price of each
product's nearest contract during a session, otherwise the latest settlement.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select

from app.api.database import get_connection
from app.api.foundation import _normalized, _read, _references
from app.core.config import Settings, get_settings
from app.data import onchain
from app.data.loader import bhav

router = APIRouter(prefix="/api/onchain", tags=["onchain"])
PRODUCTS = ("GOLDM", "GOLDTEN", "GOLDGUINEA", "GOLDPETAL")
ASSUMPTIONS = [
    "Each token represents one fine troy ounce (31.1035 g) of LBMA gold held "
    "by its issuer.",
    "Parity = token price in INR ÷ 31.1035 g × 10 g × (1 + India's import duty "
    "on that date). GST and local premiums or discounts are not included.",
    "MCX prices are futures, so they also include the cost of carry to expiry; "
    "part of any gap is that carry, not mispricing.",
    "Token prices are market prices (CoinGecko); supply is read directly from "
    "the token contracts on Ethereum mainnet.",
    "Research only: no tokens are bought, sold or held, and nothing is written "
    "to any blockchain.",
]


def _mcx_now(connection, settings: Settings) -> list[dict]:
    """Nearest-contract price per product: live during a session, else settled."""
    frame, _ = _read(connection, bhav)
    settled = {}
    as_of = None
    if not frame.empty:
        normalized = _normalized(frame, settings, False)
        as_of = frame.trade_date.max()
        for ref in _references(frame, normalized, settings):
            if ref.get("reference_available"):
                settled[ref["product"]] = ref
    from app.data.live import service as live_service

    snapshot = live_service.snapshot(settings)
    live_date = snapshot.get("trade_date")
    use_live = bool(
        live_date
        and snapshot.get("state") in {"live", "closed"}
        and (as_of is None or live_date > as_of.isoformat())
    )
    live_refs = {
        r["product"]: r for r in snapshot.get("references") or [] if r.get("available")
    }
    rows = []
    for product in PRODUCTS:
        live = live_refs.get(product) if use_live else None
        if live and isinstance(live.get("price_p10"), int | float):
            rows.append(
                dict(
                    product=product,
                    expiry=live.get("expiry_date"),
                    price_p10=live["price_p10"],
                    source="live",
                    as_of=live_date,
                )
            )
        elif product in settled:
            ref = settled[product]
            rows.append(
                dict(
                    product=product,
                    expiry=onchain_iso(ref.get("expiry_date")),
                    price_p10=float(ref["close_p10_999"]),
                    source="settlement",
                    as_of=onchain_iso(as_of),
                )
            )
    return rows


def onchain_iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


@router.get("/gold")
def gold(
    response: Response,
    connection=Depends(get_connection),
    settings: Settings = Depends(get_settings),
):
    onchain.require_enabled(settings)
    response.headers["Cache-Control"] = "no-store"
    state = onchain.service.state()
    today = datetime.now(UTC).date()
    duty = onchain.duty_on(settings, today)
    tokens = []
    for token in onchain.TOKENS:
        price = state["prices"].get(token.symbol) or {}
        supply = state["supply"].get(token.symbol) or {}
        inr = price.get("inr")
        tokens.append(
            dict(
                symbol=token.symbol,
                name=token.name,
                issuer=token.issuer,
                chain="Ethereum",
                contract=token.contract,
                explorer_url=f"https://etherscan.io/token/{token.contract}",
                price_inr=inr,
                price_usd=price.get("usd"),
                price_updated_at=price.get("updated_at"),
                parity_p10=onchain.parity_p10(inr, duty) if inr else None,
                supply_tokens=supply.get("tokens"),
                supply_tonnes=supply.get("tonnes"),
                supply_read_at=supply.get("read_at"),
            )
        )
    mcx = _mcx_now(connection, settings)
    comparisons = []
    for row in mcx:
        for token in tokens:
            if token["parity_p10"] is None:
                continue
            gap = row["price_p10"] - token["parity_p10"]
            comparisons.append(
                dict(
                    product=row["product"],
                    token=token["symbol"],
                    mcx_p10=row["price_p10"],
                    parity_p10=token["parity_p10"],
                    gap=gap,
                    gap_pct=100 * gap / token["parity_p10"],
                )
            )
    return dict(
        updated_at=state["updated_at"],
        errors=[e for e in (state["price_error"], state["supply_error"]) if e],
        duty_pct=duty,
        duty_schedule=[
            dict(start=start, pct=pct)
            for start, pct in sorted(settings.onchain_duty_schedule.items())
        ],
        tokens=tokens,
        mcx=mcx,
        comparisons=comparisons,
        assumptions=ASSUMPTIONS,
    )


def mcx_daily(connection, product: str, since: date, settings: Settings):
    """Nearest eligible contract's settlement per day (₹ per 10 g)."""
    if connection is None:
        return pd.DataFrame(columns=["trade_date", "expiry_date", "close_p10"])
    frame = pd.read_sql(
        select(
            bhav.c.symbol,
            bhav.c.trade_date,
            bhav.c.expiry_date,
            bhav.c.close,
            bhav.c.has_trade,
        ).where(bhav.c.symbol == product, bhav.c.trade_date >= since),
        connection,
    )
    if frame.empty:
        return pd.DataFrame(columns=["trade_date", "expiry_date", "close_p10"])
    frame = frame.loc[frame.has_trade & (frame.close > 0)].copy()
    days = (
        pd.to_datetime(frame.expiry_date) - pd.to_datetime(frame.trade_date)
    ).dt.days
    frame = frame.loc[days >= 3]
    frame = (
        frame.sort_values(["trade_date", "expiry_date"]).groupby("trade_date").head(1)
    )
    frame["close_p10"] = (
        frame.close * settings.base_grams / settings.quote_grams[product]
    )
    return frame[["trade_date", "expiry_date", "close_p10"]]


@router.get("/history")
def history(
    product: str = Query("GOLDTEN"),
    days: int = Query(365, ge=7, le=730),
    connection=Depends(get_connection),
    settings: Settings = Depends(get_settings),
):
    """Daily gap: MCX settlement vs token parity on the same evening.

    CoinGecko's daily price is stamped 00:00 UTC, i.e. 05:30 IST the next
    morning, about five hours after MCX settles (~23:55 IST). So MCX day D is
    paired with the token price dated D + 1 (or D if that is missing).
    """
    onchain.require_enabled(settings)
    if product not in PRODUCTS:
        raise HTTPException(422, "Choose one of the four gold products.")
    since = onchain.history_since(days)
    with onchain.database(settings) as db:
        rows = db.execute(
            "SELECT symbol, day, inr FROM token_daily WHERE day >= ? ORDER BY day",
            ((since - timedelta(days=1)).isoformat(),),
        ).fetchall()
    tokens: dict[str, dict[str, float]] = {}
    for row in rows:
        tokens.setdefault(row["symbol"], {})[row["day"]] = row["inr"]
    daily = mcx_daily(connection, product, since, settings)
    points = []
    for item in daily.itertuples():
        day = item.trade_date
        duty = onchain.duty_on(settings, day)
        point = dict(
            date=day.isoformat(),
            expiry=item.expiry_date.isoformat(),
            mcx_p10=float(item.close_p10),
            duty_pct=duty,
        )
        for token in onchain.TOKENS:
            series = tokens.get(token.symbol, {})
            inr = series.get((day + timedelta(days=1)).isoformat()) or series.get(
                day.isoformat()
            )
            parity = onchain.parity_p10(inr, duty) if inr else None
            point[f"{token.symbol}_parity"] = parity
            point[f"{token.symbol}_gap"] = (
                float(item.close_p10) - parity if parity is not None else None
            )
        points.append(point)
    return dict(product=product, days=days, points=points)
