/**
 * domain/valve.js
 * ===============
 * Thermostatic radiator valve (TRV) sizing model.
 * Maps required kv to a discrete valve position for both catalogue
 * valves and the custom linear model.
 *
 * Mirrors: domain/valve.py  (Valve class)
 * Zero UI dependencies — pure calculation functions only.
 */

/**
 * Get the kv [m³/h] at a given 1-based position for a valve.
 *
 * @param {object|null} valveCfg    - Entry from VALVE_CATALOGUE, or null for custom
 * @param {number}      kvMax       - Max kv for custom valve
 * @param {number}      nPositions  - Number of positions for custom valve
 * @param {number}      position    - 1-based valve position
 * @returns {number} kv [m³/h]
 */
function kvAtPosition(valveCfg, kvMax, nPositions, position) {
  if (valveCfg) {
    const idx = Math.min(Math.max(position - 1, 0), valveCfg.kv_values.length - 1);
    return valveCfg.kv_values[idx];
  }
  // Custom linear model
  const n   = Math.max(nPositions - 1, 1);
  const pos = Math.min(Math.max(position - 1, 0), n);
  return (pos / n) * kvMax;
}

/**
 * Pressure loss across a valve at a given mass flow [Pa].
 * Uses the fully-open kv.
 *
 * @param {object|null} valveCfg - Catalogue entry or null
 * @param {number}      kvMax    - Max kv for custom valve
 * @param {number}      mfr      - Mass flow rate [kg/h]
 */
function calcValvePressureLoss(valveCfg, kvMax, mfr) {
  const kv = valveCfg
    ? valveCfg.kv_values[valveCfg.kv_values.length - 1]
    : kvMax;
  if (kv <= 0) return Infinity;
  return Math.round(HYDRAULIC_CONST * Math.pow(mfr / 1000 / kv, 2) * 10) / 10;
}

/**
 * Compute the required kv to balance each circuit against the most
 * restrictive one, then look up the corresponding valve position.
 * Mutates each row's valvePos and kvNeeded in-place.
 *
 * Mirrors domain/valve.py Valve.calculate_kv_position_valve.
 *
 * @param {Array}       radResults   - Array of radiator result objects
 * @param {object|null} valveCfg     - Catalogue entry or null
 * @param {number}      kvMax        - Max kv for custom valve
 * @param {number}      nPositions   - Number of positions for custom valve
 */
function computeValvePositions(radResults, valveCfg, kvMax, nPositions) {
  const maxPressure = Math.max(...radResults.map(r => r.totalCircuitLoss + r.valveLoss));

  radResults.forEach(r => {
    const pressureDiff = maxPressure - r.totalCircuitLoss;

    let kvNeeded;
    if (pressureDiff > 1) {
      kvNeeded = (r.mfr / 1000) / Math.pow(pressureDiff / 100000, 0.5);
    } else {
      kvNeeded = valveCfg
        ? valveCfg.kv_values[valveCfg.kv_values.length - 1]
        : kvMax;
    }

    let valvePos;
    if (valveCfg) {
      valvePos = valveCfg.kv_values.findIndex(kv => kv >= kvNeeded);
      if (valvePos < 0) valvePos = valveCfg.kv_values.length - 1;
    } else {
      const ratio = Math.min(Math.sqrt(Math.max(kvNeeded, 0) / kvMax), 1);
      valvePos    = Math.ceil(ratio * (nPositions - 1));
    }

    r.valvePos = Math.max(0, valvePos);
    r.kvNeeded = Math.round(kvNeeded * 1000) / 1000;
  });
}
