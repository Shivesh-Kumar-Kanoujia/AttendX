/**
 * Tests for core attendance math functions.
 * Run with: node --experimental-vm-modules node_modules/.bin/vitest run
 * Or: npx vitest run
 */

// ── Core math functions (mirrors script.js) ──────────────────
function currentPercent(attended, total) {
  if (total <= 0) return 0;
  return (attended * 100) / total;
}

function maxBunkable(attended, total, required) {
  if (required <= 0) return Infinity;
  const x = Math.floor((attended * 100) / required - total);
  return x > 0 ? x : 0;
}

function minAttendRequired(attended, total, required) {
  if (required <= 0) return 0;
  if (required >= 100) return Infinity;
  const cur = currentPercent(attended, total);
  if (cur >= required) return 0;
  const numerator = (required * total) / 100 - attended;
  const denom = 1 - required / 100;
  if (denom <= 0) return Infinity;
  const y = Math.ceil(numerator / denom);
  return y > 0 ? y : 0;
}

function getStatus(pct, required) {
  if (pct >= required) return "safe";
  if (pct >= required - 5) return "warn";
  return "danger";
}

// ── Tests ────────────────────────────────────────────────────

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEqual(actual, expected, msg) {
  if (Math.abs(actual - expected) > 0.001) {
    throw new Error(`${msg || ""} Expected ${expected}, got ${actual}`);
  }
}

function assertStrictEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || ""} Expected "${expected}", got "${actual}"`);
  }
}

// ── currentPercent tests ─────────────────────────────────────
function testCurrentPercent() {
  assertEqual(currentPercent(45, 60), 75, "45/60 = 75%");
  assertEqual(currentPercent(0, 0), 0, "0/0 = 0%");
  assertEqual(currentPercent(30, 30), 100, "30/30 = 100%");
  assertEqual(currentPercent(0, 50), 0, "0/50 = 0%");
  assertEqual(currentPercent(25, 40), 62.5, "25/40 = 62.5%");
  console.log("  ✓ currentPercent — all passed");
}

// ── maxBunkable tests ────────────────────────────────────────
function testMaxBunkable() {
  assertEqual(maxBunkable(45, 60, 75), 0, "45/60 @ 75% = 0 (already at limit)");
  assertEqual(maxBunkable(57, 60, 75), 16, "57/60 @ 75% = 16 (16 classes buffer)");
  assertEqual(maxBunkable(30, 60, 75), 0, "30/60 @ 75% = 0 (below target)");
  assertEqual(maxBunkable(60, 60, 75), 20, "60/60 @ 75% = 20");
  assertEqual(maxBunkable(0, 0, 75), 0, "0/0 = 0");
  assertEqual(maxBunkable(10, 10, 0), Infinity, "10/10 @ 0% = Infinity (no requirement)");
  console.log("  ✓ maxBunkable — all passed");
}

// ── minAttendRequired tests ──────────────────────────────────
function testMinAttendRequired() {
  assertEqual(minAttendRequired(30, 60, 75), 60, "30/60 @ 75% = 60 (60 more needed)");
  assertEqual(minAttendRequired(45, 60, 75), 0, "45/60 @ 75% = 0 (already above)");
  assertEqual(minAttendRequired(0, 50, 50), 50, "0/50 @ 50% = 50 (need all remaining)");
  assertEqual(minAttendRequired(0, 10, 50), 10, "0/10 @ 50% = 10");
  assertEqual(minAttendRequired(90, 100, 90), 0, "90/100 @ 90% = 0 (exactly at target)");
  assertEqual(minAttendRequired(0, 0, 75), 0, "0/0 @ 75% = 0");
  assertEqual(minAttendRequired(5, 5, 100), Infinity, "5/5 @ 100% = Infinity (can't exceed 100%)");
  console.log("  ✓ minAttendRequired — all passed");
}

// ── getStatus tests ──────────────────────────────────────────
function testGetStatus() {
  assertStrictEqual(getStatus(80, 75), "safe", "80% ≥ 75% = safe");
  assertStrictEqual(getStatus(75, 75), "safe", "75% ≥ 75% = safe");
  assertStrictEqual(getStatus(72, 75), "warn", "72% in [70,75) = warn");
  assertStrictEqual(getStatus(70, 75), "warn", "70% in [70,75) = warn");
  assertStrictEqual(getStatus(69, 75), "danger", "69% < 70 = danger");
  assertStrictEqual(getStatus(0, 75), "danger", "0% < 70 = danger");
  console.log("  ✓ getStatus — all passed");
}

// ── Run all ──────────────────────────────────────────────────
console.log("\n📐 Math Tests\n");
testCurrentPercent();
testMaxBunkable();
testMinAttendRequired();
testGetStatus();
console.log("\n✅ All math tests passed!\n");
