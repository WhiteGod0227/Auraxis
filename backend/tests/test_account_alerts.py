from tests import test_workspaces

workspace_client = test_workspaces.workspace_client
RULE = {
    "id": "rule-1",
    "pair": "GOLDTEN-GOLDPETAL",
    "metric": "abs_z",
    "threshold": 1.5,
    "expiry": None,
}


def test_alert_rules_private_owned_and_revision_checked(workspace_client):
    client, _ = workspace_client
    response = client.get("/api/alerts/rules")
    assert response.json()["revision"] == 0
    assert response.headers["cache-control"] == "private, no-store"
    saved = client.put("/api/alerts/rules", json={"revision": 0, "rules": [RULE]})
    assert saved.status_code == 200
    assert saved.json()["revision"] == 1
    assert saved.json()["rules"] == [RULE]
    assert (
        client.put("/api/alerts/rules", json={"revision": 0, "rules": []}).status_code
        == 409
    )
    client.cookies.set(test_workspaces.COOKIE, "test-token-2")
    assert client.get("/api/alerts/rules").json()["rules"] == []
    client.cookies.set(test_workspaces.COOKIE, "test-token-1")
    assert client.get("/api/alerts/rules").json()["rules"] == [RULE]
    assert (
        client.put("/api/alerts/rules", json={"revision": 1, "rules": []}).json()[
            "revision"
        ]
        == 2
    )


def test_alert_validation_origin_and_session(workspace_client):
    client, _ = workspace_client
    for rules in [
        [RULE, RULE],
        [{**RULE, "expiry": "2026-02-30"}],
        [{**RULE, "threshold": -1}],
        [{**RULE, "metric": "private-secret"}],
        [RULE] * 21,
    ]:
        response = client.put("/api/alerts/rules", json={"revision": 0, "rules": rules})
        assert response.status_code == 422
        assert "private-secret" not in response.text
    assert (
        client.put(
            "/api/alerts/rules",
            json={"revision": 0, "rules": []},
            headers={"Origin": "https://evil.test"},
        ).status_code
        == 403
    )
    client.cookies.clear()
    assert client.get("/api/alerts/rules").status_code == 401
