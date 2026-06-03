/**
 * ui/save_load.js
 * ===============
 * Save and open a complete calculator case as a JSON file.
 *
 * What is saved:
 *   - state.roomData, state.manualLossData, state.radiatorData, state.collectorData
 *   - state.heatMode, state.designMode
 *   - All form field values (envelope U-values, temperatures, valve settings, etc.)
 *
 * Usage:
 *   saveCase()  – downloads  <project-name>.htg.json
 *   openCase()  – opens a file picker and restores everything
 */

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** Collect every named/id'd input, select and textarea from the page. */
function _collectFormValues() {
  const values = {};
  document.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') {
      values[el.id] = el.checked;
    } else {
      values[el.id] = el.value;
    }
  });
  return values;
}

/** Re-apply saved form values, skipping table body inputs (rebuilt by render*). */
function _applyFormValues(values) {
  if (!values) return;
  Object.entries(values).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = !!val;
    } else {
      el.value = val;
    }
  });
}

// ---------------------------------------------------------------------------
//  Save
// ---------------------------------------------------------------------------

/**
 * Serialise the full application state + form values to a .htg.json file
 * and trigger a browser download.
 */
function saveCase() {
  const projectName = (document.getElementById('projectName')?.value || 'project').trim() || 'project';

  const payload = {
    _version:    1,
    _saved:      new Date().toISOString(),
    _appName:    'Heating Calculator',

    // --- mutable state ---
    heatMode:       state.heatMode,
    designMode:     state.designMode,
    roomData:       JSON.parse(JSON.stringify(state.roomData)),
    manualLossData: JSON.parse(JSON.stringify(state.manualLossData)),
    radiatorData:   JSON.parse(JSON.stringify(state.radiatorData)),
    collectorData:  JSON.parse(JSON.stringify(state.collectorData)),

    // --- form fields ---
    formValues: _collectFormValues(),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${projectName}.htg.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);

  _showToast(`✅ Case saved as "${projectName}.htg.json"`);
}

// ---------------------------------------------------------------------------
//  Open
// ---------------------------------------------------------------------------

/**
 * Opens a file-picker for .htg.json files and restores the full application
 * state.  All tables are rebuilt, heat calculations re-run automatically.
 */
function openCase() {
  const input    = document.createElement('input');
  input.type     = 'file';
  input.accept   = '.json,.htg.json';

  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        _restoreCase(JSON.parse(evt.target.result));
        _showToast(`📂 Loaded "${file.name}"`);
      } catch (err) {
        alert(`Failed to load case:\n${err.message}`);
        console.error(err);
      }
    };
    reader.readAsText(file);
  };

  input.click();
}

/**
 * Restore everything from a parsed payload object.
 */
function _restoreCase(p) {
  if (!p || p._appName !== 'Heating Calculator') {
    throw new Error('This file does not appear to be a Heating Calculator case.');
  }

  // 1. Restore state arrays
  state.heatMode       = p.heatMode       || 'unknown';
  state.designMode     = p.designMode     || MODE_EXISTING;
  state.roomData       = p.roomData       || [];
  state.manualLossData = p.manualLossData || [];
  state.radiatorData   = p.radiatorData   || [];
  state.collectorData  = p.collectorData  || [];
  state.calcResults    = null;   // results must be re-run

  // 2. Re-apply form values BEFORE rebuilding tables (so room count etc. is set)
  _applyFormValues(p.formValues);

  // 3. Rebuild UI — order matters: rooms first, then collectors/radiators
  updateHeatModeUI();
  renderRoomTable();
  renderManualTable();
  renderCollectorTable();
  renderRadiatorTable();
  renderHeatSplitTable();
  syncRoomDropdowns();

  // 4. Re-trigger valve UI so catalogue / custom panel shows correctly
  if (typeof updateValueUI === 'function') updateValueUI_safe();

  // 5. Re-run heat loss calculation
  runHeatCalc();

  // 6. Navigate to Tab 0 so the user sees the loaded state
  goTab(0);
}

/** Safe wrapper — updateValveUI may not be defined yet in some builds */
function updateValueUI_safe() {
  try { updateValueUI(); } catch (_) {}
}

// ---------------------------------------------------------------------------
//  Toast notification
// ---------------------------------------------------------------------------

function _showToast(message) {
  const existing = document.getElementById('_htgToast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = '_htgToast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    background: #2c3e50;
    color: #fff;
    padding: 10px 22px;
    border-radius: 8px;
    font-size: 14px;
    font-family: 'DM Sans', sans-serif;
    box-shadow: 0 4px 18px rgba(0,0,0,0.25);
    z-index: 99999;
    opacity: 0;
    transition: opacity 0.25s ease;
    pointer-events: none;
  `;

  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}