## Changes Made

### 1. Start FastAPI before the Vite debug server
- **File:** `.vscode/tasks.json`
- **Change:** Add a FastAPI background startup task and make `Start Frontend (Vite 5173)` depend on it in sequence. The backend task reports readiness after a healthy existing API or Uvicorn's application-startup-complete message.
- **Why:** Frontend debugging previously started Vite alone while the proxy expected an API on port 8000.
- **Revert:** Remove the backend dependency and restore the original direct `uvicorn` task.

### 2. Preflight MongoDB and launch backend using Python
- **File:** `.vscode/start-backend-debug.ps1` (new)
- **Change:** Reuse a healthy FastAPI process on port 8000, otherwise select the project's virtualenv or available Python, check MongoDB using the configured `backend/.env` URI with a short timeout, and start Uvicorn. The check-only mode fails with an actionable message when MongoDB is unavailable or the port is already occupied.
- **Why:** `backend/.env` points to local MongoDB at `localhost:27017`; no service was listening there, so FastAPI stalled in its startup index checks and `/api/auth/login` proxy requests were refused.
- **Revert:** Remove `.vscode/start-backend-debug.ps1` and restore the previous task/launch settings.

### 3. Gate backend debugging on prerequisites
- **File:** `.vscode/launch.json`
- **Change:** Run FastAPI as the `uvicorn` module under debugpy and add `Check Backend Prerequisites` as its pre-launch task.
- **Why:** Make backend startup use the same command path as the task and report a missing database before launch.
- **Revert:** Restore the direct `server.py` launch and remove its pre-launch task.

## Validation
- Confirmed `http://127.0.0.1:8000/api/health` was refused because there was no listener on port 8000.
- Confirmed the configured MongoDB host/port are `localhost:27017`, with no Mongo listener or `mongod` command/service available.
- Launched Uvicorn and observed startup hang on `ensure_indexes` because MongoDB was unavailable; stopped the test process afterward.
- Confirmed the new check-only startup script exits with code 1 and a concise MongoDB-unavailable message under the current environment.
- Confirmed login is registered at `POST /api/auth/login` and `/api/health` exists in FastAPI.

## Revert Status
- [ ] Change 1 - Backend task dependency
- [ ] Change 2 - MongoDB preflight/start script
- [ ] Change 3 - Backend debug launch configuration
