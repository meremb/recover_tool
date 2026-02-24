/**
 * ui/hydraulics.js
 * ================
 * Tab 2 UI: radiator table, collector table, heat-loss split preview,
 * and the main "Run Calculations" trigger.
 *
 * Mirrors: ui/callbacks/hydraulics.py
 */

// ---------------------------------------------------------------------------
//  Collector table
// ---------------------------------------------------------------------------

function rebuildCollectorTable() {
  const n = Math.max(1, parseInt(document.getElementById('numCollectors').value) || 1);

  while (state.collectorData.length < n) {
    const i = state.collectorData.length + 1;
    state.collectorData.push({ id: i, name: `Collector ${i}`, length: 5 });
  }
  state.collectorData = state.collectorData.slice(0, n);

  renderCollectorTable();
  rebuildRadiatorTable(); // radiator dropdowns depend on collector list
}

function renderCollectorTable() {
  const tbody = document.getElementById('collectorTableBody');
  tbody.innerHTML = '';

  state.collectorData.forEach((c, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.name}</td>
      <td class="editable-cell">
        <input type="number" value="${c.length}" min="0.5" step="0.5"
          onchange="state.collectorData[${i}].length=parseFloat(this.value)||5"/>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------------------------
//  Radiator table
// ---------------------------------------------------------------------------

function getCollectorNames() {
  return state.collectorData.map(c => c.name);
}

function getRoomLabels() {
  // Use the actual room names — these are the keys used throughout state.roomResults
  if (state.heatMode === 'known') {
    return state.manualLossData.map((r, i) => state.roomData[i]?.name || `Room ${r.id}`);
  }
  return state.roomData.map(r => r.name || `Room ${r.id}`);
}

function rebuildRadiatorTable() {
  const n         = Math.max(1, parseInt(document.getElementById('numRadiators').value) || 3);
  const cols      = getCollectorNames();
  const defCol    = cols[0] || 'Collector 1';

  while (state.radiatorData.length < n) {
    const i = state.radiatorData.length + 1;
    state.radiatorData.push({
      id: i, room: '', collector: defCol, power: 2000, length: 10, elec: 0,
    });
  }
  state.radiatorData = state.radiatorData.slice(0, n);

  renderRadiatorTable();
  renderHeatSplitTable();
}

function renderRadiatorTable() {
  const tbody     = document.getElementById('radiatorTableBody');
  tbody.innerHTML = '';
  const rooms      = getRoomLabels();
  const collectors = getCollectorNames();

  state.radiatorData.forEach((r, i) => {
    const roomOpts = rooms.map(rm =>
      `<option value="${rm}"${rm === r.room ? ' selected' : ''}>${rm}</option>`
    ).join('');
    const colOpts = collectors.map(c =>
      `<option value="${c}"${c === r.collector ? ' selected' : ''}>${c}</option>`
    ).join('');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.id}</td>
      <td class="editable-cell">
        <select onchange="state.radiatorData[${i}].room=this.value;renderHeatSplitTable()">
          <option value="">— select —</option>${roomOpts}
        </select>
      </td>
      <td class="editable-cell">
        <select onchange="state.radiatorData[${i}].collector=this.value">
          ${colOpts}
        </select>
      </td>
      <td class="editable-cell">
        <input type="number" value="${r.power}" min="100" step="50"
          onchange="state.radiatorData[${i}].power=parseFloat(this.value)||2000"/>
      </td>
      <td class="editable-cell">
        <input type="number" value="${r.length}" min="1" step="0.5"
          onchange="state.radiatorData[${i}].length=parseFloat(this.value)||10"/>
      </td>
      <td class="editable-cell">
        <input type="number" value="${r.elec}" min="0" step="10"
          onchange="state.radiatorData[${i}].elec=parseFloat(this.value)||0"/>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/** Sync room dropdowns in Tab 2 whenever rooms change in Tab 1 */
function syncRoomDropdowns() {
  renderRadiatorTable();
  renderHeatSplitTable();
}

// ---------------------------------------------------------------------------
//  Heat-loss split preview table
// ---------------------------------------------------------------------------

function renderHeatSplitTable() {
  const wrap = document.getElementById('heatSplitTableWrap');

  // Create a map of room names to their heat loss and radiator count
  const lossMap = {};
  const radiatorCountMap = {};

  // Populate the maps with room data
  state.roomResults.forEach(r => {
    lossMap[r.room] = r.totalHeatLoss;
  });

  // Count radiators per room
  state.radiatorData.forEach(r => {
    if (r.room) {
      radiatorCountMap[r.room] = (radiatorCountMap[r.room] || 0) + 1;
    }
  });

  let html = `<table><thead><tr>
    <th>Radiator #</th><th>Room</th><th>Calculated Heat Loss (W)</th>
  </tr></thead><tbody>`;

  state.radiatorData.forEach(r => {
    // Calculate the split heat loss for each radiator in the room
    const room = r.room;
    const totalLoss = lossMap[room];
    const radiatorCount = radiatorCountMap[room] || 1;
    const splitLoss = room && totalLoss !== undefined ? Math.round(totalLoss / radiatorCount) : '—';


    html += `<tr><td>${r.id}</td><td>${room || '—'}</td><td>${splitLoss}</td></tr>`;
  });

  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

// ---------------------------------------------------------------------------
//  Run Calculations  (main orchestrator — calls services/calculator.js)
// ---------------------------------------------------------------------------

function runCalculations() {
  if (!state.roomResults.length) {
    alert('Please calculate heat losses first (Tab 1).');
    return;
  }
  if (!state.radiatorData.length) {
    alert('Please add at least one radiator in Tab 2.');
    return;
  }

  // Collect all UI inputs
  const deltaT     = getN('deltaT', 10);
  const supplyVal  = document.getElementById('supplyTempInput').value;
  let fixedSupplyT = (supplyVal && supplyVal.trim() !== '') ? parseFloat(supplyVal) : null;

  // Disable supply-T for auto-compute modes
  if ([MODE_EXISTING, MODE_BALANCING].includes(state.designMode)) fixedSupplyT = null;

  const fixDiam      = document.getElementById('fixDiameter').checked;
  const fixedDiamVal = fixDiam ? parseFloat(document.getElementById('fixedDiamValue').value) : null;
  const valveType    = document.getElementById('valveType').value;
  const valveCfg     = VALVE_CATALOGUE[valveType] || null;
  const nPositions   = parseInt(document.getElementById('valvePositions').value) || 8;
  const kvMax        = parseFloat(document.getElementById('valveKvMax').value) || 0.7;
  const pumpModel    = document.getElementById('pumpModel').value;
  const pumpSpeed    = document.getElementById('pumpSpeed').value;
  const pumpCurvePoints = PUMP_LIBRARY[pumpModel]?.[pumpSpeed] || [];

  // Build room maps — key is room name (matches state.roomResults[].room)
  const lossMap = {}, tinMap = {};
  state.roomResults.forEach(r => { lossMap[r.room] = r.totalHeatLoss; });
  if (state.heatMode === 'known') {
    state.manualLossData.forEach((r, i) => {
      const name = state.roomData[i]?.name || `Room ${r.id}`;
      tinMap[name] = 20;
    });
  } else {
    state.roomData.forEach(r => { tinMap[r.name || `Room ${r.id}`] = r.tin; });
  }

  // Delegate all physics to services/calculator.js
  state.calcResults = runFullCalculation({
    deltaT, fixedSupplyT, fixedDiamVal,
    valveCfg, kvMax, nPositions,
    pumpCurvePoints, valveType,
    lossMap, tinMap,
  });

  state.valveOverrides = {};
  renderValveBalancingTable(state.calcResults.radResults);
  goTab(3);
  renderResults();
}
