/**
 * services/calculator.js
 * ======================
 * Orchestrates all domain modules to produce a complete set of results.
 * This is the equivalent of services/radiator_service.py and
 * services/pump_service.py combined — it has no UI knowledge.
 *
 * Entry point: runFullCalculation(inputs) → calcResults object
 */

// ---------------------------------------------------------------------------
//  Pump service  (mirrors services/pump_service.py)
// ---------------------------------------------------------------------------

/**
 * Interpolate pump head [kPa] at a given flow [kg/h].
 */
function interpolatePump(pts, q) {
  if (!pts || !pts.length) return null;
  if (q <= pts[0][0]) return pts[0][1];
  if (q >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    if (q >= pts[i][0] && q <= pts[i + 1][0]) {
      const t = (q - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
    }
  }
  return null;
}

/**
 * Find pump operating point: Q where pump_head_Pa ≈ systemR × Q².
 * Returns flow [kg/h] or null.
 */
function solvePumpOperatingPoint(pumpPts, systemR) {
  let bestQ = null, bestDiff = Infinity;
  for (let q = 0; q <= 3000; q += 5) {
    const pH = interpolatePump(pumpPts, q);
    if (pH === null) continue;
    const pPa = pH * 1000;
    const sPa = systemR * q * q;
    const diff = Math.abs(pPa - sPa);
    if (diff < bestDiff) { bestDiff = diff; bestQ = q; }
    if (pPa < sPa) break; // crossed — operating point found
  }
  return bestQ;
}

// ---------------------------------------------------------------------------
//  Radiator service helpers  (mirrors services/radiator_service.py)
// ---------------------------------------------------------------------------

/**
 * Calculate the weighted average delta-T across all radiators.
 * Mirrors calculate_weighted_delta_t.
 */
function calcWeightedDeltaT(radResults) {
  const totalMFR = radResults.reduce((s, r) => s + r.mfr, 0);
  if (totalMFR <= 0) return 0;
  return radResults.reduce((s, r) => s + r.mfr * (r.supplyT - r.returnT), 0) / totalMFR;
}

/**
 * Compute per-radiator results (thermal + hydraulic).
 *
 * For fixed supply temperature (LT / MODE_FIXED), mirrors Python exactly:
 *   - extraPower per radiator at (supplyT, supplyT−ΔT, tin)
 *   - qRatio = (heatLoss − elec) / (qNom + extraPower)
 *   - Radiator heat_loss = heatLoss + extraPower  →  mfr sized on boosted loss
 *   - Supply locked to fixedSupplyT for every radiator (no max() locking)
 *   - Return temperature and mfr re-derived from adjusted qRatio
 *   - Each radiator gets its own diameter from its own mfr
 *
 * For auto supply (existing / balancing modes):
 *   - qRatio = heatLoss / qNom, supplyT derived from EN 442
 *   - All radiators locked to the highest required supply temperature
 *   - Uniform diameter (worst-case)
 */
function computeRadiatorResults(
  radInputs, lossMap, tinMap,
  fixedSupplyT, deltaT,
  valveCfg, kvMax, nPositions, warnings,
) {
  const kvValveOpen = valveCfg
    ? valveCfg.kv_values[valveCfg.kv_values.length - 1]
    : kvMax;

  if (fixedSupplyT !== null) {
    // ── Fixed supply temperature (LT dimensioning mode) ───────────────────
    // Mirror Python loop exactly — no max-supply locking, no uniform diameter.
    const rows = radInputs.map(r => {
      const baseLoss = lossMap[r.room] || 0;
      const elec     = r.elec || 0;
      const tin      = tinMap[r.room] || 20;
      const qNom     = r.power || 2000;

      // Extra power needed at the fixed supply temp + design return temp
      const returnTDesign = calcReturnTempFixed(fixedSupplyT, deltaT, tin);
      const extraPower    = calcExtraPowerNeeded(qNom, baseLoss, fixedSupplyT, deltaT, tin);

      // qRatio: thermal load net of electric boost / effective radiator capacity
      const thermalLoad = Math.max(baseLoss - elec, 0);
      const qRatio      = (qNom + extraPower) > 0 ? thermalLoad / (qNom + extraPower) : 0;

      // Radiator heat loss boosted by extra power → mfr sized on this
      const boostedLoss = baseLoss + extraPower;

      // Return temperature using adjusted qRatio (algebraically consistent).
      // Clamp to [tin+0.1, supplyT-0.1] — negative ΔT is physically impossible.
      const returnTRaw = calcReturnTemp(fixedSupplyT, qRatio, tin);
      const returnT    = Math.min(returnTRaw, fixedSupplyT - 0.1);
      const mfr        = calcMassFlowRate(boostedLoss, fixedSupplyT, returnT);

      // Per-radiator diameter from its own mfr
      const autoDiam = selectPipeDiam(Math.max(mfr, 0.1));
      const diam     = (r.fixedDiam != null) ? r.fixedDiam : autoDiam;

      if (r.fixedDiam != null && r.fixedDiam < autoDiam) {
        warnings.push(
          `⚠ Radiator ${r.id} (${r.room}): fixed Ø${r.fixedDiam} mm may be undersized ` +
          `for flow ${Math.round(mfr)} kg/h (auto would select Ø${autoDiam} mm)`
        );
      }

      const pipeLoss     = calcPipePressureLoss(r.length, diam, mfr);
      const totalLossRad = calcRadiatorKv(r.length, diam, mfr);
      const valveLoss    = Math.round(
        HYDRAULIC_CONST * Math.pow(Math.max(mfr, 0.001) / 1000 / kvValveOpen, 2) * 10
      ) / 10;

      return {
        id: r.id, room: r.room || '—', collector: r.collector || 'Collector 1',
        heatLoss: baseLoss, qNom,
        qRatio: Math.round(qRatio * 1000) / 1000,
        extraPower,
        supplyT: fixedSupplyT, returnT, mfr,
        diam, diamAuto: autoDiam, diamFixed: r.fixedDiam != null,
        pipeLoss, totalLoss: totalLossRad, valveLoss, length: r.length,
      };
    });
    return rows;

  } else {
    // ── Auto supply temperature (existing / balancing modes) ──────────────
    // Step 1: per-radiator supply temps from qRatio
    const rows = radInputs.map(r => {
      const heatLoss = (lossMap[r.room] || 0) + (r.elec || 0);
      const tin      = tinMap[r.room] || 20;
      const qNom     = r.power || 2000;
      const qRatio   = qNom > 0 ? heatLoss / qNom : 0;
      const supplyT  = calcSupplyTemp(qRatio, deltaT, tin);
      return { r, heatLoss, tin, qNom, qRatio, supplyT };
    });

    // Step 2: lock all to the highest required supply temperature
    const maxSupply = Math.max(...rows.map(x => x.supplyT));

    // Step 3: re-derive returnT, mfr at maxSupply; uniform worst-case diameter
    const resolved = rows.map(x => {
      const { r, heatLoss, tin, qNom, qRatio } = x;
      const returnT  = calcReturnTemp(maxSupply, qRatio, tin);
      const mfr      = calcMassFlowRate(heatLoss, maxSupply, returnT);
      return { r, heatLoss, tin, qNom, qRatio, supplyT: maxSupply, returnT, mfr };
    });

    const uniformDiam = Math.max(
      ...resolved.map(x => selectPipeDiam(Math.max(x.mfr, 0.1)))
    );

    return resolved.map(x => {
      const { r, heatLoss, tin, qNom, qRatio, supplyT, returnT, mfr } = x;
      const autoDiam = uniformDiam;
      const diam     = (r.fixedDiam != null) ? r.fixedDiam : uniformDiam;

      if (r.fixedDiam != null && r.fixedDiam < autoDiam) {
        warnings.push(
          `⚠ Radiator ${r.id} (${r.room}): fixed Ø${r.fixedDiam} mm may be undersized ` +
          `for flow ${Math.round(mfr)} kg/h (auto would select Ø${autoDiam} mm)`
        );
      }

      const pipeLoss     = calcPipePressureLoss(r.length, diam, mfr);
      const totalLossRad = calcRadiatorKv(r.length, diam, mfr);
      const valveLoss    = Math.round(
        HYDRAULIC_CONST * Math.pow(Math.max(mfr, 0.001) / 1000 / kvValveOpen, 2) * 10
      ) / 10;

      return {
        id: r.id, room: r.room || '—', collector: r.collector || 'Collector 1',
        heatLoss, qNom,
        qRatio: Math.round(qRatio * 1000) / 1000,
        extraPower: 0,
        supplyT, returnT, mfr,
        diam, diamAuto: autoDiam, diamFixed: r.fixedDiam != null,
        pipeLoss, totalLoss: totalLossRad, valveLoss, length: r.length,
      };
    });
  }
}

/**
 * Compute per-collector results.
 * Mirrors load_collector_data / Collector.calculate_total_pressure_loss.
 */
function computeCollectorResults(collectorData, radResults) {
  return collectorData.map(col => {
    const radInCol = radResults.filter(r => r.collector === col.name);
    const totalMFR = radInCol.reduce((s, r) => s + r.mfr, 0);
    const diam     = selectPipeDiam(Math.max(totalMFR, 0.1));
    const colLoss  = Math.round(
      HYDRAULIC_CONST * Math.pow(Math.max(totalMFR, 0.001) / 1000 / KV_COLLECTOR, 2) * 10
    ) / 10;
    const pipeLoss = calcPipePressureLoss(col.length, diam, totalMFR);
    return { name: col.name, mfr: totalMFR, diam, pipeLoss, colLoss, totalLoss: pipeLoss + colLoss };
  });
}

/**
 * Build daisy-chain total pressure losses per radiator circuit.
 * Returns max system pressure [Pa].
 */
function buildTotalPressures(radResults, colResults) {
  const colNames   = colResults.map(c => c.name).sort();
  const colLossMap = {};
  colResults.forEach(c => (colLossMap[c.name] = c.totalLoss));

  radResults.forEach(r => {
    const idx = colNames.indexOf(r.collector);
    let downstream = 0;
    for (let i = Math.max(idx, 0); i < colNames.length; i++)
      downstream += colLossMap[colNames[i]] || 0;
    r.totalCircuitLoss = Math.round((r.totalLoss + downstream + PRESSURE_BOILER) * 10) / 10;
  });

  return radResults.length ? Math.max(...radResults.map(r => r.totalCircuitLoss)) : 0;
}

// ---------------------------------------------------------------------------
//  Pump-based mode solver
// ---------------------------------------------------------------------------

/**
 * Iterate supply temperature until pump operating point is consistent
 * with the system hydraulics.  Mirrors pump-based mode in app logic.
 */
function solvePumpMode(
  pumpPts, deltaT, radInputs, lossMap, tinMap,
  valveCfg, kvMax, nPositions, warnings,
) {
  let supplyT   = 55;
  let converged = false;
  let radResults = [];

  for (let iter = 0; iter < 40; iter++) {
    radResults = computeRadiatorResults(
      radInputs, lossMap, tinMap,
      supplyT, deltaT,
      valveCfg, kvMax, nPositions, warnings,
    );
    const colResults = computeCollectorResults(state.collectorData, radResults);
    const maxP       = buildTotalPressures(radResults, colResults);
    const totalMFR   = radResults.reduce((s, r) => s + r.mfr, 0);
    const systemR    = totalMFR > 0 ? maxP / (totalMFR * totalMFR) : 0;
    const opQ        = solvePumpOperatingPoint(pumpPts, systemR);
    if (opQ === null) break;

    const totalHL   = radResults.reduce((s, r) => s + r.heatLoss, 0);
    const newDT     = totalHL / ((opQ / 3600) * 4180);
    const newSupplyT = Math.round((20 + newDT / 2 + deltaT / 2) * 10) / 10;
    if (Math.abs(newSupplyT - supplyT) < 0.1) { converged = true; break; }
    supplyT = 0.4 * supplyT + 0.6 * newSupplyT;
  }

  if (!converged)
    warnings.push('Pump-mode iteration did not fully converge — results are approximate.');

  return { radResults, supplyT };
}

// ---------------------------------------------------------------------------
//  Main calculation entry point
// ---------------------------------------------------------------------------

/**
 * Run the full heating design calculation.
 *
 * @param {object} inputs - All UI inputs collected by ui/hydraulics.js
 * @returns {object}      - calcResults stored in state.calcResults
 */
function runFullCalculation(inputs) {
  const {
    deltaT, fixedSupplyT,
    valveCfg, kvMax, nPositions,
    pumpCurvePoints, valveType,
    lossMap, tinMap,
  } = inputs;

  const warnings = [];
  let radResults;

  if (state.designMode === MODE_PUMP && pumpCurvePoints.length) {
    const solved = solvePumpMode(
      pumpCurvePoints, deltaT,
      state.radiatorData, lossMap, tinMap,
      valveCfg, kvMax, nPositions, warnings,
    );
    radResults = solved.radResults;
    warnings.push(`Pump mode converged → supply T ≈ ${solved.supplyT} °C`);
  } else {
    radResults = computeRadiatorResults(
      state.radiatorData, lossMap, tinMap,
      fixedSupplyT, deltaT,
      valveCfg, kvMax, nPositions, warnings,
    );
  }

  const colResults  = computeCollectorResults(state.collectorData, radResults);
  const maxPressure = buildTotalPressures(radResults, colResults);

  computeValvePositions(radResults, valveCfg, kvMax, nPositions);

  const { warnings: velWarnings } = checkVelocities(radResults, colResults);
  warnings.push(...velWarnings);

  const totalMFR   = radResults.reduce((s, r) => s + r.mfr, 0);
  const weightedDT = calcWeightedDeltaT(radResults);

  return {
    radResults, colResults, warnings,
    weightedDT, totalMFR, maxPressure,
    pumpCurvePoints, valveType, valveCfg,
    fixedSupplyT, deltaT, kvMax, nPositions,
  };
}
