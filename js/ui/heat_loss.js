/**
 * ui/heat_loss.js
 * ===============
 * Callbacks for Tab 1: room table building, manual loss table,
 * heat-loss computation trigger, and results rendering.
 *
 * Mirrors: ui/callbacks/heat_loss.py
 */

// ---------------------------------------------------------------------------
//  Room table
// ---------------------------------------------------------------------------

// Default room names based on index
const DEFAULT_ROOM_NAMES = [
  'Living Room', 'Kitchen', 'Master Bedroom', 'Bedroom 2',
  'Bedroom 3', 'Bathroom', 'Toilet', 'Hallway', 'Study', 'Laundry',
];

function defaultRoomName(i) {
  return DEFAULT_ROOM_NAMES[i - 1] || `Room ${i}`;
}

function rebuildRoomTable() {
  const n = Math.max(1, parseInt(document.getElementById('numRooms').value) || 3);

  // Grow
  while (state.roomData.length < n) {
    const i = state.roomData.length + 1;
    state.roomData.push({
      id: i, name: defaultRoomName(i),
      tin: 20, area: 10, wallsExt: 2,
      type: 'Living', onGround: false, underRoof: false,
    });
  }
  // Trim
  state.roomData = state.roomData.slice(0, n);

  // Keep manual loss table in sync (shares name from roomData)
  while (state.manualLossData.length < n) {
    const i = state.manualLossData.length + 1;
    state.manualLossData.push({ id: i, loss: 0 });
  }
  state.manualLossData = state.manualLossData.slice(0, n);

  renderRoomTable();
  renderManualTable();
  triggerHeatCalc();
  syncRoomDropdowns(); // update Tab 2 room dropdowns
}

function renderRoomTable() {
  const tbody = document.getElementById('roomTableBody');
  tbody.innerHTML = '';

  state.roomData.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-muted" style="font-size:11px;padding:6px 10px">${r.id}</td>
      <td class="editable-cell">
        <input type="text" value="${r.name}" placeholder="e.g. Living Room"
          style="min-width:130px"
          onchange="
            state.roomData[${i}].name=this.value.trim()||'Room ${r.id}';
            syncRoomDropdowns();
            triggerHeatCalc();
          "/>
      </td>
      <td class="editable-cell">
        <input type="number" value="${r.tin}" min="10" max="24" step="0.5"
          onchange="state.roomData[${i}].tin=Math.min(24,Math.max(10,parseFloat(this.value)||20));triggerHeatCalc()"/>
      </td>
      <td class="editable-cell">
        <input type="number" value="${r.area}" min="1" step="0.5"
          onchange="state.roomData[${i}].area=parseFloat(this.value)||10;triggerHeatCalc()"/>
      </td>
      <td class="editable-cell">
        <select onchange="state.roomData[${i}].wallsExt=parseInt(this.value);triggerHeatCalc()">
            <option value="0"${r.wallsExt === 0 ? ' selected' : ''}>0%</option>
            <option value="1"${r.wallsExt === 1 ? ' selected' : ''}>25%</option>
            <option value="2"${r.wallsExt === 2 ? ' selected' : ''}>50%</option>
            <option value="3"${r.wallsExt === 3 ? ' selected' : ''}>75%</option>
            <option value="4"${r.wallsExt === 4 ? ' selected' : ''}>100%</option>
        </select>
      </td>
      <td class="editable-cell">
        <select onchange="state.roomData[${i}].type=this.value;triggerHeatCalc()">
          ${ROOM_TYPES.map(t => `<option value="${t}"${t===r.type?' selected':''}>${t}</option>`).join('')}
        </select>
      </td>
      <td class="editable-cell">
        <select onchange="state.roomData[${i}].onGround=this.value==='true';triggerHeatCalc()">
          <option value="false"${!r.onGround?' selected':''}>No</option>
          <option value="true"${r.onGround?' selected':''}>Yes</option>
        </select>
      </td>
      <td class="editable-cell">
        <select onchange="state.roomData[${i}].underRoof=this.value==='true';triggerHeatCalc()">
          <option value="false"${!r.underRoof?' selected':''}>No</option>
          <option value="true"${r.underRoof?' selected':''}>Yes</option>
        </select>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderManualTable() {
  const tbody = document.getElementById('manualTableBody');
  tbody.innerHTML = '';

  state.manualLossData.forEach((r, i) => {
    const name = state.roomData[i]?.name || `Room ${r.id}`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${name}</td>
      <td class="editable-cell">
        <input type="number" value="${r.loss}" min="0" step="10"
          onchange="state.manualLossData[${i}].loss=parseFloat(this.value)||0;triggerHeatCalc()"/>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------------------------
//  Heat loss calculation trigger  (debounced)
// ---------------------------------------------------------------------------

let _heatCalcTimer = null;

function triggerHeatCalc() {
  clearTimeout(_heatCalcTimer);
  _heatCalcTimer = setTimeout(runHeatCalc, 200);
}

function runHeatCalc() {
  const params = {
    uw:         getN('uw',          0.6),
    u_roof:     getN('u_roof',      0.4),
    u_ground:   getN('u_ground',    0.5),
    u_glass:    getN('u_glass',     2.8),
    tout:       getN('tout',       -7.0),
    vcalc:      getS('ventCalcMethod', 'simple'),
    vsys:       getS('vSystem',     'C'),
    v50:        getN('v50',         6.0),
    neighbourT: getN('neighbourT', 18.0),
    un:         getN('un',          1.0),
    lir:        getN('lir',         0.2),
    wallHeight: getN('wallHeight',  2.7),
  };

  if (state.heatMode === 'known') {
    state.roomResults = state.manualLossData.map((r, i) => ({
      room: state.roomData[i]?.name || `Room ${r.id}`,
      totalHeatLoss: r.loss,
    }));
  } else {
    state.roomResults = computeAllRooms(state.roomData, params);
  }

  renderRoomResults();
  renderHeatSplitTable();
}

// ---------------------------------------------------------------------------
//  Results display
// ---------------------------------------------------------------------------

function renderRoomResults() {
  const wrap  = document.getElementById('roomResultsTableWrap');
  const known = state.heatMode === 'known';

  if (!state.roomResults.length) {
    wrap.innerHTML = '<div class="text-muted" style="padding:20px;text-align:center">No rooms defined.</div>';
    return;
  }

  const cols = known
    ? ['Room Name', 'Total Heat Loss (W)']
    : ['Room Name', 'Total Heat Loss (W)', 'Transmission (W)', 'Ventilation (W)', 'Infiltration (W)', 'Neighbour (W)'];

  let html = `<table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;

  state.roomResults.forEach(r => {
    if (known) {
      html += `<tr><td><strong>${r.room}</strong></td><td><strong>${r.totalHeatLoss}</strong></td></tr>`;
    } else {
      html += `<tr>
        <td><strong>${r.room}</strong></td>
        <td><strong>${r.totalHeatLoss}</strong></td>
        <td>${r.transmission  || 0}</td>
        <td>${r.ventilation   || 0}</td>
        <td>${r.infiltration  || 0}</td>
        <td>${r.neighbour     || 0}</td>
      </tr>`;
    }
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}
