/**
 * ui/navigation.js
 * ================
 * Tab navigation, design-mode selection, heat-loss mode toggling,
 * insulation presets, and general UI visibility callbacks.
 *
 * Mirrors: ui/callbacks/navigation.py
 */

// ---------------------------------------------------------------------------
//  Tab navigation
// ---------------------------------------------------------------------------

function goTab(n) {
  document.querySelectorAll('.tab-content').forEach((t, i) => {
    t.classList.toggle('active', i === n);
  });
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', i === n);
  });
  // Step indicator
  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i < n) s.classList.add('done');
    if (i === n) s.classList.add('active');
  });
  if (n === 3 && state.calcResults) renderResults();
}

// ---------------------------------------------------------------------------
//  Design mode  (Tab 0)
// ---------------------------------------------------------------------------

function selectMode(mode, el) {
  state.designMode = mode;

  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');

  document.getElementById('modeHelpText').innerHTML =
    `<strong>${el.querySelector('.mode-card-title').textContent}:</strong> ${MODE_HELP[mode]}`;

  // Pump card visibility in Tab 2
  document.getElementById('pumpSettingsCard').style.display =
    mode === MODE_PUMP ? 'block' : 'none';

  // Supply-temperature input: disabled for modes that auto-compute it
  document.getElementById('supplyTempInput').disabled =
    [MODE_EXISTING, MODE_PUMP, MODE_BALANCING].includes(mode);
}

// ---------------------------------------------------------------------------
//  Heat-loss mode  (Tab 0)
// ---------------------------------------------------------------------------

function selectHeatMode(mode, el) {
  state.heatMode = mode;
  document.querySelectorAll('.radio-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  updateHeatModeUI();
}

function updateHeatModeUI() {
  const known      = state.heatMode === 'known';
  const banner     = document.getElementById('heatModeBanner');
  const manualCard = document.getElementById('manualLossCard');
  const hideIds    = [
    'buildingEnvelopeCard', 'outdoorConditionsCard',
    'buildingInsulationCard', 'additionalSettingsCard', 'roomConfigCard',
  ];

  if (known) {
    banner.textContent = "Mode: 🔒 Heat load is KNOWN — enter per-room heat losses below.";
    banner.className   = 'alert alert-warn';
    manualCard.style.display = 'block';
    hideIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  } else {
    banner.textContent = "Mode: 🧮 Heat load is UNKNOWN — the tool will calculate room heat losses.";
    banner.className   = 'alert alert-secondary';
    manualCard.style.display = 'none';
    hideIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'block';
    });
  }
}

// ---------------------------------------------------------------------------
//  Insulation / glazing presets  (Tab 1)
// ---------------------------------------------------------------------------

function applyInsulationPreset() {
  const ws = document.getElementById('wallInsulationState').value;
  const rs = document.getElementById('roofInsulationState').value;
  const gs = document.getElementById('groundInsulationState').value;
  if (INSULATION_U[ws]) document.getElementById('uw').value     = INSULATION_U[ws].wall;
  if (INSULATION_U[rs]) document.getElementById('u_roof').value  = INSULATION_U[rs].roof;
  if (INSULATION_U[gs]) document.getElementById('u_ground').value = INSULATION_U[gs].ground;
  triggerHeatCalc();
}

function applyGlazingPreset() {
  const g = document.getElementById('glazingType').value;
  if (GLAZING_U[g]) document.getElementById('u_glass').value = GLAZING_U[g];
  triggerHeatCalc();
}

// ---------------------------------------------------------------------------
//  Tab 2 toggles
// ---------------------------------------------------------------------------

function updateValveUI() {
  const vt       = document.getElementById('valveType').value;
  const specsDiv = document.getElementById('valveSpecs');
  const customDiv = document.getElementById('valveCustomSettings');
  const cfg = VALVE_CATALOGUE[vt];

  if (cfg) {
    const kvArr = cfg.kv_values;
    specsDiv.textContent = `Positions: ${cfg.positions} | Kv range: ${kvArr[0]} – ${kvArr[kvArr.length-1]} m³/h`;
    customDiv.style.display = 'none';
    document.getElementById('valvePositions').value = cfg.positions;
    document.getElementById('valveKvMax').value     = kvArr[kvArr.length - 1];
  } else {
    specsDiv.textContent    = '';
    customDiv.style.display = 'block';
  }
}

function toggleFixedDiam() {
  const checked = document.getElementById('fixDiameter').checked;
  document.getElementById('fixedDiamContainer').style.display = checked ? 'block' : 'none';
}

// ---------------------------------------------------------------------------
//  Accordion widget
// ---------------------------------------------------------------------------

function toggleAccordion(btn) {
  btn.classList.toggle('open');
  btn.nextElementSibling.classList.toggle('open');
}

// ---------------------------------------------------------------------------
//  Help dialog
// ---------------------------------------------------------------------------

function showHelp() {
  alert(
    "Smart Heating Design Tool\n\n" +
    "Tab 0: Choose design mode and heat-loss mode.\n" +
    "Tab 1: Configure building envelope and rooms → heat losses calculated via EN 12831.\n" +
    "Tab 2: Enter radiator data, collector layout, valve type → Run Calculations.\n" +
    "Tab 3: View results, charts, valve balancing table.\n\n" +
    "Physics: EN 12831 heat loss · EN 442 radiator model · iterative hydraulic solver."
  );
}

// ---------------------------------------------------------------------------
//  Utility helpers shared across UI modules
// ---------------------------------------------------------------------------

/** Safe numeric read from an input element */
function getN(id, def) {
  const v = parseFloat(document.getElementById(id)?.value);
  return isNaN(v) ? def : v;
}

/** Safe string read from an input/select element */
function getS(id, def) {
  return document.getElementById(id)?.value || def;
}
