#!/bin/bash
# STARTUP SCRIPT FOR GESTAO ESPORTIVA ESCOLAR (Linux/macOS)
# Ensures MongoDB is running, opens required firewall ports,
# and starts backend (FastAPI:8000) + frontend (Vite:5173)

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/student-portal"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
MONGODB_PORT="${MONGODB_PORT:-27017}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'

echo -e "${CYAN}=== Gestao Esportiva Escolar - Startup ===${NC}"
echo ""

# ─── 1. Firewall Rules (Linux) ───────────────────────────────────────────
if command -v ufw &> /dev/null; then
    echo -e "${YELLOW}[1/4] Opening firewall ports with UFW...${NC}"
    for port in 5173 8000 9222 "$MONGODB_PORT"; do
        if ! sudo ufw status | grep -q "$port"; then
            sudo ufw allow "$port/tcp" 2>/dev/null || echo "   Could not configure UFW for port $port"
            echo "   Opened TCP/$port"
        else
            echo "   TCP/$port already open"
        fi
    done
else
    echo -e "${YELLOW}[1/4] UFW not available, skipping firewall configuration${NC}"
fi

# ─── 2. MongoDB Check ─────────────────────────────────────────────────────
echo -e "${YELLOW}[2/4] Checking MongoDB (port $MONGODB_PORT)...${NC}"
if lsof -Pi :$MONGODB_PORT -sTCP:LISTEN > /dev/null 2>&1; then
    echo -e "   MongoDB is already running on port $MONGODB_PORT ${GREEN}(✓)${NC}"
else
    echo "   MongoDB not detected"
    if command -v mongod &> /dev/null; then
        mongod --port "$MONGODB_PORT" --dbpath /tmp/mongodb &
        sleep 3
        echo -e "   MongoDB started (port $MONGODB_PORT) ${GREEN}(✓)${NC}"
    else
        echo -e "   WARNING: mongod not found. Use external MongoDB or connect via Docker."
        echo -e "   Update backend/.env with MONGO_URL=..."
    fi
fi

# ─── 3. Backend (FastAPI) ─────────────────────────────────────────────────
echo -e "${YELLOW}[3/4] Starting backend (FastAPI on :$BACKEND_PORT)...${NC}"
cd "$BACKEND_DIR"
if [ -d "venv" ]; then
    source venv/bin/activate
    nohup python -m uvicorn server:app --reload --port "$BACKEND_PORT" --host 0.0.0.0 > /tmp/fastapi.log 2>&1 &
else
    nohup python3 -m uvicorn server:app --reload --port "$BACKEND_PORT" --host 0.0.0.0 > /tmp/fastapi.log 2>&1 &
fi
sleep 2
echo -e "   Backend started: http://localhost:$BACKEND_PORT ${GREEN}(✓)${NC}"

# ─── 4. Frontend (Vite) ───────────────────────────────────────────────────
echo -e "${YELLOW}[4/4] Starting frontend (Vite on :$FRONTEND_PORT)...${NC}"
cd "$FRONTEND_DIR"
if [ -f "package.json" ]; then
    nohup npm run dev -- --port "$FRONTEND_PORT" --host 0.0.0.0 > /tmp/vite.log 2>&1 &
    sleep 2
    echo -e "   Frontend started: http://localhost:$FRONTEND_PORT ${GREEN}(✓)${NC}"
else
    echo -e "   ERROR: package.json not found in student-portal ${RED}(✗)${NC}"
fi

echo ""
echo -e "${CYAN}=== Application Ready ===${NC}"
echo -e "  Frontend: http://localhost:$FRONTEND_PORT"
echo -e "  Backend:  http://localhost:$BACKEND_PORT"
echo -e "  API Docs: http://localhost:$BACKEND_PORT/docs"
echo ""
echo "To stop services: pkill -f 'uvicorn.*server:app' && pkill -f 'vite'"