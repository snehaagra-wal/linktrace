# LinkTrace

Police investigation support prototype: search suspects, FIRs, vehicles, calls, and money movement, then inspect how they connect.

## Run

```bash
python3 backend/server.py
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765).

Uses Python 3 only (no extra packages). Mock records live in `data.json`.

## API

| Endpoint | Purpose |
| --- | --- |
| `/api/overview` | Counts and case totals |
| `/api/search?q=&type=` | Full-text search (`suspects`, `firs`, `vehicles`, `calls`, `transactions`, or `all`) |
| `/api/suspects/{id}` | Dossier: FIRs, vehicles, calls, transfers |
| `/api/graph?focus=S001` | Connection graph (omit `focus` for the full network) |
| `/api/timeline?suspect=S001` | Ordered events |

The dashboard traces a mock NCR–Mumbai jewellery / hawala series centered on Vikram “Vicky” Malhotra (`S001`).
