/**
 * domain/radiator.js
 * ==================
 * Radiator thermal and hydraulic model following EN 442.
 * Handles supply/return temperature calculation, mass flow rate,
 * and standard pipe diameter selection.
 *
 * Mirrors: domain/radiator.py  (Radiator class + _select_pipe_diameter)
 * Zero UI dependencies — pure calculation functions only.
 */

/**
 * Calculate the required supply temperature given a load ratio.
 *
 * @param {number} qRatio  - Actual / rated heat output (–)
 * @param {number} deltaT  - System ΔT (supply − return) [K]
 * @param {number} tin     - Room set-point [°C]
 * @returns {number} Supply temperature [°C]
 */
function calcSupplyTemp(qRatio, deltaT, tin) {
  if (qRatio <= 0) return Math.round((tin + Math.max(deltaT, 3)) * 10) / 10;
  const c = Math.exp(deltaT / T_FACTOR / Math.pow(qRatio, 1 / EXPONENT_N));
  if (c <= 1) return Math.round((tin + Math.max(deltaT, 3)) * 10) / 10;
  return Math.round((tin + (c / (c - 1)) * deltaT) * 10) / 10;
}

/**
 * Calculate the return temperature given supply temperature and load ratio.
 *
 * @param {number} supplyT - Supply temperature [°C]
 * @param {number} qRatio  - Actual / rated heat output (–)
 * @param {number} tin     - Room temperature [°C]
 * @returns {number} Return temperature [°C]
 */
function calcReturnTemp(supplyT, qRatio, tin) {
  const lift = supplyT - tin;
  if (lift <= 0) return supplyT;
  const tret = Math.pow(qRatio, 1 / EXPONENT_N) * T_FACTOR *
               (Math.pow(qRatio, 1 / EXPONENT_N) * T_FACTOR) / lift + tin;
  return Math.round(tret * 10) / 10;
}

/**
 * Calculate the mass flow rate from heat loss and temperatures.
 *
 * @param {number} heatLoss - Heat loss [W]
 * @param {number} supplyT  - Supply temperature [°C]
 * @param {number} returnT  - Return temperature [°C]
 * @returns {number} Mass flow rate [kg/h]
 */
function calcMassFlowRate(heatLoss, supplyT, returnT) {
  const dT = Math.max(supplyT - returnT, 0.1);
  return Math.round(heatLoss / 4180 / dT * 3600 * 10) / 10;
}

/**
 * Select the smallest standard pipe diameter adequate for the mass flow rate.
 * Formula mirrors domain/radiator.py _select_pipe_diameter.
 *
 * @param {number} mfr - Mass flow rate [kg/h]
 * @returns {number}   - Pipe diameter [mm]
 */
function selectPipeDiam(mfr) {
  const minD      = 1.4641 * Math.pow(Math.max(mfr, 0.1), 0.4217);
  const candidates = POSSIBLE_DIAMETERS.filter(d => d >= minD);
  if (!candidates.length) return POSSIBLE_DIAMETERS[POSSIBLE_DIAMETERS.length - 1];
  return candidates.reduce((a, b) =>
    Math.abs(a - minD) < Math.abs(b - minD) ? a : b
  );
}

/**
 * Compute the LMTD between radiator water and room air [K].
 * Used in EN 442 thermal re-calculation after network solve.
 */
function lmtd(tSup, tRet, tRoom) {
  const dt1 = tSup - tRoom;
  const dt2 = tRet - tRoom;
  if (dt1 <= 0 || dt2 <= 0) return 0;
  if (Math.abs(dt1 - dt2) < 1e-6) return dt1;
  return (dt1 - dt2) / Math.log(dt1 / dt2);
}

/**
 * Calculate extra power needed when a radiator is undersized for LT mode.
 * EN 442: Q_delivered = Q_nom × (LMTD_actual / LMTD_nom)^n
 *
 * @param {number} qNom    - Nominal power at 75/65/20 [W]
 * @param {number} heatLoss- Room design heat loss [W]
 * @param {number} supplyT - Fixed supply temperature [°C]
 * @param {number} deltaT  - System ΔT [K]
 * @param {number} tin     - Room temperature [°C]
 * @returns {number} Extra power needed [W], 0 if radiator is sufficient
 */
function calcExtraPowerNeeded(qNom, heatLoss, supplyT, deltaT, tin) {
  if (!qNom || !heatLoss || deltaT <= 0) return 0;
  const lmtdNom = lmtd(75, 65, 20);
  const returnT = supplyT - deltaT;
  const lmtdAct = lmtd(supplyT, returnT, tin);
  if (lmtdAct <= 0) return Math.max(0, heatLoss);
  const qDelivered = qNom * Math.pow(lmtdAct / lmtdNom, EXPONENT_N);
  return Math.max(0, Math.round((heatLoss - qDelivered) * 10) / 10);
}

/**
 * Re-calculate supply temperature, return temperature and actual heat output
 * for each radiator after the hydraulic network has been re-solved with new
 * mass flow rates.  Uses EN 442 LMTD iteration (mirrors valve_override.py
 * _recalculate_temperatures).
 *
 * Mutates each row's supplyT, returnT, actualOutput in-place.
 *
 * @param {Array}  radRows    - Array of radiator result objects (mutable)
 * @param {number} deltaT     - System design ΔT [K]
 * @param {number|null} fixedSupplyT - Override supply temperature, or null
 * @param {object} tinMap     - { 'Room N': temperature }
 */
function recalcTemperaturesEN442(radRows, deltaT, fixedSupplyT, tinMap) {
  const lmtdNom = lmtd(75, 65, 20);
  const cp      = 4180 / 3600; // W per (kg/h · K)

  radRows.forEach(r => {
    const tRoom = tinMap[r.room] || 20;
    const qNom  = r.qNom || 2000;
    const mDot  = r.mfr;
    const tSup  = (fixedSupplyT !== null && fixedSupplyT !== undefined)
                  ? fixedSupplyT
                  : (r.supplyT || tRoom + deltaT + 5);

    if (mDot < MIN_FLOW) {
      r.supplyT      = tSup;
      r.returnT      = tSup;
      r.actualOutput = 0;
      return;
    }

    // Iterate: find T_return self-consistently
    let tRet = tSup - deltaT;
    for (let i = 0; i < 30; i++) {
      const lmtdAct = lmtd(tSup, tRet, tRoom);
      if (lmtdAct <= 0) { tRet = tSup - 0.1; break; }
      const qCalc   = qNom * Math.pow(lmtdAct / lmtdNom, EXPONENT_N);
      const tRetNew = tSup - qCalc / (mDot * cp);
      if (Math.abs(tRetNew - tRet) < 0.01) { tRet = tRetNew; break; }
      tRet = tRetNew;
    }

    const lmtdFinal  = lmtd(tSup, tRet, tRoom);
    r.supplyT        = Math.round(tSup  * 10) / 10;
    r.returnT        = Math.round(tRet  * 10) / 10;
    r.actualOutput   = lmtdFinal > 0
      ? Math.round(qNom * Math.pow(lmtdFinal / lmtdNom, EXPONENT_N) * 10) / 10
      : 0;
  });
}
