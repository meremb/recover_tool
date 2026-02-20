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
 * Compute per-radiator results (thermal + pipe diameter + valve pressure).
 * Mirrors calculate_radiator_data_with_extra_power.
 */
function computeRadiatorResults(
  radInputs, lossMap, tinMap,
  fixedSupplyT, deltaT, fixedDiamVal,
  valveCfg, kvMax, nPositions, warnings,
) {
  const kvValveOpen = valveCfg
    ? valveCfg.kv_values[valveCfg.kv_values.length - 1]
    : kvMax;

  return radInputs.map(r => {
    const heatLoss = (lossMap[r.room] || 0) + (r.elec || 0);
    const tin      = tinMap[r.room] || 20;
    const qNom     = r.power || 2000;
    const qRatio   = qNom > 0 ? heatLoss / qNom : 0;

    let supplyT;
    if (fixedSupplyT !== null) {
      supplyT = fixedSupplyT;
    } else {
      supplyT = calcSupplyTemp(qRatio, deltaT, tin);
    }
    const returnT  = calcReturnTemp(supplyT, qRatio, tin);
    const mfr      = calcMassFlowRate(heatLoss, supplyT, returnT);
    const diam     = fixedDiamVal || selectPipeDiam(Math.max(mfr, 0.1));
    const pipeLoss = calcPipePressureLoss(r.length, diam, mfr);
    const totalLossRad = calcRadiatorKv(r.length, diam, mfr);
    const valveLoss = Math.round(
      HYDRAULIC_CONST * Math.pow(Math.max(mfr, 0.001) / 1000 / kvValveOpen, 2) * 10
    ) / 10;

    // LT-mode extra power
    const extraPower = (state.designMode === MODE_FIXED && fixedSupplyT !== null)
      ? calcExtraPowerNeeded(qNom, heatLoss, fixedSupplyT, deltaT, tin)
      : 0;

    return {
      id: r.id, room: r.room || '—', collector: r.collector || 'Collector 1',
      heatLoss, qNom, qRatio: Math.round(qRatio * 1000) / 1000, extraPower,
      supplyT, returnT, mfr, diam, pipeLoss,
      totalLoss: totalLossRad, valveLoss, length: r.length,
    };
  });
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
  fixedDiamVal, valveCfg, kvMax, nPositions, warnings,
) {
  let supplyT   = 55;
  let converged = false;
  let radResults = [];

  for (let iter = 0; iter < 40; iter++) {
    radResults = computeRadiatorResults(
      radInputs, lossMap, tinMap,
      supplyT, deltaT, fixedDiamVal,
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
 * @param {object} inputs - All UI inputs collected by navigation.js
 * @returns {object}      - calcResults stored in state.calcResults
 */
function runFullCalculation(inputs) {
  const {
    deltaT, fixedSupplyT, fixedDiamVal,
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
      fixedDiamVal, valveCfg, kvMax, nPositions, warnings,
    );
    radResults = solved.radResults;
    warnings.push(`Pump mode converged → supply T ≈ ${solved.supplyT} °C`);
  } else {
    radResults = computeRadiatorResults(
      state.radiatorData, lossMap, tinMap,
      fixedSupplyT, deltaT, fixedDiamVal,
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
