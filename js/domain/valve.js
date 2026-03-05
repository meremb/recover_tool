/**
 * domain/valve.js
 * ===============
 * TRV sizing model — maps required kv to a discrete valve position.
 */

function kvAtPosition(valveCfg, kvMax, nPositions, position) {
  if (valveCfg) {
    const idx = Math.min(Math.max(position - 1, 0), valveCfg.kv_values.length - 1);
    return valveCfg.kv_values[idx];
  }
  const n   = Math.max(nPositions - 1, 1);
  const pos = Math.min(Math.max(position - 1, 0), n);
  return (pos / n) * kvMax;
}

function calcValvePressureLoss(valveCfg, kvMax, mfr) {
  const kv = valveCfg
    ? valveCfg.kv_values[valveCfg.kv_values.length - 1]
    : kvMax;
  if (kv <= 0) return Infinity;
  return Math.round(HYDRAULIC_CONST * Math.pow(mfr / 1000 / kv, 2) * 10) / 10;
}

/**
 * Compute required kv to balance each circuit, then look up valve position.
 * Mutates each row's valvePos and kvNeeded in-place.
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
      const ratio    = Math.min(Math.max(kvNeeded / kvMax, 0), 1);
      const ratioPos = Math.min(Math.sqrt(ratio), 1);
      valvePos = Math.ceil(ratioPos * nPositions);
    }

    r.valvePos = valvePos;
    r.kvNeeded = Math.round(kvNeeded * 1000) / 1000;
  });
}
