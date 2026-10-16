/**
 * services/calculator.js
 * ======================
 * Orchestrates all domain modules to produce a complete set of results.
 * Entry point: runFullCalculation(inputs) → calcResults object
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Minimum share of the room heat loss assigned to hydronic radiators.
 *
 * 0.05 = 5%
 *
 * Example:
 * - Room heat loss: 858 W
 * - Minimum hydronic load: 42.9 W
 * - Maximum electric contribution: 815.1 W
 */
const MIN_HYDRONIC_SHARE = 0.05;

// ---------------------------------------------------------------------------
// Pump utility
// ---------------------------------------------------------------------------

/**
 * Interpolate pump head [kPa] at a given flow [kg/h].
 */
function interpolatePump(pts, q) {
  if (!pts || !pts.length) return null;

  if (q <= pts[0][0]) return pts[0][1];

  if (q >= pts[pts.length - 1][0]) {
    return pts[pts.length - 1][1];
  }

  for (let i = 0; i < pts.length - 1; i++) {
    if (
      q >= pts[i][0] &&
      q <= pts[i + 1][0]
    ) {
      const t =
        (q - pts[i][0]) /
        (pts[i + 1][0] - pts[i][0]);

      return (
        pts[i][1] +
        (pts[i + 1][1] - pts[i][1]) * t
      );
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// General helpers
// ---------------------------------------------------------------------------

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

/**
 * Build room-level information once, so that electric heating
 * is not counted multiple times for rooms with multiple radiators.
 */
function buildRoomMaps(radInputs) {
  const radiatorCountMap = {};
  const radiatorPowerMap = {};
  const electricCapacityMap = {};

  radInputs.forEach(r => {
    const room = r.room || '—';

    const qNom = Math.max(
      safeNumber(r.power, 2000),
      0
    );

    const elecCapacity = Math.max(
      safeNumber(r.elec, 0),
      0
    );

    radiatorCountMap[room] =
      (radiatorCountMap[room] || 0) + 1;

    radiatorPowerMap[room] =
      (radiatorPowerMap[room] || 0) + qNom;

    /**
     * Assumption:
     * r.elec is a room-level electric heater capacity.
     *
     * If the same capacity is repeated on multiple radiator rows,
     * use the largest value instead of summing it repeatedly.
     */
    electricCapacityMap[room] = Math.max(
      electricCapacityMap[room] || 0,
      elecCapacity
    );
  });

  return {
    radiatorCountMap,
    radiatorPowerMap,
    electricCapacityMap
  };
}

/**
 * Calculate electric and hydronic load at room level.
 */
function calculateRoomLoads(
  room,
  lossMap,
  electricCapacityMap
) {
  const roomHeatLoss = Math.max(
    safeNumber(lossMap[room], 0),
    0
  );

  const roomElectricCapacity = Math.max(
    safeNumber(electricCapacityMap[room], 0),
    0
  );

  if (roomHeatLoss <= 0) {
    return {
      roomHeatLoss: 0,
      roomElectricCapacity,
      roomElectricDelivered: 0,
      roomHydronicLoad: 0,
      minimumHydronicLoad: 0
    };
  }

  /**
   * A minimum hydronic contribution remains assigned to the radiators.
   */
  const minimumHydronicLoad =
    roomHeatLoss * MIN_HYDRONIC_SHARE;

  /**
   * Electric heating may only cover the part above the minimum
   * hydronic contribution.
   */
  const maximumElectricContribution = Math.max(
    roomHeatLoss - minimumHydronicLoad,
    0
  );

  const roomElectricDelivered = Math.min(
    roomElectricCapacity,
    maximumElectricContribution
  );

  /**
   * The remaining room load must be delivered by the radiators.
   */
  const roomHydronicLoad = Math.max(
    roomHeatLoss - roomElectricDelivered,
    0
  );

  return {
    roomHeatLoss,
    roomElectricCapacity,
    roomElectricDelivered,
    roomHydronicLoad,
    minimumHydronicLoad
  };
}

/**
 * Determine the fraction of the room load assigned to one radiator.
 *
 * The load is distributed proportionally according to nominal power.
 * If no nominal power is available, the load is divided equally.
 */
function calculateRadiatorShare(
  qNom,
  totalRoomRadiatorPower,
  radiatorCount
) {
  if (totalRoomRadiatorPower > 0) {
    return qNom / totalRoomRadiatorPower;
  }

  if (radiatorCount > 0) {
    return 1 / radiatorCount;
  }

  return 0;
}

/**
 * Calculate radiator output at the calculated water temperatures.
 */
function calculateActualRadiatorOutput(
  qNom,
  supplyT,
  returnT,
  tin,
  nExponent
) {
  if (
    qNom <= 0 ||
    supplyT == null ||
    returnT == null ||
    !Number.isFinite(supplyT) ||
    !Number.isFinite(returnT)
  ) {
    return 0;
  }

  const deltaTNom = 50;

  const averageWaterTemperature =
    (supplyT + returnT) / 2;

  const averageTemperatureDifference =
    averageWaterTemperature - tin;

  if (averageTemperatureDifference <= 0) {
    return 0;
  }

  const temperatureRatio =
    averageTemperatureDifference / deltaTNom;

  return Math.round(
    qNom *
    Math.pow(
      temperatureRatio,
      nExponent
    )
  );
}

// ---------------------------------------------------------------------------
// Radiator service helpers
// ---------------------------------------------------------------------------

function calcWeightedDeltaT(radResults) {
  const activeRadiators = radResults.filter(r =>
    safeNumber(r.mfr, 0) > 0 &&
    r.supplyT != null &&
    r.returnT != null
  );

  const totalMFR = activeRadiators.reduce(
    (sum, r) => sum + safeNumber(r.mfr, 0),
    0
  );

  if (totalMFR <= 0) return 0;

  return activeRadiators.reduce(
    (sum, r) =>
      sum +
      r.mfr *
      (r.supplyT - r.returnT),
    0
  ) / totalMFR;
}

/**
 * Compute per-radiator thermal + hydraulic results.
 *
 * fixedSupplyT !== null:
 * LT Dimensioning, with user-defined supply temperature.
 *
 * fixedSupplyT === null:
 * Existing System, with calculated minimum required supply temperature.
 */
function computeRadiatorResults(
  radInputs,
  lossMap,
  tinMap,
  fixedSupplyT,
  deltaT,
  valveCfg,
  kvMax,
  nPositions,
  warnings
) {
  const {
    radiatorCountMap,
    radiatorPowerMap,
    electricCapacityMap
  } = buildRoomMaps(radInputs);

  // -------------------------------------------------------------------------
  // LT Dimensioning
  // -------------------------------------------------------------------------

  if (fixedSupplyT !== null) {
    const rows = radInputs.map(r => {
      const room = r.room || '—';

      const radiatorCount =
        radiatorCountMap[room] || 1;

      const totalRoomRadiatorPower =
        radiatorPowerMap[room] || 0;

      const qNom = Math.max(
        safeNumber(r.power, 2000),
        0
      );

      const radiatorShare =
        calculateRadiatorShare(
          qNom,
          totalRoomRadiatorPower,
          radiatorCount
        );

      const {
        roomHeatLoss,
        roomElectricCapacity,
        roomElectricDelivered,
        roomHydronicLoad,
        minimumHydronicLoad
      } = calculateRoomLoads(
        room,
        lossMap,
        electricCapacityMap
      );

      /**
       * Per-radiator values.
       */
      const baseLoss =
        roomHeatLoss * radiatorShare;

      const hydronicLoad =
        roomHydronicLoad * radiatorShare;

      const elecDelivered =
        roomElectricDelivered * radiatorShare;

      const tin = safeNumber(
        tinMap[room],
        20
      );

      const emitterType =
        r.emitterType || 'Radiator';

      const emitterSettings =
        EMITTER_TYPES[emitterType] ||
        EMITTER_TYPES['Radiator'];

      const n_exponent =
        emitterSettings.n_exponent;

      /**
       * Additional nominal radiator capacity required at the selected
       * supply temperature.
       */
      let extraPower = 0;

      if (hydronicLoad > 0) {
        const calculatedExtraPower =
          calcExtraPowerNeeded(
            qNom,
            hydronicLoad,
            fixedSupplyT,
            deltaT,
            tin,
            n_exponent
          );

        extraPower =
          Number.isFinite(calculatedExtraPower)
            ? Math.max(calculatedExtraPower, 0)
            : 0;
      }

      const totalInstalledRadiatorPower =
        qNom + extraPower;

      const qRatio =
        totalInstalledRadiatorPower > 0
          ? hydronicLoad /
            totalInstalledRadiatorPower
          : 0;

      let returnT = null;
      let mfr = 0;

      if (
        hydronicLoad > 0 &&
        qRatio > 0
      ) {
        const returnTRaw =
          calcReturnTemp(
            fixedSupplyT,
            qRatio,
            tin,
            n_exponent
          );

        if (Number.isFinite(returnTRaw)) {
          returnT = Math.min(
            returnTRaw,
            fixedSupplyT - 0.1
          );

          /**
           * Prevent an invalid return temperature at or below
           * room temperature.
           */
          returnT = Math.max(
            returnT,
            tin + 0.1
          );

          /**
           * Important:
           * extraPower is additional installed radiator capacity,
           * not additional room heat demand.
           */
          mfr = calcMassFlowRate(
            hydronicLoad,
            fixedSupplyT,
            returnT
          );

          if (
            !Number.isFinite(mfr) ||
            mfr < 0
          ) {
            mfr = 0;
          }
        }
      }

      const qActual =
        calculateActualRadiatorOutput(
          qNom,
          fixedSupplyT,
          returnT,
          tin,
          n_exponent
        );

      const extraPowerActual =
        calculateActualRadiatorOutput(
          extraPower,
          fixedSupplyT,
          returnT,
          tin,
          n_exponent
        );

      const autoDiam = selectPipeDiam(
        Math.max(mfr, 0.1)
      );

      const diam =
        r.fixedDiam != null
          ? r.fixedDiam
          : autoDiam;

      if (
        r.fixedDiam != null &&
        r.fixedDiam < autoDiam
      ) {
        warnings.push({
          message:
            `⚠ Radiator ${r.id} (${room}): ` +
            `fixed Ø${r.fixedDiam} mm may be undersized ` +
            `for flow ${Math.round(mfr)} kg/h ` +
            `(auto would select Ø${autoDiam} mm)`,
          level: 1
        });
      }

      const pipeLoss =
        mfr > 0
          ? calcPipePressureLoss(
              r.length,
              diam,
              mfr
            )
          : 0;

      const totalLossRad =
        mfr > 0
          ? calcRadiatorKv(
              r.length,
              diam,
              mfr
            )
          : 0;

      return {
        id: r.id,
        room,
        collector:
          r.collector || 'Collector 1',

        // Room-level results
        roomHeatLoss,
        roomElectricCapacity,
        roomElectricDelivered,
        roomHydronicLoad,
        minimumHydronicLoad,

        // Per-radiator distribution
        radiatorCount,
        totalRoomRadiatorPower,
        radiatorShare,

        heatLoss: baseLoss,
        hydronicLoad,

        // Radiator properties
        qNom,
        qActual,

        // Electric heater properties
        elec: roomElectricCapacity,
        elecCapacity: roomElectricCapacity,
        elecDelivered,

        emitterType,
        n_exponent,

        qRatio:
          Math.round(qRatio * 1000) / 1000,

        extraPower,
        extraPowerActual,

        supplyT: fixedSupplyT,
        returnT,
        mfr,

        diam,
        diamAuto: autoDiam,
        diamFixed: r.fixedDiam != null,

        pipeLoss,
        totalLoss: totalLossRad,
        length: r.length
      };
    });

    return rows;
  }

  // -------------------------------------------------------------------------
  // Existing System
  // -------------------------------------------------------------------------

  const rows = radInputs.map(r => {
    const room = r.room || '—';

    const radiatorCount =
      radiatorCountMap[room] || 1;

    const totalRoomRadiatorPower =
      radiatorPowerMap[room] || 0;

    const qNom = Math.max(
      safeNumber(r.power, 2000),
      0
    );

    const radiatorShare =
      calculateRadiatorShare(
        qNom,
        totalRoomRadiatorPower,
        radiatorCount
      );

    const {
      roomHeatLoss,
      roomElectricCapacity,
      roomElectricDelivered,
      roomHydronicLoad,
      minimumHydronicLoad
    } = calculateRoomLoads(
      room,
      lossMap,
      electricCapacityMap
    );

    const heatLoss =
      roomHeatLoss * radiatorShare;

    const hydronicLoad =
      roomHydronicLoad * radiatorShare;

    const elecDelivered =
      roomElectricDelivered * radiatorShare;

    const tin = safeNumber(
      tinMap[room],
      20
    );

    const emitterType =
      r.emitterType || 'Radiator';

    const emitterSettings =
      EMITTER_TYPES[emitterType] ||
      EMITTER_TYPES['Radiator'];

    const n_exponent =
      emitterSettings.n_exponent;

    const qRatio =
      qNom > 0
        ? hydronicLoad / qNom
        : 0;

    let requiredSupplyT = null;

    if (
      hydronicLoad > 0 &&
      qRatio > 0
    ) {
      const calculatedSupplyT =
        calcSupplyTemp(
          qRatio,
          deltaT,
          tin,
          n_exponent
        );

      if (Number.isFinite(calculatedSupplyT)) {
        requiredSupplyT = calculatedSupplyT;
      }
    }

    return {
      r,
      room,

      roomHeatLoss,
      roomElectricCapacity,
      roomElectricDelivered,
      roomHydronicLoad,
      minimumHydronicLoad,

      radiatorCount,
      totalRoomRadiatorPower,
      radiatorShare,

      heatLoss,
      hydronicLoad,
      elecDelivered,

      tin,
      qNom,
      qRatio,
      requiredSupplyT,

      emitterType,
      n_exponent
    };
  });

  /**
   * Only valid and active radiators determine the common supply temperature.
   */
  const activeRows = rows.filter(x =>
    x.hydronicLoad > 0 &&
    x.requiredSupplyT != null &&
    Number.isFinite(x.requiredSupplyT)
  );

  const maxSupply =
    activeRows.length > 0
      ? Math.max(
          ...activeRows.map(
            x => x.requiredSupplyT
          )
        )
      : null;

  const resolved = rows.map(x => {
    const {
      r,
      room,

      roomHeatLoss,
      roomElectricCapacity,
      roomElectricDelivered,
      roomHydronicLoad,
      minimumHydronicLoad,

      radiatorCount,
      totalRoomRadiatorPower,
      radiatorShare,

      heatLoss,
      hydronicLoad,
      elecDelivered,

      tin,
      qNom,
      qRatio,

      emitterType,
      n_exponent
    } = x;

    let returnT = null;
    let mfr = 0;

    if (
      hydronicLoad > 0 &&
      qRatio > 0 &&
      maxSupply != null
    ) {
      const returnTRaw =
        calcReturnTemp(
          maxSupply,
          qRatio,
          tin,
          n_exponent
        );

      if (Number.isFinite(returnTRaw)) {
        returnT = Math.min(
          returnTRaw,
          maxSupply - 0.1
        );

        returnT = Math.max(
          returnT,
          tin + 0.1
        );

        mfr = calcMassFlowRate(
          hydronicLoad,
          maxSupply,
          returnT
        );

        if (
          !Number.isFinite(mfr) ||
          mfr < 0
        ) {
          mfr = 0;
        }
      }
    }

    return {
      r,
      room,

      roomHeatLoss,
      roomElectricCapacity,
      roomElectricDelivered,
      roomHydronicLoad,
      minimumHydronicLoad,

      radiatorCount,
      totalRoomRadiatorPower,
      radiatorShare,

      heatLoss,
      hydronicLoad,
      elecDelivered,

      tin,
      qNom,
      qRatio,

      supplyT: maxSupply,
      returnT,
      mfr,

      emitterType,
      n_exponent
    };
  });

  /**
   * Preserve the original uniform-diameter logic.
   */
  const uniformDiam =
    resolved.length > 0
      ? Math.max(
          ...resolved.map(x =>
            selectPipeDiam(
              Math.max(x.mfr, 0.1)
            )
          )
        )
      : selectPipeDiam(0.1);

  return resolved.map(x => {
    const {
      r,
      room,

      roomHeatLoss,
      roomElectricCapacity,
      roomElectricDelivered,
      roomHydronicLoad,
      minimumHydronicLoad,

      radiatorCount,
      totalRoomRadiatorPower,
      radiatorShare,

      heatLoss,
      hydronicLoad,
      elecDelivered,

      tin,
      qNom,
      qRatio,

      supplyT,
      returnT,
      mfr,

      emitterType,
      n_exponent
    } = x;

    const autoDiam = uniformDiam;

    const diam =
      r.fixedDiam != null
        ? r.fixedDiam
        : uniformDiam;

    if (
      r.fixedDiam != null &&
      r.fixedDiam < autoDiam
    ) {
      warnings.push({
        message:
          `⚠ Radiator ${r.id} (${room}): ` +
          `fixed Ø${r.fixedDiam} mm may be undersized ` +
          `for flow ${Math.round(mfr)} kg/h ` +
          `(auto would select Ø${autoDiam} mm)`,
        level: 1
      });
    }

    const pipeLoss =
      mfr > 0
        ? calcPipePressureLoss(
            r.length,
            diam,
            mfr
          )
        : 0;

    const totalLossRad =
      mfr > 0
        ? calcRadiatorKv(
            r.length,
            diam,
            mfr
          )
        : 0;

    const qActual =
      calculateActualRadiatorOutput(
        qNom,
        supplyT,
        returnT,
        tin,
        n_exponent
      );

    return {
      id: r.id,
      room,
      collector:
        r.collector || 'Collector 1',

      // Room-level results
      roomHeatLoss,
      roomElectricCapacity,
      roomElectricDelivered,
      roomHydronicLoad,
      minimumHydronicLoad,

      // Per-radiator distribution
      radiatorCount,
      totalRoomRadiatorPower,
      radiatorShare,

      heatLoss,
      hydronicLoad,

      // Radiator properties
      qNom,
      qActual,

      // Electric heater properties
      elec: roomElectricCapacity,
      elecCapacity: roomElectricCapacity,
      elecDelivered,

      emitterType,
      n_exponent,

      qRatio:
        Math.round(qRatio * 1000) / 1000,

      extraPower: 0,
      extraPowerActual: 0,

      supplyT,
      returnT,
      mfr,

      diam,
      diamAuto: autoDiam,
      diamFixed: r.fixedDiam != null,

      pipeLoss,
      totalLoss: totalLossRad,
      length: r.length
    };
  });
}

// ---------------------------------------------------------------------------
// Collector results
// ---------------------------------------------------------------------------

function computeCollectorResults(
  collectorData,
  radResults
) {
  return collectorData.map(col => {
    const radInCol = radResults.filter(
      r => r.collector === col.name
    );

    const totalMFR = radInCol.reduce(
      (sum, r) =>
        sum + safeNumber(r.mfr, 0),
      0
    );

    const diam = selectPipeDiam(
      Math.max(totalMFR, 0.1)
    );

    const colLoss =
      totalMFR > 0
        ? Math.round(
            HYDRAULIC_CONST *
            Math.pow(
              totalMFR /
              1000 /
              KV_COLLECTOR,
              2
            ) *
            10
          ) / 10
        : 0;

    const pipeLoss =
      totalMFR > 0
        ? calcPipePressureLoss(
            col.length,
            diam,
            totalMFR
          )
        : 0;

    return {
      name: col.name,
      mfr: totalMFR,
      diam,
      pipeLoss,
      colLoss,
      totalLoss: pipeLoss + colLoss
    };
  });
}

// ---------------------------------------------------------------------------
// Pressure calculations
// ---------------------------------------------------------------------------

function buildTotalPressures(
  radResults,
  colResults
) {
  const colNames = colResults
    .map(c => c.name)
    .sort();

  const colLossMap = {};

  colResults.forEach(c => {
    colLossMap[c.name] = c.totalLoss;
  });

  radResults.forEach(r => {
    const idx = colNames.indexOf(
      r.collector
    );

    let downstream = 0;

    for (
      let i = Math.max(idx, 0);
      i < colNames.length;
      i++
    ) {
      downstream +=
        colLossMap[colNames[i]] || 0;
    }

    r.totalPressureLoss = Math.round(
      (
        r.totalLoss +
        downstream +
        PRESSURE_BOILER
      ) * 10
    ) / 10;
  });

  return radResults.length
    ? Math.max(
        ...radResults.map(
          r => r.totalPressureLoss
        )
      )
    : 0;
}

// ---------------------------------------------------------------------------
// Main calculation entry point
// ---------------------------------------------------------------------------

function runFullCalculation(inputs) {
  const {
    deltaT,
    fixedSupplyT,

    valveCfg,
    kvMax,
    nPositions,

    pumpCurvePoints,
    valveType,

    lossMap,
    tinMap
  } = inputs;

  const warnings = [];

  const radResults =
    computeRadiatorResults(
      state.radiatorData,
      lossMap,
      tinMap,
      fixedSupplyT,
      deltaT,
      valveCfg,
      kvMax,
      nPositions,
      warnings
    );

  const colResults =
    computeCollectorResults(
      state.collectorData,
      radResults
    );

  const maxPressure =
    buildTotalPressures(
      radResults,
      colResults
    );

  /**
   * Important:
   * Keep the complete radResults array here.
   */
  computeValvePositions(
    radResults,
    valveCfg,
    kvMax,
    nPositions
  );

  /**
   * Safely calculate the maximum pressure.
   * Invalid or missing circuit values are treated as zero.
   */
  const maxPressureFinal =
    radResults.length
      ? Math.max(
          ...radResults.map(r =>
            Number.isFinite(
              r.totalPressureValveCircuit
            )
              ? r.totalPressureValveCircuit
              : 0
          )
        )
      : maxPressure;

  const velocityCheck =
    checkVelocities(
      radResults,
      colResults
    );

  if (
    velocityCheck &&
    Array.isArray(
      velocityCheck.warnings
    )
  ) {
    warnings.push(
      ...velocityCheck.warnings
    );
  }

  const totalMFR =
    radResults.reduce(
      (sum, r) =>
        sum + safeNumber(r.mfr, 0),
      0
    );

  const weightedDT =
    calcWeightedDeltaT(
      radResults
    );

  // -------------------------------------------------------------------------
  // System totals
  // -------------------------------------------------------------------------

  /**
   * Room values occur once per radiator row.
   * Count each room only once in the totals.
   */
  const processedRooms = new Set();

  let totalHeatLoss = 0;
  let totalElectricCapacity = 0;
  let totalElectricDelivered = 0;
  let totalHydronicLoad = 0;

  radResults.forEach(r => {
    if (processedRooms.has(r.room)) {
      return;
    }

    processedRooms.add(r.room);

    totalHeatLoss += safeNumber(
      r.roomHeatLoss,
      0
    );

    totalElectricCapacity += safeNumber(
      r.roomElectricCapacity,
      0
    );

    totalElectricDelivered += safeNumber(
      r.roomElectricDelivered,
      0
    );

    totalHydronicLoad += safeNumber(
      r.roomHydronicLoad,
      0
    );
  });

  const modeLabel =
    fixedSupplyT !== null
      ? `LT Dimensioning (supply fixed at ${fixedSupplyT} °C)`
      : 'Existing System (required supply T calculated)';

  warnings.unshift(
    `ℹ️ Mode: ${modeLabel}`
  );

  if (totalElectricDelivered > 0) {
    warnings.push({
      message:
        `ℹ️ Electric heating is included. ` +
        `At least ${Math.round(
          MIN_HYDRONIC_SHARE * 100
        )}% of the room heat demand remains assigned ` +
        `to the hydronic radiators.`,
      level: 0
    });
  }

  return {
    radResults,
    colResults,
    warnings,

    weightedDT,
    totalMFR,
    maxPressure: maxPressureFinal,

    totalHeatLoss,
    totalElectricCapacity,
    totalElectricDelivered,
    totalHydronicLoad,

    minimumHydronicShare:
      MIN_HYDRONIC_SHARE,

    pumpCurvePoints,
    valveType,
    valveCfg,

    fixedSupplyT,
    deltaT,
    kvMax,
    nPositions
  };
}