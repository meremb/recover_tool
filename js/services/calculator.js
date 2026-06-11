/**
 * services/calculator.js
 * ======================
 * Orchestrates all domain modules to produce a complete set of results.
 * Entry point: runFullCalculation(inputs) → calcResults object
 */

// ---------------------------------------------------------------------------
//  Pump utility  (used only for pump check display in results)
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

// ---------------------------------------------------------------------------
//  Radiator service helpers
// ---------------------------------------------------------------------------

function calcWeightedDeltaT(radResults) {
  const totalMFR = radResults.reduce((s, r) => s + r.mfr, 0);
  if (totalMFR <= 0) return 0;
  return radResults.reduce((s, r) => s + r.mfr * (r.supplyT - r.returnT), 0) / totalMFR;
}

/**
 * Compute per-radiator thermal + hydraulic results.
 *
 * fixedSupplyT !== null  → LT Dimensioning: user-defined supply temperature,
 *                          calculates extra power if radiators are undersized.
 * fixedSupplyT === null  → Existing System: derives minimum required supply
 *                          temperature from current radiators.
 */
function computeRadiatorResults(
  radInputs, lossMap, tinMap,
  fixedSupplyT, deltaT,
  valveCfg, kvMax, nPositions, warnings,
) {
  const radiatorCountMap = {};
  state.radiatorData.forEach(r => {
    if (r.room) {
      radiatorCountMap[r.room] = (radiatorCountMap[r.room] || 0) + 1;
    }
  });
  if (fixedSupplyT !== null) {
    // ── LT Dimensioning: fixed supply temperature ─────────────────────────
    const rows = radInputs.map(r => {
      const totalLoss = lossMap[r.room] || 0;
      const radiatorCount = radiatorCountMap[r.room] || 1;
    // split heat loss per radiator
      const baseLoss = totalLoss / radiatorCount;
      //const baseLoss = lossMap[r.room] || 0;
      const elec     = r.elec || 0;
      const tin      = tinMap[r.room] || 20;
      const qNom     = r.power || 2000;

      const emitterType = r.emitterType || 'Radiator';
      const n_exponent  = (EMITTER_TYPES[emitterType] || EMITTER_TYPES['Radiator']).n_exponent;

      const thermalLoad = baseLoss - elec;
      const returnTDesign = calcReturnTempFixed(fixedSupplyT, deltaT, tin);
      const extraPower    = calcExtraPowerNeeded(qNom, thermalLoad, fixedSupplyT, deltaT, tin, n_exponent);
      const qRatio      = (qNom + extraPower) > 0 ? thermalLoad / (qNom + extraPower) : 0;
      const boostedLoss = baseLoss + extraPower;

      const returnTRaw = calcReturnTemp(fixedSupplyT, qRatio, tin, n_exponent);
      const returnT    = Math.min(returnTRaw, fixedSupplyT - 0.1);
      const mfr        = calcMassFlowRate(boostedLoss, fixedSupplyT, returnT);

      const autoDiam = selectPipeDiam(Math.max(mfr, 0.1));
      const diam     = (r.fixedDiam != null) ? r.fixedDiam : autoDiam;

      if (r.fixedDiam != null && r.fixedDiam < autoDiam) {
        warnings.push({
          message: `⚠ Radiator ${r.id} (${r.room}): fixed Ø${r.fixedDiam} mm may be undersized ` +
          `for flow ${Math.round(mfr)} kg/h (auto would select Ø${autoDiam} mm)`,
          level: 1,
        });
      }

      const pipeLoss     = calcPipePressureLoss(r.length, diam, mfr);
      const totalLossRad = calcRadiatorKv(r.length, diam, mfr);

      return {
        id: r.id, room: r.room || '—', collector: r.collector || 'Collector 1',
        heatLoss: baseLoss, qNom, elec,
        emitterType, n_exponent,
        qRatio: Math.round(qRatio * 1000) / 1000,
        extraPower,
        supplyT: fixedSupplyT, returnT, mfr,
        diam, diamAuto: autoDiam, diamFixed: r.fixedDiam != null,
        pipeLoss, totalLoss: totalLossRad, length: r.length,
      };
    });
    return rows;

  } else {
    // ── Existing System: auto-compute required supply temperature ─────────
    const rows = radInputs.map(r => {
      const totalLoss = (lossMap[r.room] || 0);
      const radiatorCount = radiatorCountMap[r.room] || 1;
    // split heat loss per radiator
      const heatLoss = totalLoss / radiatorCount;
      //const heatLoss = (lossMap[r.room] || 0);
      const elec     = r.elec || 0;
      const tin      = tinMap[r.room] || 20;
      const qNom     = r.power || 2000;
      const qRatio   = qNom > 0 ? (heatLoss-elec) / qNom : 0;
      const emitterType = r.emitterType || 'Radiator';
      const n_exponent = (EMITTER_TYPES[emitterType] || EMITTER_TYPES['Radiator']).n_exponent;
      const supplyT  = calcSupplyTemp(qRatio, deltaT, tin, n_exponent);
      return { r, heatLoss, elec, tin, qNom, qRatio, supplyT, emitterType, n_exponent };
    });

    const maxSupply = Math.max(...rows.map(x => x.supplyT));

    const resolved = rows.map(x => {
      const { r, heatLoss, elec, tin, qNom, qRatio, emitterType, n_exponent } = x;
      const returnT  = calcReturnTemp(maxSupply, qRatio, tin, n_exponent);
      const mfr      = calcMassFlowRate(heatLoss, maxSupply, returnT);
      return { r, heatLoss, elec, tin, qNom, qRatio, supplyT: maxSupply, returnT, mfr, emitterType, n_exponent };
    });

    const uniformDiam = Math.max(
      ...resolved.map(x => selectPipeDiam(Math.max(x.mfr, 0.1)))
    );

    return resolved.map(x => {
      const { r, heatLoss, elec, tin, qNom, qRatio, supplyT, returnT, mfr, emitterType, n_exponent } = x;
      const autoDiam = uniformDiam;
      const diam     = (r.fixedDiam != null) ? r.fixedDiam : uniformDiam;

      if (r.fixedDiam != null && r.fixedDiam < autoDiam) {
        warnings.push({
          message:`⚠ Radiator ${r.id} (${r.room}): fixed Ø${r.fixedDiam} mm may be undersized ` +
          `for flow ${Math.round(mfr)} kg/h (auto would select Ø${autoDiam} mm)`,
          level: 1,
        });
      }

      const pipeLoss     = calcPipePressureLoss(r.length, diam, mfr);
      const totalLossRad = calcRadiatorKv(r.length, diam, mfr);

      return {
        id: r.id, room: r.room || '—', collector: r.collector || 'Collector 1',
        heatLoss, qNom, elec,
        emitterType, n_exponent,
        qRatio: Math.round(qRatio * 1000) / 1000,
        extraPower: 0,
        supplyT, returnT, mfr,
        diam, diamAuto: autoDiam, diamFixed: r.fixedDiam != null,
        pipeLoss, totalLoss: totalLossRad, length: r.length,
      };
    });
  }
}

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

function buildTotalPressures(radResults, colResults) {
  const colNames   = colResults.map(c => c.name).sort();
  const colLossMap = {};
  colResults.forEach(c => (colLossMap[c.name] = c.totalLoss));

  radResults.forEach(r => {
    const idx = colNames.indexOf(r.collector);
    let downstream = 0;
    for (let i = Math.max(idx, 0); i < colNames.length; i++)
      downstream += colLossMap[colNames[i]] || 0;
    r.totalPressureLoss = Math.round((r.totalLoss + downstream + PRESSURE_BOILER) * 10) / 10;
  });

  return radResults.length ? Math.max(...radResults.map(r => r.totalPressureLoss)) : 0;
}

// ---------------------------------------------------------------------------
//  Main calculation entry point
// ---------------------------------------------------------------------------

function runFullCalculation(inputs) {
  const {
    deltaT, fixedSupplyT,
    valveCfg, kvMax, nPositions,
    pumpCurvePoints, valveType,
    lossMap, tinMap,
  } = inputs;

  const warnings = [];

  const radResults = computeRadiatorResults(
    state.radiatorData, lossMap, tinMap,
    fixedSupplyT, deltaT,
    valveCfg, kvMax, nPositions, warnings,
  );

  const colResults  = computeCollectorResults(state.collectorData, radResults);
  const maxPressure = buildTotalPressures(radResults, colResults);

  computeValvePositions(radResults, valveCfg, kvMax, nPositions);

  // maxPressure is the max of totalPressureValveCircuit (pipe + boiler + open valve)
  const maxPressureFinal = radResults.length
    ? Math.max(...radResults.map(r => r.totalPressureValveCircuit))
    : maxPressure;

  const { warnings: velWarnings } = checkVelocities(radResults, colResults);
  warnings.push(...velWarnings);

  const totalMFR   = radResults.reduce((s, r) => s + r.mfr, 0);
  const weightedDT = calcWeightedDeltaT(radResults);

  // Mode label for display
  const modeLabel = fixedSupplyT !== null
    ? `LT Dimensioning (supply fixed at ${fixedSupplyT} °C)`
    : 'Existing System (required supply T calculated)';

  warnings.unshift(`ℹ️ Mode: ${modeLabel}`);

  return {
    radResults, colResults, warnings,
    weightedDT, totalMFR, maxPressure: maxPressureFinal,
    pumpCurvePoints, valveType, valveCfg,
    fixedSupplyT, deltaT, kvMax, nPositions,
  };
}