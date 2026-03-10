/**
 * domain/valve.js
 * ===============
 * TRV sizing model — maps required kv to a discrete valve position.
 * Mirrors: domain/valve_override.py  (ValveOverride)
 */

// ---------------------------------------------------------------------------
//  kv at a given position
// ---------------------------------------------------------------------------

/**
 * kv [m³/h] at a given discrete position (0-based index, matching Python).
 * Catalogue: index directly into kv_values array.
 * Custom:    linear interpolation across n positions.
 */
function kvAtPosition(valveCfg, kvMax, nPositions, position) {
  if (valveCfg) {
    const idx = Math.min(Math.max(position, 0), valveCfg.kv_values.length - 1);
    return valveCfg.kv_values[idx];
  }
  // Custom: position is 1-based from ceil(), map to [0, kvMax]
  const n = Math.max(nPositions, 1);
  const pos = Math.min(Math.max(position, 0), n);
  return (pos / n) * kvMax;
}

// ---------------------------------------------------------------------------
//  Valve pressure loss at fully-open position  ("Valve pressure loss N")
// ---------------------------------------------------------------------------

/**
 * Pressure loss across the fully-open valve [Pa].
 * Mirrors: ValveOverride.calculate_pressure_valve_kv
 *
 * Uses the last kv_value for catalogue valves, or kv_max for custom.
 */
function calcValvePressureLossN(valveCfg, kvMax, mfr) {
  const kv = valveCfg
    ? valveCfg.kv_values[valveCfg.kv_values.length - 1]
    : kvMax;
  if (kv <= 0) return Infinity;
  return Math.round(HYDRAULIC_CONST * Math.pow(mfr / 1000 / kv, 2) * 10) / 10;
}

// ---------------------------------------------------------------------------
//  Main: compute kv_needed, pressure columns, and valve position
//  Mirrors: ValveOverride._calc_kv_needed + calculate_kv_position_valve
// ---------------------------------------------------------------------------

/**
 * Adds to each row (mutates in-place):
 *   valvePressureLossN        - pressure loss at fully-open valve [Pa]
 *   totalPressureValveCircuit - totalPressureLoss + valvePressureLossN [Pa]
 *   pressureDifferenceValve   - max(totalPressureValveCircuit) - totalPressureLoss [Pa]
 *   kvNeeded                  - required kv to balance the circuit [m³/h]
 *   valvePos                  - selected discrete valve position
 *   valveKv                   - actual kv at that position (catalogue only)
 *
 * @param {Array}       radResults  - Radiator result rows (must already have totalPressureLoss)
 * @param {object|null} valveCfg    - Catalogue entry or null for custom
 * @param {number}      kvMax       - Custom valve max kv [m³/h]
 * @param {number}      nPositions  - Number of discrete positions (custom valve)
 */
function computeValvePositions(radResults, valveCfg, kvMax, nPositions) {
  // Step 1 - "Valve pressure loss N" (fully-open, per row)
  radResults.forEach(r => {
    r.valvePressureLossN = calcValvePressureLossN(valveCfg, kvMax, r.mfr);
  });

  // Step 2 - "Total pressure valve circuit" = totalPressureLoss + valvePressureLossN
  radResults.forEach(r => {
    r.totalPressureValveCircuit = Math.round(
      (r.totalPressureLoss + r.valvePressureLossN) * 10
    ) / 10;
  });

  // Step 3 - max of totalPressureValveCircuit across all circuits
  const maxP = Math.max(...radResults.map(r => r.totalPressureValveCircuit));

  // Step 4 - "Pressure difference valve" = maxP - totalPressureLoss  (not - totalPressureValveCircuit)
  radResults.forEach(r => {
    r.pressureDifferenceValve = Math.round(
      (maxP - r.totalPressureLoss) * 10
    ) / 10;
  });

  // Step 5 - kv_needed
  radResults.forEach(r => {
    const dP = Math.max(r.pressureDifferenceValve, 1e-9); // clip to avoid div/0
    r.kvNeeded = Math.round(
      (r.mfr / 1000) / Math.pow(dP / 100_000, 0.5) * 1000
    ) / 1000;
  });

  // Step 6 - valve position lookup
  if (valveCfg) {
    // Catalogue: find first index where kv_values[i] >= kvNeeded (0-based)
    const kvValues = valveCfg.kv_values;
    radResults.forEach(r => {
      let pos = kvValues.findIndex(kv => kv >= r.kvNeeded);
      if (pos < 0) pos = kvValues.length - 1; // fully open if still not enough
      r.valvePos = pos;        // 0-based index (matches Python)
      r.valveKv  = kvValues[pos];
    });
  } else {
    // Custom: mirrors _adjust_position_custom
    radResults.forEach(r => {
      const ratioKv  = Math.min(Math.max(r.kvNeeded / kvMax, 0), 1);
      const ratioPos = Math.min(Math.sqrt(ratioKv), 1);
      r.valvePos = Math.ceil(ratioPos * nPositions); // 1-based result
      r.valveKv  = null;
    });
  }
}