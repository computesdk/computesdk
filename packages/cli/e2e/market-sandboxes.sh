#!/usr/bin/env bash
# market-sandboxes.sh — end-to-end test of the sandbox compute market against
# the live platform (default https://platform.computesdk.com).
#
# Spends real (granted) market credits. NOT for CI.
#
# Required env:
#   E2E_BUYER_KEY     platform API key for the buyer org (sandbox lane, credits)
#   E2E_SELLER_KEY    platform API key for the seller org (sandbox lane seller)
#   E2E_ACTIONS_KEY   platform API key for an actions-lane-only org
#   E2E_SELLER_PROVIDER  seller's executor provider id (e.g. isorun)
#   <SELLER_PROVIDER>_<FIELD>  seller executor credential env vars
#                            (e.g. ISORUN_API_KEY for isorun's apiKey field)
#   E2E_OWNKEY_PROVIDER        provider id the actions org keys itself
#   E2E_OWNKEY_PROVIDER_KEY    that provider's key (stored via # API before A2)
#
# Optional env:
#   BASE_URL          default https://platform.computesdk.com
#   E2E_PARTS         space-separated subset of: seller buyer actions oauth
#                     (default: all non-MCP parts; MCP is a separate script,
#                     e2e/mcp-oauth-client.mjs)
#
# Every sandbox gets label e2e-<runid>-<step> and --timeout-ms 600000.
# A trap destroys e2e sandboxes, withdraws this run's asks, and clears any
# cap the run set — even on failure.
set -u

BASE_URL="${BASE_URL:-https://platform.computesdk.com}"
RUN_ID="${E2E_RUN_ID:-$(date +%s)}"
COMPUTE="${COMPUTE:-compute}"
TIMEOUT_MS=600000

: "${E2E_BUYER_KEY:?set E2E_BUYER_KEY}"
: "${E2E_SELLER_KEY:?set E2E_SELLER_KEY}"
: "${E2E_ACTIONS_KEY:?set E2E_ACTIONS_KEY}"
: "${E2E_SELLER_PROVIDER:?set E2E_SELLER_PROVIDER}"
: "${E2E_OWNKEY_PROVIDER:?set E2E_OWNKEY_PROVIDER}"

PARTS="${E2E_PARTS:-seller buyer actions}"

RESULTS=()
CREATED_IDS=()
POSTED_ASKS=()
PAUSED_ASKS=()
CAP_SET=0

pass() { RESULTS+=("PASS $1"); echo "PASS $1"; }
fail() { RESULTS+=("FAIL $1"); echo "FAIL $1"; echo "  $2" | sed 's/^/    /'; }
check() { # check <name> <condition-exit-status>
  local name="$1"; shift
  if "$@"; then pass "$name"; else fail "$name" "check failed"; fi
}

jqget() { jq -r "$2" <<<"$1" 2>/dev/null; }

# ─── wrappers ──────────────────────────────────────────────────────────────
buyer()   { "$COMPUTE" "$@" --api-key "$E2E_BUYER_KEY"   --base-url "$BASE_URL"; }
seller()  { "$COMPUTE" "$@" --api-key "$E2E_SELLER_KEY"  --base-url "$BASE_URL"; }
actions() { "$COMPUTE" "$@" --api-key "$E2E_ACTIONS_KEY" --base-url "$BASE_URL"; }
api() {   # api <key> <METHOD> <path> [json-body]
  local key="$1" method="$2" path="$3" body="${4:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $key" -H 'Content-Type: application/json' \
      -d "$body" "$BASE_URL$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $key" "$BASE_URL$path"
  fi
}

ledger() { api "$E2E_BUYER_KEY" GET "/api/v1/billing/ledger?limit=${1:-50}"; }
balance_usd() {
  api "$E2E_BUYER_KEY" GET "/api/v1/billing/balance" \
    | jq -r '(.balanceMicroUsd // empty) / 1000000' 2>/dev/null
}

destroy_id() {
  local id="$1" key="${2:-$E2E_BUYER_KEY}"
  "$COMPUTE" sandboxes destroy "$id" --api-key "$key" --base-url "$BASE_URL" --json >/dev/null 2>&1 || true
}

cleanup() {
  echo
  echo "── cleanup (run $RUN_ID) ──"
  # destroy every e2e-<runid> sandbox (buyer + actions orgs)
  for key in "$E2E_BUYER_KEY" "$E2E_ACTIONS_KEY"; do
    ids=$("$COMPUTE" sandboxes list --api-key "$key" --base-url "$BASE_URL" --json 2>/dev/null \
      | jq -r --arg p "e2e-$RUN_ID" '.sandboxes[]? | select(.label|startswith($p)) | .id') || true
    for id in ${ids:-}; do
      echo "destroy $id"; destroy_id "$id" "$key"
    done
  done
  # resume anything this run paused (e.g. B9 interrupted mid-step)
  for a in "${PAUSED_ASKS[@]:-}"; do
    [ -n "$a" ] && { echo "resume $a"; seller market resume "$a" >/dev/null 2>&1 || true; }
  done
  # withdraw every ask this run posted (leave any pre-existing asks alone)
  for a in "${POSTED_ASKS[@]:-}"; do
    [ -n "$a" ] && { echo "withdraw $a"; seller market withdraw "$a" >/dev/null 2>&1 || true; }
  done
  # clear the medium cap if this run set it
  if [ "$CAP_SET" = 1 ]; then
    api "$E2E_BUYER_KEY" PATCH /api/v1/sandboxes/settings '{"marketCaps":{"medium":null}}' >/dev/null
  fi
}
trap cleanup EXIT

START_BALANCE="$(balance_usd || echo '?')"
echo "run id: e2e-$RUN_ID   base: $BASE_URL"
echo "buyer balance at start: \$${START_BALANCE:-unknown}"
echo

# ═══ PART A — API keys ════════════════════════════════════════════════════

if [[ " $PARTS " == *" seller "* ]]; then
echo "══ Seller ══"

# S1 — each key resolves to its org (whoami has no --api-key; the org shows
# in market status for the seller and in quote.topUpPath for buyers).
s_out=$(seller market status --json)
s_name=$(jqget "$s_out" .name)
[ -n "$s_name" ] && pass "S1-seller-key-org ($s_name)" || fail "S1-seller-key-org" "$s_out"
q1=$(buyer sandboxes quote --size medium --json)
tup=$(jqget "$q1" .topUpPath)
[ -n "$tup" ] && pass "S1-buyer-key-org ($tup)" || fail "S1-buyer-key-org" "$q1"
q1a=$(actions sandboxes quote --size medium --json)
tupa=$(jqget "$q1a" .topUpPath)
[ -n "$tupa" ] && pass "S1-actions-key-org ($tupa)" || fail "S1-actions-key-org" "$q1a"

# S2 — credential connect + lanes = sandbox only
if [ -n "${E2E_SELLER_PROVIDER:-}" ]; then
  out=$(seller market credential connect --json 2>&1)
  st=$(seller market status --json)
  lanes=$(jqget "$st" '.useCases | join(",")')
  cred=$(jqget "$st" '.executorCredentialConnected')
  [ "$lanes" = "sandbox" ] && [ "$cred" = "true" ] \
    && pass "S2-credential-connect (lanes=$lanes cred=$cred)" \
    || fail "S2-credential-connect" "lanes=$lanes cred=$cred — $out"
fi

# S3 — three sandbox-lane asks; book lists them labelled sandbox
declare -A ASK_IDS=()
for spec in "small 0.08" "medium 0.12" "large 0.30"; do
  set -- $spec
  out=$(seller market sell --use-case sandbox --capacity 3 --size "$1" --price "$2/hour" --json 2>&1)
  id=$(jqget "$out" '.id // .ask.id // .listing.id // empty')
  [ -n "$id" ] && ASK_IDS[$1]="$id" && POSTED_ASKS+=("$id") \
    && pass "S3-sell-$1@$2" || fail "S3-sell-$1@$2" "$out"
done
book=$(seller market book --use-case sandbox --json 2>&1)
if jq -e --arg p "$E2E_SELLER_PROVIDER" \
  '[.. | objects | select(.provider? == $p)] | length >= 3' <<<"$book" >/dev/null 2>&1; then
  pass "S3-book-sandbox-lane"
else
  fail "S3-book-sandbox-lane" "$book"
fi

# Cheapest live ask rate per platform size, recomputed from the book — fills
# go to the cheapest ask whose resources cover the request, so any extra
# seller capacity (ours or third-party) participates.
requested_res() { case "$1" in small) echo "1 2048";; medium) echo "2 4096";;
  large) echo "4 8192";; xlarge) echo "8 16384";; *) echo "0 0";; esac; }
cheapest() { # cheapest <platform-size> → hourly usd of the best eligible ask
  local size="$1" rc rm
  set -- $(requested_res "$size"); rc=$1; rm=$2
  seller market listings --json 2>/dev/null | jq -r \
    --argjson c "$rc" --argjson m "$rm" '
      [.[]? | select(.live == true and (.resources.cpus // 99) >= $c and (.resources.memoryMb // 999999) >= $m)
       | .usd * (if .per=="second" then 3600 elif .per=="minute" then 60 else 1 end)]
      | if length == 0 then "none" else min end'
}

# S4 — actions lane ask refused
out=$(seller market sell --use-case actions --price 0.12/hour --json 2>&1); rc=$?
if [ $rc -ne 0 ] && grep -qi "market_lane_not_approved" <<<"$out"; then
  pass "S4-actions-lane-rejected"
else
  fail "S4-actions-lane-rejected" "rc=$rc $out"
fi

# S5 — unitless price refused client-side, nothing sent
out=$(seller market sell --price 0.12 --json 2>&1); rc=$?
[ $rc -ne 0 ] && pass "S5-unitless-price" || fail "S5-unitless-price" "rc=$rc $out"
fi

if [[ " $PARTS " == *" buyer "* ]]; then
echo "══ Buyer ══"

# B1 — quote medium: market_cap_required, live = cheapest eligible ask, ref 0.16
EXP_MED=$(cheapest medium)
q=$(buyer sandboxes quote --size medium --json)
reason=$(jqget "$q" .reason); ok=$(jqget "$q" .ok)
live=$(jqget "$q" '.cheapestLiveUsdPerHour // empty'); ref=$(jqget "$q" '.referenceUsdPerHour // empty'); bal=$(jqget "$q" .creditBalanceUsd)
oklive=$(jq -n --arg a "$live" --arg b "$EXP_MED" '($a|tonumber) == ($b|tonumber)' 2>/dev/null)
if [ "$ok" = "false" ] && [ "$reason" = "market_cap_required" ] && [ "$oklive" = "true" ]; then
  pass "B1-quote-cap-required (live=$live ref=$ref bal=$bal)"
else
  fail "B1-quote-cap-required" "live=$live expected=$EXP_MED — $q"
fi

# B2 — create with no max price → market_cap_required (message includes a price)
out=$(buyer sandboxes create --size medium --label "e2e-$RUN_ID-b2" --timeout-ms $TIMEOUT_MS --json 2>&1); rc=$?
if [ $rc -ne 0 ] && grep -qi "market_cap_required" <<<"$out" && grep -q "hour" <<<"$out"; then
  pass "B2-create-cap-required"
else
  fail "B2-create-cap-required" "rc=$rc $out"
fi

# B3 — max price below live ask → limit_not_met
out=$(buyer sandboxes create --size medium --label "e2e-$RUN_ID-b3" --timeout-ms $TIMEOUT_MS --max-price 0.05/hour --json 2>&1); rc=$?
[ $rc -ne 0 ] && grep -qi "limit_not_met" <<<"$out" \
  && pass "B3-limit-not-met" || fail "B3-limit-not-met" "rc=$rc $out"

# B4 — limit create at the live ask price
out=$(buyer sandboxes create --size medium --label "e2e-$RUN_ID-b4" --timeout-ms $TIMEOUT_MS --max-price 0.12/hour --json 2>&1)
b4_id=$(jqget "$out" '.sandbox.id // .id // empty')
if [ -n "$b4_id" ]; then
  CREATED_IDS+=("$b4_id")
  p=$(jqget "$out" '.sandbox.placement // .placement // {}')
  src=$(jqget "$p" .source); sz=$(jqget "$p" .size); ot=$(jqget "$p" .orderType)
  prov=$(jqget "$p" '.box.provider // empty'); rate=$(jqget "$p" '.rate.usd // empty')
  { [ "$src" = "market" ] && [ "$ot" = "limit" ] && [ "$prov" = "$E2E_SELLER_PROVIDER" ]; } \
    && pass "B4-placement (source=$src size=$sz orderType=$ot box=$prov rate=$rate)" \
    || fail "B4-placement" "$p"
  # exec nproc / free -m — the box may still be booting; retry briefly.
  # exec takes CLI options before the command word, so --api-key can't come
  # from the buyer() wrapper.
  np=""; mem=""
  for i in $(seq 1 10); do
    [ -z "$np" ] && np=$("$COMPUTE" sandboxes exec "$b4_id" --api-key "$E2E_BUYER_KEY" --base-url "$BASE_URL" nproc 2>/dev/null | grep -oE '[0-9]+' | head -1)
    [ -z "$mem" ] && mem=$("$COMPUTE" sandboxes exec "$b4_id" --api-key "$E2E_BUYER_KEY" --base-url "$BASE_URL" free -m 2>/dev/null | awk '/^Mem:/{print $2}')
    [ -n "$np" ] && [ -n "$mem" ] && break
    sleep 6
  done
  [ -n "$np" ] && [ "$np" -ge 2 ] && pass "B4-nproc ($np)" || fail "B4-nproc" "got: $np"
  [ -n "$mem" ] && [ "$mem" -ge 3800 ] && pass "B4-mem (${mem}MB)" || fail "B4-mem" "got: $mem"
  t0=$(date +%s)
  destroy_id "$b4_id"
  t1=$(date +%s)
  # post-destroy: status, cost, ledger hold-release + debit
  g=$(buyer sandboxes get "$b4_id" --json)
  stt=$(jqget "$g" '.sandbox.status // .status // empty')
  cost=$(jqget "$g" '.sandbox.cost.costUsd // .cost.costUsd // empty')
  { [ "$stt" = "destroyed" ] || [ "$stt" = "stopped" ]; } \
    && pass "B4-destroyed (cost=\$${cost:-?})" || fail "B4-destroyed" "$g"
  led=$(ledger)
  rel=$(jq -r '[.entries[] | select(.kind=="release" or .kind=="debit")] | length' <<<"$led")
  [ "${rel:-0}" -ge 2 ] && pass "B4-ledger-release-debit" || fail "B4-ledger-release-debit" "$led"
else
  fail "B4-create" "$out"
fi

# B5 — market order fills at live rate
out=$(buyer sandboxes create --size medium --label "e2e-$RUN_ID-b5" --timeout-ms $TIMEOUT_MS --market --json 2>&1)
b5_id=$(jqget "$out" '.sandbox.id // .id // empty')
if [ -n "$b5_id" ]; then
  CREATED_IDS+=("$b5_id")
  p=$(jqget "$out" '.sandbox.placement // .placement // {}')
  ot=$(jqget "$p" .orderType); rate=$(jqget "$p" '.rate.usd // empty')
  [ "$ot" = "market" ] && pass "B5-market-order (rate=$rate)" || fail "B5-market-order" "$p"
  destroy_id "$b5_id"
else
  fail "B5-market-order" "$out"
fi

# B6 — sizes: quote live price tracks the cheapest eligible ask per size
for size in small large xlarge; do
  exp=$(cheapest "$size")
  q=$(buyer sandboxes quote --size "$size" --json)
  live=$(jqget "$q" '.cheapestLiveUsdPerHour // empty')
  if [ "$exp" = "none" ]; then
    [ "$(jqget "$q" .reason)" = "no_market_capacity" ] \
      && pass "B6-quote-$size-none" || fail "B6-quote-$size-none" "$q"
  else
    same=$(jq -n --arg a "$live" --arg b "$exp" '($a|tonumber)==($b|tonumber)' 2>/dev/null)
    [ "$same" = "true" ] && pass "B6-quote-$size@$live" || fail "B6-quote-$size" "live=$live expected=$exp — $q"
  fi
done
out=$(buyer sandboxes create --size medium --cpus 2 --label "e2e-$RUN_ID-b6" --timeout-ms $TIMEOUT_MS --json 2>&1); rc=$?
[ $rc -ne 0 ] && pass "B6-size+cpus-400" || fail "B6-size+cpus-400" "rc=$rc $out"

# B7 — unitless --max-price refused client-side
out=$(buyer sandboxes create --size medium --label "e2e-$RUN_ID-b7" --timeout-ms $TIMEOUT_MS --max-price 0.12 --json 2>&1); rc=$?
[ $rc -ne 0 ] && pass "B7-unitless-max-price" || fail "B7-unitless-max-price" "rc=$rc $out"

# B8 — cap medium at 0.15: default create fills; hold sized on cap not flag
api "$E2E_BUYER_KEY" PATCH /api/v1/sandboxes/settings '{"marketCaps":{"medium":{"usd":0.15,"per":"hour"}}}' >/dev/null
CAP_SET=1
out=$(buyer sandboxes create --size medium --label "e2e-$RUN_ID-b8a" --timeout-ms $TIMEOUT_MS --json 2>&1)
b8a=$(jqget "$out" '.sandbox.id // .id // empty')
[ -n "$b8a" ] && CREATED_IDS+=("$b8a") && pass "B8-create-default-cap" || fail "B8-create-default-cap" "$out"
exp8=$(cheapest medium)
out=$(buyer sandboxes create --size medium --label "e2e-$RUN_ID-b8b" --timeout-ms $TIMEOUT_MS --max-price 1/hour --json 2>&1)
b8b=$(jqget "$out" '.sandbox.id // .id // empty')
if [ -n "$b8b" ]; then
  CREATED_IDS+=("$b8b")
  rate=$(jqget "$out" '.sandbox.placement.rate.usd // .placement.rate.usd // empty')
  per=$(jqget "$out" '.sandbox.placement.rate.per // .placement.rate.per // empty')
  hourly=$(jq -n --arg r "${rate:-0}" --arg p "${per:-hour}" '($r|tonumber) * (if $p=="second" then 3600 elif $p=="minute" then 60 else 1 end)')
  # a limit fill must land on one of the eligible asks' prices — the cheapest
  # may be occupied (asks carry capacity), so exact-cheapest can't be assumed
  eligible=$(seller market listings --json | jq -r '
    [.[]? | select(.live == true and (.resources.cpus // 99) >= 2 and (.resources.memoryMb // 999999) >= 4096)
     | .usd * (if .per=="second" then 3600 elif .per=="minute" then 60 else 1 end)] | @json')
  same=$(jq -n --arg a "$hourly" --argjson e "$eligible" '$e | map(. - ($a|tonumber) | fabs < 0.001) | any' 2>/dev/null)
  [ "$same" = "true" ] && pass "B8-max1-fills-at-ask (rate=$rate/$per)" || fail "B8-max1-fills-at-ask" "rate=$rate/$per eligible=$eligible"
  # hold sized on 0.15/hr not 1/hr — find this sandbox's open hold in the ledger
  sleep 2
  hold=$(ledger | jq -r --arg t "$b8b" '
    [.entries[] | select(.kind=="hold")] | .[0].microUsd // empty')
  # 0.15/hr * 600s = 0.025 → 25000 micro-USD; 1/hr would be ~166667
  if [ -n "$hold" ] && [ "$hold" -lt 100000 ]; then
    pass "B8-hold-on-cap ($hold µUSD)"
  else
    fail "B8-hold-on-cap" "hold=$hold"
  fi
else
  fail "B8-create-max1" "$out"
fi
[ -n "$b8a" ] && destroy_id "$b8a"
[ -n "$b8b" ] && destroy_id "$b8b"
# clear the cap now — B9/B10 assume the hold comes from --max-price alone
api "$E2E_BUYER_KEY" PATCH /api/v1/sandboxes/settings '{"marketCaps":{"medium":null}}' >/dev/null
CAP_SET=0

# B9 — with only a 0.60/hr ask eligible, a market order must refuse
# (above the ~3× ref 0.16 protection limit) while an explicit limit fills.
# Repricing stages a pendingUsd that lands at rollover, so we pause every
# medium-eligible ask and post a temporary 0.60 ask instead.
PAUSED_IDS=$(seller market listings --json 2>/dev/null | jq -r '
  .[]? | select(.live == true and (.resources.cpus // 99) >= 2 and (.resources.memoryMb // 999999) >= 4096) | .id')
for a in $PAUSED_IDS; do seller market pause "$a" >/dev/null 2>&1 && PAUSED_ASKS+=("$a"); done
out=$(seller market sell --use-case sandbox --capacity 1 --size medium --price 0.60/hour --json 2>&1)
b9_ask=$(jqget "$out" '.id // .ask.id // .listing.id // empty')
[ -n "$b9_ask" ] && POSTED_ASKS+=("$b9_ask")
out=$(buyer sandboxes create --size medium --label "e2e-$RUN_ID-b9a" --timeout-ms $TIMEOUT_MS --market --json 2>&1); rc=$?
[ $rc -ne 0 ] && grep -qi "above_protection_limit" <<<"$out" \
  && pass "B9-protection-limit" || fail "B9-protection-limit" "rc=$rc $out"
out=$(buyer sandboxes create --size medium --label "e2e-$RUN_ID-b9b" --timeout-ms $TIMEOUT_MS --max-price 0.60/hour --json 2>&1)
b9=$(jqget "$out" '.sandbox.id // .id // empty')
[ -n "$b9" ] && CREATED_IDS+=("$b9") && destroy_id "$b9" && pass "B9-limit-0.60" || fail "B9-limit-0.60" "$out"
[ -n "$b9_ask" ] && seller market withdraw "$b9_ask" >/dev/null 2>&1
for a in "${PAUSED_ASKS[@]:-}"; do seller market resume "$a" >/dev/null 2>&1; done
PAUSED_ASKS=()

# B10 — hold = --max-price × timeout > balance → insufficient_credits + top-up path
# (cap cleared above, so the hold is 5/hr × 6h = $30 >> $5)
out=$(buyer sandboxes create --size medium --label "e2e-$RUN_ID-b10" --timeout-ms 21600000 --max-price 5/hour --json 2>&1); rc=$?
{ [ $rc -ne 0 ] && grep -qi "insufficient_credits" <<<"$out" && grep -qi "market\|top.up\|billing" <<<"$out"; } \
  && pass "B10-insufficient-credits" || fail "B10-insufficient-credits" "rc=$rc $out"

# B11 — ledger: grant + this run's holds/releases/debits
led=$(ledger 100)
grant=$(jqget "$led" '[.entries[] | select(.kind=="grant")] | length')
holds=$(jqget "$led" '[.entries[] | select(.kind=="hold" or .kind=="release" or .kind=="debit")] | length')
{ [ "${grant:-0}" -ge 1 ] && [ "${holds:-0}" -ge 3 ]; } \
  && pass "B11-ledger (grants=$grant market-entries=$holds)" || fail "B11-ledger" "$led"
fi

if [[ " $PARTS " == *" actions "* ]]; then
echo "══ Actions-only org ══"

# A1 — sandbox lane is not this org's lane
q=$(actions sandboxes quote --size medium --json)
[ "$(jqget "$q" .reason)" = "market_access_required" ] \
  && pass "A1-quote-access-required" || fail "A1-quote-access-required" "$q"
out=$(actions sandboxes create --size medium --label "e2e-$RUN_ID-a1" --timeout-ms $TIMEOUT_MS --json 2>&1); rc=$?
[ $rc -ne 0 ] && grep -qi "market_access_required" <<<"$out" \
  && pass "A1-create-access-required" || fail "A1-create-access-required" "rc=$rc $out"

# A2 — own-key placement (provider key stored via settings beforehand)
out=$(actions sandboxes create --size medium --label "e2e-$RUN_ID-a2" --timeout-ms $TIMEOUT_MS \
        --order "market,$E2E_OWNKEY_PROVIDER" --json 2>&1)
a2_id=$(jqget "$out" '.sandbox.id // .id // empty')
if [ -n "$a2_id" ]; then
  CREATED_IDS+=("$a2_id")
  src=$(jqget "$out" '.sandbox.placement.source // .placement.source // empty')
  [ "$src" = "own-key" ] && pass "A2-own-key-placement" || fail "A2-own-key-placement" "$out"
  "$COMPUTE" sandboxes destroy "$a2_id" --api-key "$E2E_ACTIONS_KEY" --base-url "$BASE_URL" --json >/dev/null 2>&1 || true
else
  fail "A2-own-key-placement" "$out"
fi

# A3 — balance endpoint answers 200 for this org too
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $E2E_ACTIONS_KEY" "$BASE_URL/api/v1/billing/balance")
[ "$code" = "200" ] && pass "A3-balance-200" || fail "A3-balance-200" "HTTP $code"
fi

if [[ " $PARTS " == *" seller "* ]]; then
echo "══ Seller wrap-up ══"
out=$(seller market listings --json 2>&1)
fills=$(jqget "$out" '[.. | objects | select(.fills? != null)] | length')
st=$(seller market status --json)
[ -n "$st" ] && pass "W1-listings-status" || fail "W1-listings-status" "$out"
fi

# ═══ PART B — stored OAuth logins ══════════════════════════════════════════
# Device-flow login is interactive: for each role the script uses the home
# dir in E2E_<ROLE>_HOME (default .e2e/homes/<role>). If that home has no
# stored login yet, `compute login` runs under a pty and you approve the
# device code in your browser.
if [[ " $PARTS " == *" oauth " ]]; then
echo "══ OAuth ══"
HOMES_ROOT="${E2E_HOMES_ROOT:-$(pwd)/.e2e/homes}"

oauth_whoami() { # oauth_whoami <home> → whoami text (no --json/--base-url flags)
  env -u COMPUTE_API_KEY -u BENCHMARKS_PLATFORM_API_KEY -u COMPUTESDK_API_KEY \
    HOME="$1" "$COMPUTE" whoami 2>/dev/null
}
oauth_login() { # oauth_login <home> <role-name>
  local h="$1" role="$2"
  mkdir -p "$h"
  if [ ! -f "$h/.benchsdk/credentials.json" ]; then
    echo "  [$role] no stored login — starting 'compute login' (device flow)."
    echo "  [$role] approve the device code in your browser when the URL appears."
    # `script` differs across platforms: GNU/Linux takes -c <cmd>, macOS takes
    # the command as positional args.
    if [[ "$(uname)" = Darwin ]]; then
      HOME="$h" script -q /dev/null "$COMPUTE" login
    else
      HOME="$h" script -qc "\"$COMPUTE\" login" /dev/null
    fi
  fi
}

for role in buyer seller actions; do
  varname="E2E_$(tr '[:lower:]' '[:upper:]' <<<"$role")_HOME"
  h="${!varname:-$HOMES_ROOT/$role}"
  oauth_login "$h" "$role"
  who=$(oauth_whoami "$h")
  orgline=$(grep -oE 'active org: [a-z0-9-]+' <<<"$who")
  [ -n "$orgline" ] && pass "O1-login-$role ($orgline)" || fail "O1-login-$role" "$who"
  case "$role" in buyer) BH="$h";; seller) SH="$h";; actions) AH="$h";; esac
done

# O2 — buyer sandbox over the stored login (env keys cleared)
out=$(env -u COMPUTE_API_KEY -u BENCHMARKS_PLATFORM_API_KEY -u COMPUTESDK_API_KEY \
  HOME="$BH" "$COMPUTE" sandboxes create --size medium --label "e2e-$RUN_ID-o2" \
  --timeout-ms $TIMEOUT_MS --market --base-url "$BASE_URL" --json 2>&1)
o2=$(jqget "$out" '.sandbox.id // .id // empty')
if [ -n "$o2" ]; then
  CREATED_IDS+=("$o2")
  pass "O2-buyer-create-stored-login ($(jqget "$out" '.placement.orderType // .sandbox.placement.orderType'))"
  destroy_id "$o2" "$E2E_BUYER_KEY"
else
  fail "O2-buyer-create-stored-login" "$out"
fi

# O3 — actions org quote refused over stored login; seller status shows lane
out=$(env -u COMPUTE_API_KEY -u BENCHMARKS_PLATFORM_API_KEY -u COMPUTESDK_API_KEY \
  HOME="$AH" "$COMPUTE" sandboxes quote --size medium --base-url "$BASE_URL" --json 2>&1); rc=$?
{ [ $rc -ne 0 ] || [ "$(jqget "$out" .ok)" = "false" ]; } && grep -qi "market_access_required" <<<"$out" \
  && pass "O3-actions-quote-refused" || fail "O3-actions-quote-refused" "rc=$rc $out"
out=$(env -u COMPUTE_API_KEY -u BENCHMARKS_PLATFORM_API_KEY -u COMPUTESDK_API_KEY \
  HOME="$SH" "$COMPUTE" market status --base-url "$BASE_URL" --json 2>&1)
[ "$(jqget "$out" '.useCases | join(",")')" = "sandbox" ] \
  && pass "O3-seller-lanes-sandbox" || fail "O3-seller-lanes-sandbox" "$out"

# O4 — logout from a throwaway copy of the buyer home, whoami then fails
TMPH=$(mktemp -d)
mkdir -p "$TMPH/.benchsdk"
[ -f "$BH/.benchsdk/credentials.json" ] && cp "$BH/.benchsdk/credentials.json" "$TMPH/.benchsdk/"
env -u COMPUTE_API_KEY -u BENCHMARKS_PLATFORM_API_KEY -u COMPUTESDK_API_KEY \
  HOME="$TMPH" "$COMPUTE" logout >/dev/null 2>&1 || true
who=$(oauth_whoami "$TMPH")
[ -z "$who" ] && pass "O4-logout" || fail "O4-logout" "$who"
rm -rf "$TMPH"
fi

# ═══ summary ═══════════════════════════════════════════════════════════════
echo
echo "══ Summary (run e2e-$RUN_ID) ══"
fails=0
for r in "${RESULTS[@]}"; do
  echo "$r"
  [[ "$r" == FAIL* ]] && fails=$((fails+1))
done
END_BALANCE="$(balance_usd || echo '?')"
echo
echo "buyer balance: start \$${START_BALANCE:-unknown} → end \$${END_BALANCE:-unknown}"
echo "FAILURES: $fails"
exit $((fails>0))
