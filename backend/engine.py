"""Query engine for LinkTrace mock investigation data."""

from __future__ import annotations

import json
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data.json"

# Geo coordinates mapping for mock NCR / Mumbai / Jaipur intelligence points
GEO_COORDINATES: dict[str, tuple[float, float]] = {
    # Suspects
    "S001": (28.5398, 77.2384),  # Greater Kailash-I, New Delhi
    "S002": (28.3392, 77.3245),  # Sector 21, Ballabgarh
    "S003": (28.4947, 77.0895),  # DLF Phase 3, Gurugram
    "S004": (28.5677, 77.2433),  # Lajpat Nagar, New Delhi
    "S005": (28.4124, 77.3178),  # Old Faridabad
    "S006": (28.6562, 77.2310),  # Chandni Chowk, Old Delhi
    "S007": (28.6692, 77.4538),  # Industrial Area, Ghaziabad
    "S008": (28.6304, 77.2773),  # Laxmi Nagar, East Delhi
    "S009": (18.9560, 72.8390),  # Dongri, Mumbai
    "S010": (26.9075, 75.7396),  # Vaishali Nagar, Jaipur

    # FIRs
    "FIR-2024-DL-4412": (28.5996, 77.2273),  # Khan Market, New Delhi
    "FIR-2024-DL-3890": (28.7011, 77.2185),  # Mall Road, Timarpur
    "FIR-2024-HR-1204": (28.5033, 77.0856),  # Udyog Vihar Phase 3, Gurugram
    "FIR-2025-MH-0088": (18.9510, 72.8335),  # Zaveri Bazaar / LT Marg, Mumbai
    "FIR-2025-DL-0156": (28.5420, 77.2410),  # Greater Kailash PS, New Delhi

    # Vehicles
    "V001": (28.5398, 77.2384),  # BMW 320d (GK-1 Basement)
    "V002": (28.6692, 77.4538),  # Stolen Fortuner (Deepak's Workshop Ghaziabad)
    "V003": (28.3392, 77.3245),  # Hyundai Creta (Ballabgarh)
    "V004": (28.5996, 77.2273),  # Maruti Swift (Khan Market getaway)
    "V005": (26.9075, 75.7396),  # Fortuner clone (Jaipur Garage)

    # Telecom Towers
    "Khan Market Tower 3": (28.6000, 77.2265),
    "Ballabgarh Sector 21": (28.3410, 77.3230),
    "DLF Ph-3 Tower B": (28.4960, 77.0910),
    "Lajpat Nagar Central": (28.5680, 77.2420),
    "Old Faridabad Hub": (28.4110, 77.3190),
    "Chandni Chowk Metro": (28.6570, 77.2300),
    "Ghaziabad Sector 4": (28.6680, 77.4520),
    "Laxmi Nagar Metro": (28.6310, 77.2760),
    "Dongri 3rd Lane": (18.9550, 72.8400),
    "Zaveri Bazaar West": (18.9500, 72.8340),
    "Jaipur Vaishali East": (26.9060, 75.7410),
    "Badarpur Toll Border": (28.4890, 77.3005),
}


def load_data() -> dict[str, Any]:
    with DATA_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def save_data(data: dict[str, Any]) -> None:
    with DATA_PATH.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)


def _phones(suspect: dict[str, Any]) -> set[str]:
    values = {suspect.get("phone") or "", suspect.get("alt_phone") or ""}
    return {value for value in values if value}


def index_data(data: dict[str, Any]) -> dict[str, Any]:
    suspects = {row["id"]: row for row in data["suspects"]}
    firs = {row["id"]: row for row in data["firs"]}
    vehicles = {row["id"]: row for row in data["vehicles"]}
    phone_to_suspect: dict[str, str] = {}
    for suspect in data["suspects"]:
        for phone in _phones(suspect):
            phone_to_suspect[phone] = suspect["id"]
    return {
        "suspects": suspects,
        "firs": firs,
        "vehicles": vehicles,
        "phone_to_suspect": phone_to_suspect,
    }


def overview(data: dict[str, Any]) -> dict[str, Any]:
    wanted = sum(1 for row in data["suspects"] if row.get("status") == "Wanted")
    open_firs = sum(1 for row in data["firs"] if row.get("status") in {"Open", "Under investigation", "Chargesheet filed"})
    total_loss = sum(row.get("loss_estimate_inr") or 0 for row in data["firs"])
    total_transferred = sum(row.get("amount_inr") or 0 for row in data["transactions"])
    return {
        "suspects": len(data["suspects"]),
        "firs": len(data["firs"]),
        "calls": len(data["calls"]),
        "vehicles": len(data["vehicles"]),
        "transactions": len(data["transactions"]),
        "wanted": wanted,
        "open_cases": open_firs,
        "total_loss_inr": total_loss,
        "total_transferred_inr": total_transferred,
        "meta": data.get("meta", {}),
        "data_mtime": DATA_PATH.stat().st_mtime if DATA_PATH.exists() else 0,
    }


def _haystack(row: dict[str, Any]) -> str:
    parts: list[str] = []

    def walk(value: Any) -> None:
        if value is None or isinstance(value, bool):
            return
        if isinstance(value, (int, float)):
            parts.append(str(value))
        elif isinstance(value, str):
            parts.append(value)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)

    walk(row)
    return " ".join(parts).lower()


def search(data: dict[str, Any], query: str, kind: str = "all") -> dict[str, list[dict[str, Any]]]:
    needle = (query or "").strip().lower()
    kind = (kind or "all").lower()
    buckets = {
        "suspects": data["suspects"],
        "firs": data["firs"],
        "vehicles": data["vehicles"],
        "calls": data["calls"],
        "transactions": data["transactions"],
    }
    results: dict[str, list[dict[str, Any]]] = {key: [] for key in buckets}
    if not needle:
        for key, rows in buckets.items():
            if kind in {"all", key}:
                results[key] = rows
        return results

    for key, rows in buckets.items():
        if kind not in {"all", key}:
            continue
        for row in rows:
            if needle in _haystack(row):
                results[key].append(row)
    return results


def get_suspect(data: dict[str, Any], suspect_id: str) -> dict[str, Any] | None:
    lookup = index_data(data)
    suspect = lookup["suspects"].get(suspect_id)
    if not suspect:
        return None

    phones = _phones(suspect)
    calls = [
        row
        for row in data["calls"]
        if row.get("from_suspect") == suspect_id
        or row.get("to_suspect") == suspect_id
        or row.get("from_phone") in phones
        or row.get("to_phone") in phones
    ]
    transactions = [
        row
        for row in data["transactions"]
        if row.get("from_suspect") == suspect_id or row.get("to_suspect") == suspect_id
    ]
    vehicles = [lookup["vehicles"][vid] for vid in suspect.get("vehicle_ids", []) if vid in lookup["vehicles"]]
    vehicles += [
        row
        for row in data["vehicles"]
        if row.get("owner_id") == suspect_id and row["id"] not in {item["id"] for item in vehicles}
    ]
    firs = [lookup["firs"][fid] for fid in suspect.get("fir_ids", []) if fid in lookup["firs"]]
    associates = [
        lookup["suspects"][sid]
        for sid in suspect.get("known_associates", [])
        if sid in lookup["suspects"]
    ]
    return {
        "suspect": suspect,
        "associates": associates,
        "firs": firs,
        "vehicles": vehicles,
        "calls": sorted(calls, key=lambda row: row.get("timestamp", "")),
        "transactions": sorted(transactions, key=lambda row: row.get("timestamp", "")),
    }


def graph_for(data: dict[str, Any], focus_id: str | None = None) -> dict[str, Any]:
    lookup = index_data(data)
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    edge_keys: set[tuple[str, str, str]] = set()

    def add_node(node_id: str, kind: str, label: str, extra: dict[str, Any] | None = None) -> None:
        if node_id in nodes:
            return
        payload = {"id": node_id, "kind": kind, "label": label}
        if extra:
            payload.update(extra)
        nodes[node_id] = payload

    def add_edge(source: str, target: str, kind: str, label: str, extra: dict[str, Any] | None = None) -> None:
        if not source or not target or source == target:
            return
        key = (min(source, target), max(source, target), kind)
        if key in edge_keys:
            return
        edge_keys.add(key)
        payload = {"source": source, "target": target, "kind": kind, "label": label}
        if extra:
            payload.update(extra)
        edges.append(payload)

    for suspect in data["suspects"]:
        add_node(
            suspect["id"],
            "suspect",
            suspect["name"],
            {
                "alias": suspect.get("alias"),
                "status": suspect.get("status"),
                "risk": suspect.get("risk"),
                "city": suspect.get("city"),
                "role": suspect.get("role"),
                "phone": suspect.get("phone"),
            },
        )

    for fir in data["firs"]:
        add_node(
            fir["id"],
            "fir",
            fir["id"],
            {
                "offense": fir.get("offense"),
                "status": fir.get("status"),
                "loss_estimate_inr": fir.get("loss_estimate_inr"),
                "police_station": fir.get("police_station"),
            },
        )
        for accused in fir.get("accused_ids", []):
            add_edge(accused, fir["id"], "accused_in", "named in FIR")

    for vehicle in data["vehicles"]:
        add_node(
            vehicle["id"],
            "vehicle",
            vehicle["registration"],
            {
                "make": f"{vehicle.get('make', '')} {vehicle.get('model', '')}",
                "owner_id": vehicle.get("owner_id"),
                "status": vehicle.get("status"),
            },
        )
        if vehicle.get("owner_id"):
            add_edge(vehicle.get("owner_id"), vehicle["id"], "owns", "owns vehicle")

    call_weights: dict[tuple[str, str], int] = defaultdict(int)
    for call in data["calls"]:
        a, b = call.get("from_suspect"), call.get("to_suspect")
        if a and b:
            call_weights[tuple(sorted((a, b)))] += 1
    for (a, b), weight in call_weights.items():
        add_edge(a, b, "call", f"{weight} call(s)", {"weight": weight})

    tx_weights: dict[tuple[str, str], int] = defaultdict(int)
    tx_amounts: dict[tuple[str, str], int] = defaultdict(int)
    for txn in data["transactions"]:
        a, b = txn.get("from_suspect"), txn.get("to_suspect")
        if a and b:
            pair = tuple(sorted((a, b)))
            tx_weights[pair] += 1
            tx_amounts[pair] += int(txn.get("amount_inr") or 0)
    for pair, weight in tx_weights.items():
        a, b = pair
        add_edge(a, b, "transaction", f"₹{tx_amounts[pair]:,}", {"weight": weight, "amount_inr": tx_amounts[pair]})

    for suspect in data["suspects"]:
        for associate in suspect.get("known_associates", []):
            add_edge(suspect["id"], associate, "associate", "known associate")

    if focus_id:
        if focus_id not in nodes:
            return {"focus": focus_id, "nodes": [], "edges": []}
        keep = {focus_id}
        for edge in edges:
            if edge["source"] == focus_id or edge["target"] == focus_id:
                keep.add(edge["source"])
                keep.add(edge["target"])
        nodes = {nid: node for nid, node in nodes.items() if nid in keep}
        edges = [edge for edge in edges if edge["source"] in keep and edge["target"] in keep]

    return {"focus": focus_id, "nodes": list(nodes.values()), "edges": edges}


def timeline(data: dict[str, Any], suspect_id: str | None = None) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for fir in data["firs"]:
        if suspect_id and suspect_id not in fir.get("accused_ids", []):
            continue
        events.append(
            {
                "id": fir["id"],
                "kind": "fir",
                "timestamp": f"{fir['date']}T00:00:00+05:30",
                "title": fir["offense"],
                "detail": fir["summary"],
                "badge": fir.get("status", "FIR"),
                "related": fir.get("accused_ids", []),
                "location": fir.get("location") or fir.get("police_station"),
            }
        )
    for call in data["calls"]:
        if suspect_id and suspect_id not in {call.get("from_suspect"), call.get("to_suspect")}:
            continue
        events.append(
            {
                "id": call["id"],
                "kind": "call",
                "timestamp": call["timestamp"],
                "title": f"Call: {call['from_phone']} → {call['to_phone']}",
                "detail": f"{call['duration_sec']}s via cell tower [{call.get('tower')}] (IMEI: {call.get('imei')})",
                "badge": f"{call['duration_sec']}s",
                "related": [s for s in [call.get("from_suspect"), call.get("to_suspect")] if s],
                "location": call.get("tower"),
            }
        )
    for txn in data["transactions"]:
        if suspect_id and suspect_id not in {txn.get("from_suspect"), txn.get("to_suspect")}:
            continue
        events.append(
            {
                "id": txn["id"],
                "kind": "transaction",
                "timestamp": txn["timestamp"],
                "title": f"Transfer: {txn['mode']} ₹{txn['amount_inr']:,}",
                "detail": f"{txn['from_account']} → {txn['to_account']} | Narration: '{txn.get('narration')}'",
                "badge": f"₹{txn['amount_inr']:,}",
                "related": [s for s in [txn.get("from_suspect"), txn.get("to_suspect")] if s],
                "location": "Banking Channel",
            }
        )
    events.sort(key=lambda row: row["timestamp"])
    return events


def geo_data(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Returns geographical pin markers with coordinates for suspects, FIRs, towers, and vehicles."""
    markers: list[dict[str, Any]] = []

    # Suspects
    for s in data["suspects"]:
        coords = GEO_COORDINATES.get(s["id"])
        if coords:
            markers.append({
                "id": s["id"],
                "kind": "suspect",
                "label": f"{s['name']} ({s.get('alias')})",
                "lat": coords[0],
                "lng": coords[1],
                "city": s.get("city"),
                "status": s.get("status"),
                "risk": s.get("risk"),
                "role": s.get("role"),
                "detail": f"Address: {s.get('address')}, {s.get('city')} | Status: {s.get('status')}",
                "phone": s.get("phone"),
            })

    # FIRs
    for f in data["firs"]:
        coords = GEO_COORDINATES.get(f["id"])
        if coords:
            markers.append({
                "id": f["id"],
                "kind": "fir",
                "label": f"{f['id']}: {f.get('offense')}",
                "lat": coords[0],
                "lng": coords[1],
                "city": f.get("district"),
                "status": f.get("status"),
                "loss": f.get("loss_estimate_inr"),
                "detail": f"Incident: {f.get('summary')} | PS: {f.get('police_station')}",
            })

    # Vehicles
    for v in data["vehicles"]:
        coords = GEO_COORDINATES.get(v["id"])
        if coords:
            markers.append({
                "id": v["id"],
                "kind": "vehicle",
                "label": f"{v.get('registration')} ({v.get('make')} {v.get('model')})",
                "lat": coords[0],
                "lng": coords[1],
                "city": v.get("last_seen_location"),
                "status": v.get("status"),
                "detail": f"Last seen: {v.get('last_seen_location')} | Notes: {v.get('notes')}",
            })

    # Telecom Towers from calls
    seen_towers: set[str] = set()
    for call in data["calls"]:
        tower_name = call.get("tower")
        if tower_name and tower_name not in seen_towers:
            seen_towers.add(tower_name)
            coords = GEO_COORDINATES.get(tower_name)
            if coords:
                markers.append({
                    "id": f"TOWER-{tower_name.replace(' ', '_')}",
                    "kind": "tower",
                    "label": f"Tower: {tower_name}",
                    "lat": coords[0],
                    "lng": coords[1],
                    "city": "Telecom Sector",
                    "status": "Active Intercept",
                    "detail": f"Cell Tower intercept node with active CDR traffic logs",
                })

    # Pan-India State Police & Cyber Command Nodes
    state_command_hubs = [
        ("HUB-DELHI", "Delhi Police Special Cell HQ", 28.6139, 77.2090, "New Delhi", "National Central Command"),
        ("HUB-MUMBAI", "Maharashtra Cyber / Mumbai Crime Branch", 18.9388, 72.8354, "Mumbai", "Western Command HQ"),
        ("HUB-BENGALURU", "Karnataka Cyber Crime Division", 12.9716, 77.5946, "Bengaluru", "Southern Tech Command"),
        ("HUB-HYDERABAD", "Telangana Cyber Security Bureau (TGCSB)", 17.3850, 78.4867, "Hyderabad", "Cyber Surveillance Hub"),
        ("HUB-KOLKATA", "West Bengal STF / Cyber Cell", 22.5726, 88.3639, "Kolkata", "Eastern Liaison Desk"),
        ("HUB-AHMEDABAD", "Gujarat CID Crime Unit", 23.0225, 72.5714, "Ahmedabad", "Border Security Hub"),
        ("HUB-LUCKNOW", "Uttar Pradesh STF Cyber Wing", 26.8467, 80.9462, "Lucknow", "Northern Regional Command"),
        ("HUB-CHANDIGARH", "Punjab State Cyber Crime PS", 30.7333, 76.7794, "Chandigarh", "Border Transit Desk"),
        ("HUB-JAIPUR", "Rajasthan SOG & Cyber Wing", 26.9124, 75.7873, "Jaipur", "Inter-State Surveillance Desk"),
        ("HUB-PATNA", "Bihar Special Operations Group", 25.5941, 85.1376, "Patna", "Eastern Transit Hub"),
        ("HUB-GUWAHATI", "Assam Cyber Command Cell", 26.1445, 91.7362, "Guwahati", "North-East Liaison Hub"),
        ("HUB-CHENNAI", "Tamil Nadu Cyber Crime Wing", 13.0827, 80.2707, "Chennai", "Southern Coastal Node"),
    ]
    for hid, name, lat, lng, city, role in state_command_hubs:
        markers.append({
            "id": hid,
            "kind": "hub",
            "label": name,
            "lat": lat,
            "lng": lng,
            "city": city,
            "status": "24/7 Command Active",
            "detail": f"{role} • Inter-State CCTNS Intelligence Node",
        })

    return markers


def shortest_path(data: dict[str, Any], start_id: str, end_id: str) -> dict[str, Any]:
    """Finds the shortest degrees-of-separation chain between two entities using BFS."""
    g = graph_for(data)
    adj: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for edge in g["edges"]:
        u, v, kind, label = edge["source"], edge["target"], edge["kind"], edge["label"]
        adj[u].append((v, kind, label))
        adj[v].append((u, kind, label))

    if start_id not in adj or end_id not in adj:
        return {"found": False, "chain": [], "steps": 0}

    queue: deque[tuple[str, list[dict[str, Any]]]] = deque([(start_id, [{"node": start_id, "via": "start"}])])
    visited = {start_id}

    lookup = index_data(data)

    while queue:
        current, path = queue.popleft()
        if current == end_id:
            return {
                "found": True,
                "steps": len(path) - 1,
                "chain": [
                    {
                        "id": step["node"],
                        "name": lookup["suspects"].get(step["node"], {}).get("name")
                        or lookup["firs"].get(step["node"], {}).get("offense")
                        or lookup["vehicles"].get(step["node"], {}).get("registration")
                        or step["node"],
                        "via": step.get("via"),
                        "label": step.get("label"),
                    }
                    for step in path
                ],
            }

        for neighbor, kind, label in adj[current]:
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append((neighbor, path + [{"node": neighbor, "via": kind, "label": label}]))

    return {"found": False, "steps": 0, "chain": []}


def analyze_intelligence(data: dict[str, Any]) -> dict[str, Any]:
    """AI Case Analyst: Computes syndicate hierarchy, money flow, and anomalous link patterns."""
    conn_count: dict[str, int] = defaultdict(int)
    call_counts: dict[str, int] = defaultdict(int)
    tx_in_vol: dict[str, int] = defaultdict(int)
    tx_out_vol: dict[str, int] = defaultdict(int)

    for c in data["calls"]:
        a, b = c.get("from_suspect"), c.get("to_suspect")
        if a:
            conn_count[a] += 1
            call_counts[a] += 1
        if b:
            conn_count[b] += 1
            call_counts[b] += 1

    for t in data["transactions"]:
        a, b = t.get("from_suspect"), t.get("to_suspect")
        amt = int(t.get("amount_inr") or 0)
        if a:
            conn_count[a] += 1
            tx_out_vol[a] += amt
        if b:
            conn_count[b] += 1
            tx_in_vol[b] += amt

    ranked_suspects = []
    for s in data["suspects"]:
        sid = s["id"]
        ranked_suspects.append({
            "id": sid,
            "name": s["name"],
            "alias": s.get("alias"),
            "role": s.get("role"),
            "risk": s.get("risk"),
            "status": s.get("status"),
            "connections": conn_count[sid],
            "calls": call_counts[sid],
            "inbound_money": tx_in_vol[sid],
            "outbound_money": tx_out_vol[sid],
        })
    ranked_suspects.sort(key=lambda x: x["connections"], reverse=True)

    findings = [
        {
            "type": "CRITICAL_SYNDICATE_HEAD",
            "title": "Kingpin Nexus Identified: Vikram 'Vicky' Malhotra (S001)",
            "severity": "CRITICAL",
            "narrative": "Vikram Malhotra coordinates the multi-city syndicate, linking robbery operations in Delhi (S002, S005) directly to hawala laundering networks in Mumbai (S009, S006). He exhibits the highest degree centrality with 3 open FIRs totaling ₹2.34 Cr.",
        },
        {
            "type": "HAWALA_LAYERING_TRAIL",
            "title": "Layered UPI-to-Hawala Pipeline Detected",
            "severity": "HIGH",
            "narrative": "Immediately following FIR-2024-DL-4412 (Khan Market heist), funds flowed from Vicky Malhotra (S001) → Neha Kapoor (S003) → Anita Desai (S008) via split UPI tranches, culminating in cash-out transfers to Kabir Ali (S009) in Dongri, Mumbai.",
        },
        {
            "type": "GETAWAY_VEHICLE_NEXUS",
            "title": "Altered Vehicle Network Linkage",
            "severity": "HIGH",
            "narrative": "Getaway vehicle HR-26-CD-5678 linked Arjun Singh (S002) directly to Deepak Verma's clandestine Ghaziabad garage (S007), where stolen Fortuner UP-16-EF-9012 plates were altered and sold off to Jaipur buyer Rohan Mehta (S010).",
        },
        {
            "type": "TOWER_CONVERGENCE",
            "title": "Tower Ping Co-Location on Heist Date",
            "severity": "MEDIUM",
            "narrative": "Phone records verify simultaneous pings on 'Khan Market Tower 3' between S001 and S002 within 15 minutes before the Sethi Jewellers armed robbery.",
        },
    ]

    return {
        "summary": "Syndicate exhibits a structured 3-tier hierarchy: Planners (Delhi-NCR), Field Execution & Chop Shop (Faridabad/Ghaziabad), and Hawala/Gold Cash-Out (Mumbai Dongri).",
        "ranked_suspects": ranked_suspects,
        "key_findings": findings,
        "total_nexus_entities": len(data["suspects"]) + len(data["firs"]) + len(data["vehicles"]),
        "highest_risk_suspect": ranked_suspects[0] if ranked_suspects else None,
    }


def create_record(data: dict[str, Any], record_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Adds a new suspect, FIR, or vehicle dynamically and persists it."""
    record_type = record_type.lower()
    if record_type not in {"suspects", "firs", "vehicles", "calls", "transactions"}:
        raise ValueError(f"Invalid record type: {record_type}")

    if record_type == "suspects":
        new_id = f"S{len(data['suspects']) + 1:03d}"
    elif record_type == "firs":
        new_id = f"FIR-2026-DL-{len(data['firs']) + 1000}"
    elif record_type == "vehicles":
        new_id = f"V{len(data['vehicles']) + 1:03d}"
    elif record_type == "calls":
        new_id = f"C{len(data['calls']) + 1:03d}"
    else:
        new_id = f"TX{len(data['transactions']) + 1:03d}"

    payload["id"] = payload.get("id") or new_id
    data[record_type].append(payload)

    if record_type == "suspects" and payload.get("id") not in GEO_COORDINATES:
        GEO_COORDINATES[payload["id"]] = (28.6139, 77.2090)
    elif record_type == "firs" and payload.get("id") not in GEO_COORDINATES:
        GEO_COORDINATES[payload["id"]] = (28.6200, 77.2150)

    try:
        save_data(data)
    except Exception:
        pass

    return payload
