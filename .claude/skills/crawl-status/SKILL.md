---
name: crawl-status
description: Show the status and details of the most recent crawl runs, including items added per source and any errors
---

Fetch and display the last 3 crawl runs from the API:

```bash
curl -s http://localhost:8000/api/runs?limit=3
```

Format the output as a clear summary for each run:
- Run ID, status (running/completed/failed), started_at, finished_at
- From the `notes` field (JSON): items added per source, images downloaded, any errors per source
- If status is "running", note that a crawl is currently in progress

If the server is not running, say so and remind the user to start it with the FastAPI backend launch config.

Also check healthz to confirm the server is up before fetching runs:
```bash
curl -s http://localhost:8000/healthz
```
