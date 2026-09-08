#!/bin/bash
# Runs the full MiniCDN stack without Docker, using a locally-built redis-server.
# Usage: ./run-local.sh          (start everything, Ctrl+C to stop all)
#
# Reads a .env file in this directory if present (copy .env.example to .env
# to override anything). Every variable already has a working default below,
# so .env is optional.
set -e
cd "$(dirname "$0")"

if [ -f .env ]; then
  echo "Loading .env..."
  set -a
  source .env
  set +a
fi

REDIS_BIN="${REDIS_SERVER_BIN:-redis-server}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

ORIGIN_PORT="${ORIGIN_PORT:-4000}"
DEFAULT_MAX_AGE_SECONDS="${DEFAULT_MAX_AGE_SECONDS:-30}"

EDGE_US_PORT="${EDGE_US_PORT:-4001}"
EDGE_US_NODE_ID="${EDGE_US_NODE_ID:-us}"
EDGE_US_REGION="${EDGE_US_REGION:-iad}"
EDGE_US_SIMULATED_ORIGIN_LATENCY_MS="${EDGE_US_SIMULATED_ORIGIN_LATENCY_MS:-40}"

EDGE_EU_PORT="${EDGE_EU_PORT:-4002}"
EDGE_EU_NODE_ID="${EDGE_EU_NODE_ID:-eu}"
EDGE_EU_REGION="${EDGE_EU_REGION:-fra}"
EDGE_EU_SIMULATED_ORIGIN_LATENCY_MS="${EDGE_EU_SIMULATED_ORIGIN_LATENCY_MS:-70}"

EDGE_ASIA_PORT="${EDGE_ASIA_PORT:-4003}"
EDGE_ASIA_NODE_ID="${EDGE_ASIA_NODE_ID:-asia}"
EDGE_ASIA_REGION="${EDGE_ASIA_REGION:-sin}"
EDGE_ASIA_SIMULATED_ORIGIN_LATENCY_MS="${EDGE_ASIA_SIMULATED_ORIGIN_LATENCY_MS:-110}"

MAX_CACHE_ENTRIES="${MAX_CACHE_ENTRIES:-200}"
ORIGIN_URL="${ORIGIN_URL:-http://localhost:$ORIGIN_PORT}"

ROUTING_PORT="${ROUTING_PORT:-5000}"
ROUTING_MODE="${ROUTING_MODE:-proxy}"
HEALTH_POLL_INTERVAL_MS="${HEALTH_POLL_INTERVAL_MS:-5000}"
EDGE_US_URL="${EDGE_US_URL:-http://localhost:$EDGE_US_PORT}"
EDGE_EU_URL="${EDGE_EU_URL:-http://localhost:$EDGE_EU_PORT}"
EDGE_ASIA_URL="${EDGE_ASIA_URL:-http://localhost:$EDGE_ASIA_PORT}"

echo "Building shared + services..."
npm run build --workspace=@minicdn/shared
npm run build --workspace=origin
npm run build --workspace=edge
npm run build --workspace=routing

if [ ! -d "origin/data/assets" ] || [ -z "$(ls -A origin/data/assets 2>/dev/null)" ]; then
  echo "Seeding origin assets..."
  npm run seed --workspace=origin
fi

echo "Starting redis-server on :6379..."
"$REDIS_BIN" --port 6379 --save "" &
REDIS_PID=$!
sleep 1

cleanup() {
  echo ""
  echo "Stopping all services..."
  kill $REDIS_PID $ORIGIN_PID $EDGE_US_PID $EDGE_EU_PID $EDGE_ASIA_PID $ROUTING_PID 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting origin on :$ORIGIN_PORT..."
PORT=$ORIGIN_PORT REDIS_URL=$REDIS_URL DEFAULT_MAX_AGE_SECONDS=$DEFAULT_MAX_AGE_SECONDS node origin/dist/server.js &
ORIGIN_PID=$!

sleep 1

echo "Starting edge nodes on :$EDGE_US_PORT (us) :$EDGE_EU_PORT (eu) :$EDGE_ASIA_PORT (asia)..."
PORT=$EDGE_US_PORT NODE_ID=$EDGE_US_NODE_ID REGION=$EDGE_US_REGION ORIGIN_URL=$ORIGIN_URL REDIS_URL=$REDIS_URL MAX_CACHE_ENTRIES=$MAX_CACHE_ENTRIES SIMULATED_ORIGIN_LATENCY_MS=$EDGE_US_SIMULATED_ORIGIN_LATENCY_MS node edge/dist/server.js &
EDGE_US_PID=$!
PORT=$EDGE_EU_PORT NODE_ID=$EDGE_EU_NODE_ID REGION=$EDGE_EU_REGION ORIGIN_URL=$ORIGIN_URL REDIS_URL=$REDIS_URL MAX_CACHE_ENTRIES=$MAX_CACHE_ENTRIES SIMULATED_ORIGIN_LATENCY_MS=$EDGE_EU_SIMULATED_ORIGIN_LATENCY_MS node edge/dist/server.js &
EDGE_EU_PID=$!
PORT=$EDGE_ASIA_PORT NODE_ID=$EDGE_ASIA_NODE_ID REGION=$EDGE_ASIA_REGION ORIGIN_URL=$ORIGIN_URL REDIS_URL=$REDIS_URL MAX_CACHE_ENTRIES=$MAX_CACHE_ENTRIES SIMULATED_ORIGIN_LATENCY_MS=$EDGE_ASIA_SIMULATED_ORIGIN_LATENCY_MS node edge/dist/server.js &
EDGE_ASIA_PID=$!

sleep 1

echo "Starting routing layer on :$ROUTING_PORT..."
PORT=$ROUTING_PORT ROUTING_MODE=$ROUTING_MODE HEALTH_POLL_INTERVAL_MS=$HEALTH_POLL_INTERVAL_MS EDGE_US_URL=$EDGE_US_URL EDGE_EU_URL=$EDGE_EU_URL EDGE_ASIA_URL=$EDGE_ASIA_URL node routing/dist/server.js &
ROUTING_PID=$!

sleep 1
echo ""
echo "=== MiniCDN is running ==="
echo "  Origin:      http://localhost:$ORIGIN_PORT"
echo "  Edge US:     http://localhost:$EDGE_US_PORT"
echo "  Edge EU:     http://localhost:$EDGE_EU_PORT"
echo "  Edge Asia:   http://localhost:$EDGE_ASIA_PORT"
echo "  Routing:     http://localhost:$ROUTING_PORT"
echo ""
echo "  Dashboard: run 'cd dashboard && npm run dev' in another terminal, then open http://localhost:5173"
echo "  (if you changed ports above, also update dashboard/src/config.ts to match)"
echo ""
echo "Try:  curl -i \"http://localhost:$ROUTING_PORT/assets/api/config.json?loc=singapore\""
echo ""
echo "Press Ctrl+C to stop everything."
wait
