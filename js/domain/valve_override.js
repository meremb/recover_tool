/**
 * domain/valve_override.js
 * ========================
 * Hydraulic network re-solver for valve-position overrides.
 *
 * Physics
 * -------
 * Each radiator circuit: ΔP = R_total · ṁ²
 * where R_total = R_pipe + R_valve + R_radiator_body
 *
 * All circuits share the same available ΔP_sys.
 * Solver iterates:
 *   1. kv at each effective position → R_valve
 *   2. Guess ΔP_sys → solve all ṁ → recompute collector flows
 *   3. New ΔP_sys = max(R_total × ṁ² + upstream_losses + boiler)
 *   4. Repeat until convergence (≤60 iterations)
 *
 * Mirrors: domain/valve_override.py  (recalculate_with_overrides)
 * Zero UI dependencies — pure calculation functions only.
 */

/**
 * Re-solve the full hydraulic network after user valve-position overrides.
 *
 * @param {Array}       radResults    - Current radiator result objects (not mutated)
 * @param {Array}       colResults    - Current collector result objects (not mutated)
 * @param {object}      overrides     - { radiatorId: valvePosition (1-based) }
 * @param {object|null} valveCfg      - Valve catalogue entry or null (custom)
 * @param {number}      kvMax         - Max kv for custom valve
 * @param {number}      nPositions    - Number of positions for custom valve
 * @param {number}      deltaT        - System design ΔT [K]
 * @param {number|null} fixedSupplyT  - Fixed supply temperature or null
 * @param {object}      tinMap        - { 'Room N': temperature [°C] }
 * @param {Array}       collectorData - state.collectorData for circuit lengths
 * @returns {{ rad, col, logs }}
 */
function solveNetwork(
  radResults, colResults,
  overrides,
  valveCfg, kvMax, nPositions,
  deltaT, fixedSupplyT, tinMap,
  collectorData,
) {
  const logs = [];

  // Deep-copy inputs so originals are not mutated
  const rad = radResults.map(r => ({ ...r }));
  const col = colResults.map(c => ({ ...c }));

  const colNames = col.map(c => c.name).sort();

  // Build per-collector pipe resistance using circuit lengths from state
  const colR = {};
  col.forEach(c => {
    const src   = collectorData.find(s => s.name === c.name);
    const len   = src ? src.length : 5;
    colR[c.name] = pipeResistance(len, c.diam);
  });

  // Per-radiator: resolve effective valve position, then resistance coefficients
  rad.forEach(r => {
    const pos    = overrides[r.id] !== undefined
                   ? overrides[r.id]
                   : (r.valvePos + 1); // stored as 0-based index → convert to 1-based
    r._kv        = kvAtPosition(valveCfg, kvMax, nPositions, pos);
    r._Rpipe     = pipeResistance(r.length, r.diam);
    r._Rvalve    = valveResistance(r._kv);
    r._Rtotal    = r._Rpipe + r._Rvalve + R_RAD_BODY;
  });

  // Initial ΔP_sys guess from previous calc
  let dpSys  = Math.max(...rad.map(r => (r.totalCircuitLoss || 0) + (r.valveLoss || 0)), 500);
  let flows  = rad.map(r => r.mfr);

  // -----------------------------------------------------------------------
  //  Iterative solver
  // -----------------------------------------------------------------------
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {

    // 1. Collector flows
    const colFlows = {};
    colNames.forEach(n => (colFlows[n] = 0));
    rad.forEach((r, i) => {
      if (colFlows[r.collector] !== undefined) colFlows[r.collector] += flows[i];
    });

    // 2. Collector pressure drops: ΔP = (R_pipe + R_collector_body) × ṁ²
    const colDP = {};
    colNames.forEach(n => {
      const m    = colFlows[n] || 0;
      const Rcol = valveResistance(KV_COLLECTOR);
      colDP[n]   = (colR[n] || 0 + Rcol) * m * m;
    });

    // 3. Cumulative downstream DP per radiator (daisy-chain topology)
    const dpUpstream = rad.map(r => {
      const idx = colNames.indexOf(r.collector);
      if (idx < 0) return 0;
      let s = 0;
      for (let i = idx; i < colNames.length; i++) s += colDP[colNames[i]] || 0;
      return s;
    });

    // 4. Available DP and new flows
    const newFlows = rad.map((r, i) => {
      const dpAvail = Math.max(dpSys - dpUpstream[i] - PRESSURE_BOILER, 0);
      return Math.max(Math.sqrt(dpAvail / r._Rtotal), MIN_FLOW);
    });

    // 5. New system pressure (most restrictive circuit sets ΔP_sys)
    const circTotDP = rad.map((r, i) =>
      r._Rtotal * newFlows[i] * newFlows[i] + dpUpstream[i] + PRESSURE_BOILER
    );
    const newDpSys = Math.max(...circTotDP);

    // 6. Convergence check
    const flowDiff = newFlows.reduce((s, f, i) => s + Math.abs(f - flows[i]), 0);
    flows  = newFlows;
    const prevDp = dpSys;
    dpSys  = newDpSys;

    if (Math.abs(newDpSys - prevDp) < TOLERANCE_PA && flowDiff < 0.01) {
      logs.push(`Converged in ${iter + 1} iterations. ΔP_sys = ${dpSys.toFixed(0)} Pa`);
      break;
    }
    if (iter === MAX_ITERATIONS - 1) {
      logs.push(`Warning: did not converge after ${MAX_ITERATIONS} iterations. ` +
                `ΔP_sys = ${dpSys.toFixed(0)} Pa — results are approximate.`);
    }
  }

  // Write converged flows back
  rad.forEach((r, i) => { r.mfr = Math.round(flows[i] * 10) / 10; });

  // Re-calculate thermal quantities with new flows (EN 442 LMTD iteration)
  recalcTemperaturesEN442(rad, deltaT, fixedSupplyT, tinMap);

  // Re-calculate pressure losses with new flows
  rad.forEach(r => {
    r.pipeLoss  = Math.round((r._Rpipe + R_RAD_BODY) * r.mfr * r.mfr * 10) / 10;
    r.valveLoss = Math.round(r._Rvalve * r.mfr * r.mfr * 10) / 10;
  });

  // Rebuild collector results with new flows
  const finalColFlows = {};
  colNames.forEach(n => (finalColFlows[n] = 0));
  rad.forEach(r => {
    if (finalColFlows[r.collector] !== undefined) finalColFlows[r.collector] += r.mfr;
  });

  col.forEach((c, i) => {
    const m      = finalColFlows[c.name] || 0;
    const Rcol   = valveResistance(KV_COLLECTOR);
    c.mfr        = Math.round(m * 10) / 10;
    c.colLoss    = Math.round((colR[c.name] + Rcol) * m * m * 10) / 10;
    c.totalLoss  = c.pipeLoss + c.colLoss;
  });

  // Rebuild daisy-chain total pressures
  const colLossMap = {};
  col.forEach(c => (colLossMap[c.name] = c.totalLoss));
  rad.forEach(r => {
    const idx = colNames.indexOf(r.collector);
    let downstream = 0;
    for (let i = Math.max(idx, 0); i < colNames.length; i++)
      downstream += colLossMap[colNames[i]] || 0;
    r.totalCircuitLoss = Math.round((r.pipeLoss + r.valveLoss + downstream + PRESSURE_BOILER) * 10) / 10;
  });

  // Record effective positions and kv values
  rad.forEach(r => {
    const effPos   = overrides[r.id] !== undefined ? overrides[r.id] : (r.valvePos + 1);
    r.valvePos     = effPos - 1; // back to 0-based
    r.valveKv      = Math.round(r._kv * 1000) / 1000;
  });

  return { rad, col, logs };
}
