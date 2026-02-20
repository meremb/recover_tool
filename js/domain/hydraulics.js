/**
 * domain/hydraulics.js
 * ====================
 * Pipe-circuit and collector-manifold hydraulic models.
 * Calculates pressure losses, water volumes, pipe kv, and velocities.
 *
 * Mirrors: domain/hydraulics.py  (Circuit, Collector, calc_velocity,
 *                                  check_pipe_velocities)
 * Zero UI dependencies — pure calculation functions only.
 */

// ---------------------------------------------------------------------------
//  Pipe kv  (polynomial model)
// ---------------------------------------------------------------------------

/** kv of a circular pipe given its internal diameter [m³/h] */
function kvPipe(d_mm) {
  const d = d_mm / 1000;
  return KV_A * d * d + KV_B * d + KV_C;
}

// ---------------------------------------------------------------------------
//  Circuit — pressure losses
// ---------------------------------------------------------------------------

/**
 * Friction + local pressure loss for a pipe run [Pa].
 * Mirrors Circuit.calculate_pressure_loss_piping.
 *
 * @param {number} length  - One-way run length [m]
 * @param {number} diam_mm - Internal diameter [mm]
 * @param {number} mfr     - Mass flow rate [kg/h]
 */
function calcPipePressureLoss(length, diam_mm, mfr) {
  const kv      = kvPipe(diam_mm);
  const rPerM   = HYDRAULIC_CONST * Math.pow(mfr / 1000 / kv, 2);
  return Math.round(rPerM * length * 2 * LOCAL_LOSS * 10) / 10;
}

/**
 * Total loss: pipe run + radiator body [Pa].
 * Mirrors Circuit.calculate_pressure_radiator_kv.
 */
function calcRadiatorKv(length, diam_mm, mfr) {
  const pipeLoss = calcPipePressureLoss(length, diam_mm, mfr);
  const radLoss  = HYDRAULIC_CONST * Math.pow(mfr / 1000 / KV_RADIATOR, 2);
  return Math.round((pipeLoss + radLoss) * 10) / 10;
}

/**
 * Water volume in a circuit [litres].
 * Mirrors Circuit.calculate_water_volume.
 */
function calcWaterVolume(length, diam_mm) {
  const r_m = (diam_mm / 2) / 1000;
  return Math.round(Math.PI * r_m * r_m * length * 1000 * 100) / 100;
}

// ---------------------------------------------------------------------------
//  Hydraulic resistance coefficients  (used by network solver)
// ---------------------------------------------------------------------------

/**
 * Pipe resistance coefficient R such that ΔP[Pa] = R × mfr[kg/h]²
 * Mirrors valve_override.py _pipe_resistance.
 */
function pipeResistance(length_m, diam_mm) {
  const d  = diam_mm / 1000;
  const kv = KV_A * d * d + KV_B * d + KV_C;
  return HYDRAULIC_CONST / (1e6 * kv * kv) * length_m * 2 * LOCAL_LOSS;
}

/**
 * Valve / component resistance from kv value.
 * Mirrors valve_override.py _valve_resistance_from_kv.
 */
function valveResistance(kv) {
  if (kv <= 0) return 1e12; // effectively infinite (closed)
  return HYDRAULIC_CONST / (1e6 * kv * kv);
}

/** Fixed radiator body resistance [Pa/(kg/h)²] */
const R_RAD_BODY = valveResistance(KV_RADIATOR);

// ---------------------------------------------------------------------------
//  Velocity
// ---------------------------------------------------------------------------

/**
 * Water velocity in a circular pipe [m/s].
 * Mirrors domain/hydraulics.py calc_velocity.
 */
function calcVelocity(mfr_kgph, diam_mm) {
  if (!diam_mm) return 0;
  const mDot = mfr_kgph / 3600;
  const d_m  = diam_mm / 1000;
  const area = Math.PI * Math.pow(d_m / 2, 2);
  if (area === 0) return 0;
  return mDot / (WATER_DENSITY * area);
}

/**
 * Add velocity field to each item in radResults and colResults.
 * Returns { radResults, colResults, warnings }.
 * Mirrors domain/hydraulics.py check_pipe_velocities.
 */
function checkVelocities(radResults, colResults, maxVel = 0.5) {
  const warnings = [];

  radResults.forEach(r => {
    const v = calcVelocity(r.mfr, r.diam);
    r.velocity = Math.round(v * 1000) / 1000;
    if (v > maxVel)
      warnings.push(`⚠ High velocity radiator ${r.id}: ${v.toFixed(2)} m/s > ${maxVel} m/s`);
  });

  colResults.forEach(c => {
    const v = calcVelocity(c.mfr, c.diam);
    c.velocity = Math.round(v * 1000) / 1000;
    if (v > maxVel)
      warnings.push(`⚠ High velocity collector ${c.name}: ${v.toFixed(2)} m/s > ${maxVel} m/s`);
  });

  return { radResults, colResults, warnings };
}
