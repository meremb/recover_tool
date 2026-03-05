/**
 * state.js
 * ========
 * Single source of truth for all mutable application data.
 */

const state = {
  // --- Mode: determined by whether supplyTempInput has a value ---
  // 'existing' = auto-compute required supply T from current radiators
  // 'fixed'    = user-supplied supply T → compute extra power needed
  designMode: MODE_EXISTING,

  heatMode: 'unknown',       // 'unknown' | 'known'

  // --- Tab 1: room definitions ---
  roomData: [],
  manualLossData: [],
  roomResults: [],

  // --- Tab 2: radiator & collector definitions ---
  radiatorData: [],
  collectorData: [],

  // --- Tab 3: computation results ---
  calcResults: null,
};
