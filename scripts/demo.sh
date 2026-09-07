#!/usr/bin/env bash
# Demo scenarios for the reliable webhook processor.
# Usage: ./scripts/demo.sh <scenario>
set -euo pipefail
API=${API_URL:-http://localhost:3001}

post() {
  curl -s -X POST "$API/webhooks" -H 'Content-Type: application/json' -d "$1" > /dev/null
}

case "${1:-}" in
  duplicate)
    BODY='{"eventId":"evt-dup-1","type":"order.created","data":{"orderId":"ORD-1","simulate":"ok"}}'
    post "$BODY" & post "$BODY" & post "$BODY" &
    wait
    echo "Submitted the same eventId 3x concurrently."
    echo "Check: SELECT count(*) FROM processed_orders WHERE event_id='evt-dup-1'; -- expect 1"
    ;;
  temp-failure)
    post '{"eventId":"evt-temp-1","type":"order.created","data":{"orderId":"ORD-2","simulate":"fail_then_succeed:2"}}'
    echo "Submitted evt-temp-1."
    echo "Check: SELECT * FROM attempt_history WHERE event_id='evt-temp-1' ORDER BY attempt_number;"
    ;;
  permanent-failure)
    post '{"eventId":"evt-fail-1","type":"order.created","data":{"orderId":"ORD-3","simulate":"always_fail"}}'
    echo "Submitted evt-fail-1."
    echo "After max_attempts, check: SELECT status FROM webhook_events WHERE event_id='evt-fail-1'; -- expect permanently_failed"
    ;;
  parallel)
    for i in 1 2 3 4; do
      post "{\"eventId\":\"evt-slow-$i\",\"type\":\"order.created\",\"data\":{\"orderId\":\"ORD-S$i\",\"simulate\":\"slow:8\"}}" &
    done
    wait
    echo "Submitted 4 events with simulate=slow:8."
    echo "Check attempt_history.started_at — with 2 workers, pairs should overlap, not run sequentially."
    ;;
  crash)
    post '{"eventId":"evt-crash-1","type":"order.created","data":{"orderId":"ORD-C1","simulate":"slow:45"}}'
    echo "Submitted evt-crash-1 (slow:45s, longer than the 30s lease)."
    echo "Now run: docker compose kill worker-1"
    echo "Watch worker-2 pick it up once the lease expires, and confirm only one processed_orders row results."
    ;;
  burst)
    for i in $(seq 1 500); do
      post "{\"eventId\":\"evt-burst-$i\",\"type\":\"order.created\",\"data\":{\"orderId\":\"ORD-B$i\",\"simulate\":\"ok\"}}" &
      if (( i % 50 == 0 )); then wait; fi
    done
    wait
    echo "Submitted 500 events."
    echo "Check: SELECT status, count(*) FROM webhook_events GROUP BY status; -- everything should reach a terminal state"
    ;;
  *)
    echo "Usage: $0 {duplicate|temp-failure|permanent-failure|parallel|crash|burst}"
    exit 1
    ;;
esac
