/**
 * domain/heat_load.js
 * ===================
 * Room-level heat-load calculator following EN 12831 / EPB simplified approach.
 * All U-values in W/(m²·K), temperatures in °C, heat losses in W.
 *
 * Mirrors: domain/heat_load.py  (RoomLoadCalculator)
 * Zero UI dependencies — pure calculation functions only.
 */

/**
 * Compute the design heat load for a single room.
 *
 * @param {object} room      - { tin, area, wallsExt, type, onGround, underRoof }
 * @param {object} params    - { uw, u_roof, u_ground, u_glass, tout, vcalc, vsys,
 *                               v50, neighbourT, un, lir, wallHeight }
 * @param {boolean} detail   - Return breakdown object instead of scalar
 * @returns {number|object}  - Total heat loss [W], or detail breakdown
 */
function computeRoomHeatLoss(room, params, detail = false) {
  const {
    uw, u_roof, u_ground, u_glass,
    tout, vcalc, vsys, v50,
    neighbourT, un, lir, wallHeight,
  } = params;

  const tin       = room.tin;
  const dT        = tin - tout;
  const floorArea = room.area;

  // --- Geometry (EN 12831 gross-area estimation from floor area) ---
  const e         = WALL_OFFSET;
  const gross     = floorArea + 4 * e * Math.sqrt(floorArea) + 4 * e * e;
  const side      = Math.sqrt(gross);

  const wallExt       = side * wallHeight * room.wallsExt;
  const wallNeighbour = side * wallHeight * (4 - room.wallsExt);
  const groundArea    = room.onGround   ? gross : 0;
  const roofArea      = room.underRoof  ? gross : 0;

  // Neighbour-adjacent floor/ceiling areas
  const neighbourFloor   = groundArea > 0 ? 0 : floorArea;
  const neighbourCeiling = roofArea   > 0 ? 0 : floorArea;

  // --- Transmission losses ---
  let transmission = (wallExt * (uw + BRIDGE_CORRECTION) +
                      roofArea * (u_roof + BRIDGE_CORRECTION)) * dT;

  transmission += groundArea * GROUND_FACTOR *
                  (u_ground + BRIDGE_CORRECTION) *
                  (tin - GROUND_TEMP);

  // Window fraction: assume 20% of external wall area has glazing
  const glazingFrac = room.wallsExt >= 1 ? (room.glazingPct/100 || 0) : 0;
  transmission += wallExt * glazingFrac * (u_glass - uw) * dT;

  // --- Ventilation losses ---
  const ventilation = _computeVentilation(room, params, dT, floorArea);

  // --- Infiltration losses ---
  const envelope      = wallExt + roofArea + groundArea;
  const infiltration  = INFILTRATION_FACTOR * lir * v50 * envelope * dT;

  // --- Neighbour losses ---
  const dTneighbour  = Math.max(0, tin - neighbourT);
  const neighbourLoss = un * dTneighbour *
                        (wallNeighbour + neighbourFloor + neighbourCeiling);

  // EN 12831: take max of ventilation and infiltration, then add rest
  const airLoss = Math.max(ventilation, infiltration);
  const total   = transmission + airLoss + neighbourLoss;

  if (detail) {
    return {
      totalHeatLoss:        Math.max(0, Math.round(total)),
      transmissionHeatLoss: Math.round(transmission),
      ventilationHeatLoss:  Math.round(ventilation),
      infiltrationHeatLoss: Math.round(infiltration),
      neighbourLosses:      Math.round(neighbourLoss),
    };
  }
  return Math.max(0, Math.round(total));
}

/**
 * Calculate ventilation heat loss [W] for one room.
 * Supports 'simple' ACH method and full 'NBN-D-50-001'.
 */
function _computeVentilation(room, params, dT, floorArea) {
  const { vcalc, vsys, wallHeight, neighbourT } = params;
  const tin = room.tin;

  if (vcalc === 'simple') {
    const ach = VENT_ACH[vsys] || 0.5;
    const vol = floorArea * wallHeight;
    return INFILTRATION_FACTOR * vol * ach * dT;
  }

  if (vcalc === 'NBN-D-50-001') {
    const b   = NBN_BOUNDS[room.type] || { min: 0, max: 150 };
    const nom = Math.min(Math.max(3.6 * floorArea, b.min), b.max);

    // Supply rooms receive outdoor air; extract rooms draw from neighbours
    const supplyRooms = ['Living', 'Bedroom', 'Study'];
    const dTneighbour = Math.max(0, tin - neighbourT);

    if (supplyRooms.includes(room.type)) {
      const outdoor = nom * (vsys === 'D' ? 0.3 : 1.0);
      return INFILTRATION_FACTOR * outdoor * dT;
    }
    // Extract rooms: heat loss through neighbour-temperature air transfer
    return INFILTRATION_FACTOR * nom * dTneighbour;
  }

  return 0; // Unknown method → zero
}

/**
 * Run heat-loss calculations for all rooms.
 * Returns an array of result objects matching state.roomResults format.
 *
 * @param {Array}  rooms   - state.roomData
 * @param {object} params  - envelope + ventilation parameters
 * @returns {Array}
 */
function computeAllRooms(rooms, params) {
  return rooms.map(r => {
    const res = computeRoomHeatLoss(r, params, /* detail= */ true);
    return {
      room:         r.name || `Room ${r.id}`,
      type:         r.type,
      totalHeatLoss:        res.totalHeatLoss,
      transmission:         res.transmissionHeatLoss,
      ventilation:          res.ventilationHeatLoss,
      infiltration:         res.infiltrationHeatLoss,
      neighbour:            res.neighbourLosses,
    };
  });
}
