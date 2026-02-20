/**
 * state.js
 * ========
 * Single source of truth for all mutable application data.
 * All modules read from and write to this object.
 * Mirrors the dcc.Store components in the original Dash app.
 */

const state = {
  // --- Tab 0: mode selections ---
  designMode: MODE_EXISTING,   // 'existing' | 'fixed' | 'pump' | 'balancing'
  heatMode:   'unknown',       // 'unknown' | 'known'

  // --- Tab 1: room definitions ---
  roomData: [],          // [{ id, tin, area, wallsExt, type, onGround, underRoof }]
  manualLossData: [],    // [{ id, loss }]  — used when heatMode === 'known'
  roomResults: [],       // [{ room, totalHeatLoss, transmission, ventilation, infiltration, neighbour }]

  // --- Tab 2: radiator & collector definitions ---
  radiatorData: [],      // [{ id, room, collector, power, length, elec }]
  collectorData: [],     // [{ id, name, length }]

  // --- Tab 3: computation results ---
  calcResults: null,     // full result object — see services/calculator.js
  valveOverrides: {},    // { radiatorId: valvePosition }
};
