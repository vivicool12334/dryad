#!/usr/bin/env bash
#
# Deploy the satellite monitor stack to the Hetzner box where Dryad runs.
# Idempotent: safe to run multiple times.
#
# Run on the Hetzner box, not on your laptop:
#   ssh dryad@<host>
#   cd /path/to/dryad-eliza
#   bash scripts/deploy-satellite-monitor.sh
#
# Optionally, set WEB3_STORAGE_TOKEN before running for IPFS pinning.
# Without it, the system runs fine in local-only mode.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MICROSERVICE_DIR="$REPO_ROOT/services/satellite-microservice"

echo "==> Dryad satellite monitor deploy"
echo "    repo:         $REPO_ROOT"
echo "    microservice: $MICROSERVICE_DIR"
echo

# 1. Pull latest code
echo "==> 1. Pulling latest code"
cd "$REPO_ROOT"
git pull --ff-only

# 2. Build + start the satellite microservice
echo
echo "==> 2. Building + starting satellite microservice"
cd "$MICROSERVICE_DIR"

# Write .env if WEB3_STORAGE_TOKEN is provided
if [ -n "${WEB3_STORAGE_TOKEN:-}" ]; then
    echo "WEB3_STORAGE_TOKEN=$WEB3_STORAGE_TOKEN" > .env
    echo "    wrote .env with WEB3_STORAGE_TOKEN"
else
    echo "    no WEB3_STORAGE_TOKEN provided; pinning will be skipped (local-only mode)"
fi

docker compose up --build -d
sleep 5

# Health check
echo
echo "==> 3. Health check"
HEALTH=$(curl -fsS http://localhost:9006/health || echo "{}")
echo "$HEALTH"
if ! echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo "ERROR: microservice did not become healthy" >&2
    docker compose logs --tail 30
    exit 1
fi

# 4. Restart the Dryad agent (assumes pm2 - adjust if you use systemd)
echo
echo "==> 4. Restarting Dryad agent"
cd "$REPO_ROOT"
if command -v pm2 > /dev/null 2>&1; then
    pm2 restart dryad || pm2 start "elizaos start" --name dryad
elif systemctl is-enabled dryad.service > /dev/null 2>&1; then
    sudo systemctl restart dryad.service
else
    echo "    no known process manager. Restart the agent manually:"
    echo "    pm2 restart dryad   (or)   systemctl restart dryad.service"
fi

# 5. Optional: trigger first cycle + flush
echo
echo "==> 5. Optional first-cycle commands (run manually if you want)"
echo
echo "    # Force a satellite cycle right now (in addition to the weekly auto-trigger):"
echo "    curl -X POST http://localhost:9006/observe \\"
echo "         -H 'Content-Type: application/json' \\"
echo "         -d '{\"window_days\": 30, \"cloud_cover_max\": 30, \"pin_to_ipfs\": true}'"
echo
echo "    # Export the satellite history for the public satellite.html page:"
echo "    python3 services/satellite-microservice/scripts/export_history.py"
echo
echo "    # Refresh the public heat-map imagery (run periodically):"
echo "    python3 services/satellite-microservice/scripts/generate_heat_map.py"
echo
echo "    # Refresh Sentinel-2 + NAIP demo imagery on the docs page:"
echo "    python3 services/satellite-microservice/scripts/generate_demo_assets.py"
echo "    python3 services/satellite-microservice/scripts/generate_naip_assets.py"
echo
echo "==> Done."
