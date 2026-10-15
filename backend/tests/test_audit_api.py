from tests.test_api_analytics import analytics_api as _analytics_fixture
from tests.test_api_foundation import api as _foundation_fixture

analytics_api = _analytics_fixture
api = _foundation_fixture


def test_integer_mode_propagation_and_validation(analytics_api):
    client, _, _ = analytics_api
    response = client.get(
        "/api/backtest?pair=GOLDTEN-GOLDPETAL&sizing_mode=integer_lots"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["configuration"]["sizing_mode"] == "integer_lots"
    assert all(
        report["configuration"]["sizing_mode"] == "integer_lots"
        for report in payload["reports"]
    )
    assert (
        client.get(
            "/api/backtest?pair=GOLDTEN-GOLDPETAL&sizing_mode=unknown"
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/api/backtest?pair=GOLDM-GOLDTEN&sizing_mode=integer_lots"
        ).status_code
        == 422
    )


def test_comparison_basis_remains_provisional(api):
    client, _, _, _ = api
    basis = client.get("/api/meta").json()["normalization"]
    assert basis["comparison_basis_status"] == "provisional"
    assert basis["purity_verification_status"] == "unverified"
    assert "ex-Mumbai" in basis["comparison_basis_warning"]
    assert basis["default_purity_adjustment"] is False
    assert "Experimental" in basis["purity_adjustment_label"]


def test_default_api_basis_off_but_explicit_opt_in_works(analytics_api):
    client, _, _ = analytics_api
    for path in [
        "/api/overview",
        "/api/prices",
        "/api/spreads?pair=GOLDM-GOLDTEN",
        "/api/curve?product=GOLDM",
        "/api/rolldown?product=GOLDM",
        "/api/backtest?pair=GOLDTEN-GOLDPETAL",
    ]:
        response = client.get(path)
        assert response.status_code == 200
        data = response.json()
        assert data["normalization"]["default_purity_adjustment"] is False
        if "configuration" in data:
            assert data["configuration"]["use_purity_adjustment"] is False
        else:
            assert data["purity_adjustment"] is False
    default = client.get("/api/curve?product=GOLDM").json()
    experimental = client.get("/api/curve?product=GOLDM&purity=true").json()
    assert default["points"][0]["close_p10_999"] == 101
    assert experimental["points"][0]["close_p10_999"] > 101


def test_ingestion_summary_is_allowlisted_not_private_notes():
    from app.api.foundation import _safe_ingestion_error

    assert "Filename must" in _safe_ingestion_error(
        "error", "Expected filename BhavCopyDateWise_DDMMYYYY.csv"
    )
    private = "permission denied C:/private/account/customer.csv"
    assert "private" not in _safe_ingestion_error("error", private)
    assert _safe_ingestion_error("ok", private) is None
