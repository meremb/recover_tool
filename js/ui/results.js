/**
 * ui/results.js
 * =============
 * Tab 3 rendering: metric cards, charts, and detailed results tables.
 * Pump curve chart removed — pump check is now a separate action in Tab 2.
 */

const chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

// ---------------------------------------------------------------------------
//  Main render entry point
// ---------------------------------------------------------------------------

function renderResults() {
  if (!state.calcResults) return;
  const {
    radResults, colResults, warnings,
    weightedDT, totalMFR, maxPressure,
    valveCfg, fixedSupplyT, deltaT,
  } = state.calcResults;

  _renderWarnings(warnings);
  _renderMetrics(radResults, totalMFR, weightedDT, maxPressure);
  _renderSummary(radResults, totalMFR, weightedDT, maxPressure, fixedSupplyT);
  _renderCharts(radResults, valveCfg);
  renderMergedResultsTable(radResults);
  renderCollectorResultsTable(colResults);
}

// ---------------------------------------------------------------------------
//  Warnings
// ---------------------------------------------------------------------------

function _renderWarnings(warnings) {
  const div = document.getElementById('resultsWarnings');

  const realWarnings = warnings.filter(w => w.message);

  if (realWarnings.length) {

    div.innerHTML = realWarnings.map(w => {

      let color, bg;

      switch (w.level) {
        case 1:
          color = '#856404';
          bg = '#fff3cd';
          break;
        case 2:
          color = '#8a4b00';
          bg = '#ffe5cc';
          break;
        case 3:
          color = '#721c24';
          bg = '#f8d7da';
          break;
        default:
          color = '#555';
          bg = '#eee';
      }

      return `
        <div style="
          border-left:5px solid ${color};
          background:${bg};
          padding:8px;
          margin-bottom:6px;
          border-radius:4px;
        ">
          ${w.message}
        </div>`;
    }).join('');

    div.style.display = 'block';

  } else {
    div.style.display = 'none';
  }
}

// ---------------------------------------------------------------------------
//  Metric cards
// ---------------------------------------------------------------------------

function _renderMetrics(radResults, totalMFR, weightedDT, maxPressure) {
  const totalHL       = radResults.reduce((s, r) => s + r.heatLoss, 0);
  const totalPow      = radResults.reduce((s, r) => s + r.qNom, 0);
  const highestSupply = radResults.length ? Math.max(...radResults.map(r => r.supplyT)) : 0;

  document.getElementById('mTotalHeatLoss').textContent  = totalHL + ' W';
  document.getElementById('mTotalPower').textContent     = totalPow + ' W';
  document.getElementById('mFlowRate').textContent       = Math.round(totalMFR * 10) / 10 + ' kg/h';
  document.getElementById('mDeltaT').textContent         = Math.round(weightedDT * 10) / 10 + ' °C';
  document.getElementById('mHighestSupply').textContent  = highestSupply + ' °C';
  document.getElementById('mMaxPressure').textContent    = Math.round(maxPressure) + ' Pa';  // totalPressureValveCircuit max
}

// ---------------------------------------------------------------------------
//  Summary bar
// ---------------------------------------------------------------------------

function _renderSummary(radResults, totalMFR, weightedDT, maxPressure, fixedSupplyT) {
  const totalHL       = radResults.reduce((s, r) => s + r.heatLoss, 0);
  const totalPow      = radResults.reduce((s, r) => s + r.qNom, 0);
  const totalExtraPow = radResults.reduce((s, r) => s + (r.extraPower || 0), 0);
  const modeLabel     = fixedSupplyT !== null
    ? `LT Dimensioning (${fixedSupplyT} °C)`
    : 'Existing System';

  let html = `<strong>Mode:</strong> ${modeLabel} &nbsp;|&nbsp;
    Heat loss: <strong>${totalHL} W</strong> &nbsp;|&nbsp;
    Radiator power: <strong>${totalPow} W</strong> &nbsp;|&nbsp;
    Flow: <strong>${Math.round(totalMFR)} kg/h</strong> &nbsp;|&nbsp;
    Weighted ΔT: <strong>${Math.round(weightedDT * 10) / 10} °C</strong> &nbsp;|&nbsp;
    Sys. pressure: <strong>${Math.round(maxPressure)} Pa</strong>`;

  if (fixedSupplyT !== null && totalExtraPow > 0)
    html += ` &nbsp;|&nbsp; ⚠️ Extra power needed: <strong>${Math.round(totalExtraPow)} W</strong>`;

  document.getElementById('summaryMetrics').innerHTML = html;
}

// ---------------------------------------------------------------------------
//  Charts
// ---------------------------------------------------------------------------

function _renderCharts(radResults, valveCfg) {
  const labels = radResults.map(r => `Rad ${r.id} (${r.room})`);
  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top' } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
  };

  // 1. Power distribution
  destroyChart('chartPower');
  chartInstances['chartPower'] = new Chart(document.getElementById('chartPower'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Heat Loss (W)', data: radResults.map(r => r.heatLoss),
        backgroundColor: 'rgba(192,57,43,.75)', borderRadius: 4 },
      { label: 'Radiator Power 75/65/20 (W)', data: radResults.map(r => r.qNom),
        backgroundColor: 'rgba(41,128,185,.45)', borderRadius: 4 },
      { label: 'Electric power (W)', data: radResults.map(r => r.elec),
        backgroundColor: 'rgba(192, 182, 43, 0.75)', borderRadius: 4 },
      ...(state.designMode === MODE_FIXED
        ? [{ label: 'Extra Power 75/65/20 (W)', data: radResults.map(r => r.extraPower || 0),
             backgroundColor: 'rgba(230,126,34,.75)', borderRadius: 4 }]
        : []),
    ]},
    options: barOpts,
  });

  // 2. Temperature profile
  destroyChart('chartTemp');
  chartInstances['chartTemp'] = new Chart(document.getElementById('chartTemp'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Supply T (°C)', data: radResults.map(r => r.supplyT),
        backgroundColor: 'rgba(231,76,60,.7)', borderRadius: 4 },
      { label: 'Return T (°C)', data: radResults.map(r => r.returnT),
        backgroundColor: 'rgba(52,152,219,.7)', borderRadius: 4 },
    ]},
    options: { ...barOpts, scales: { x: { grid: { display: false } }, y: { beginAtZero: false } } },
  });

  // 3. Pressure loss
  destroyChart('chartPressure');
  chartInstances['chartPressure'] = new Chart(document.getElementById('chartPressure'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Pipe Loss (Pa)', data: radResults.map(r => r.pipeLoss),
        backgroundColor: 'rgba(155,89,182,.7)', borderRadius: 4 },
      { label: 'Valve Loss N (Pa)', data: radResults.map(r => r.valvePressureLossN),
        backgroundColor: 'rgba(230,126,34,.7)', borderRadius: 4 },
      { label: 'Total Pressure Valve Circuit (Pa)', data: radResults.map(r => r.totalPressureValveCircuit),
        backgroundColor: 'rgba(41,128,185,.3)', borderRadius: 4 },
    ]},
    options: barOpts,
  });

  // 4. Mass flow rate
  destroyChart('chartFlow');
  chartInstances['chartFlow'] = new Chart(document.getElementById('chartFlow'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Mass Flow (kg/h)', data: radResults.map(r => r.mfr),
        backgroundColor: 'rgba(26,188,156,.7)', borderRadius: 4 },
    ]},
    options: barOpts,
  });

  // 5. Valve positions
  destroyChart('chartValve');
  const maxPos = valveCfg ? valveCfg.positions
    : parseInt(document.getElementById('valvePositions').value) || 8;
  chartInstances['chartValve'] = new Chart(document.getElementById('chartValve'), {
    type: 'bar',
    data: {
      labels: radResults.map(r => `Rad ${r.id}`),
      datasets: [{
        label: 'Valve Position',
        data: radResults.map(r => r.valvePos),
        backgroundColor: radResults.map(r => {
          const ratio = (r.valvePos) / maxPos;
          if (ratio >= 0.9) return 'rgba(231,76,60,.7)';
          if (ratio >= 0.6) return 'rgba(230,126,34,.7)';
          return 'rgba(46,204,113,.7)';
        }),
        borderRadius: 4,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } },
                y: { beginAtZero: true, max: maxPos,
                     title: { display: true, text: 'Position' } } } },
  });
}

// ---------------------------------------------------------------------------
//  Detailed results tables
// ---------------------------------------------------------------------------

function renderMergedResultsTable(radResults) {
  const wrap     = document.getElementById('mergedResultsWrap');
  const isFixed  = state.designMode === MODE_FIXED;
  const hasActual = radResults[0]?.actualOutput !== undefined;
  const maxPos   = state.calcResults?.valveCfg
    ? state.calcResults.valveCfg.positions
    : parseInt(document.getElementById('valvePositions').value) || 8;

  const cols = [
    '#', 'Room', 'Collector', 'Heat Loss (W)', 'Nom Power (W)',
    ...(isFixed ? ['Extra Power (W)'] : ['q-ratio']),
    'Supply T (°C)', 'Return T (°C)',
    ...(hasActual ? ['Actual Output (W)'] : []),
    'Flow (kg/h)', 'Diam (mm)', 'Pipe Loss (Pa)', 'Valve Loss N (Pa)',
    'Total Pressure Loss (Pa)', 'Total Pressure Valve Circuit (Pa)', 'Pressure Diff Valve (Pa)',
    'Velocity (m/s)', 'Valve Pos', 'Valve kv', 'Kv needed',
  ];

  let html = `<table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;

  radResults.forEach(r => {
    const velBadge = r.velocity > 0.5
      ? `<span class="badge badge-red">${r.velocity}</span>` : r.velocity;
    const posFrac  = (r.valvePos) / maxPos;
    const posBadge = posFrac > 0.85
      ? `<span class="badge badge-warn">${r.valvePos}</span>` : `${r.valvePos}`;
    const diamDisplay = r.diamFixed
      ? `<span class="badge badge-warn" title="User-fixed diameter">${r.diam} mm ★</span>`
      : `${r.diam} mm`;
    const epBadge = r.extraPower > 0
      ? `<span class="badge badge-red">${r.extraPower}</span>` : (r.extraPower || 0);

    html += `<tr>
      <td>${r.id}</td><td>${r.room}</td><td>${r.collector}</td>
      <td>${r.heatLoss}</td><td>${r.qNom}</td>
      <td>${isFixed ? epBadge : r.qRatio}</td>
      <td>${r.supplyT}</td><td>${r.returnT}</td>
      ${hasActual ? `<td>${r.actualOutput}</td>` : ''}
      <td>${r.mfr}</td><td>${diamDisplay}</td>
      <td>${r.pipeLoss}</td><td>${r.valvePressureLossN}</td>
      <td>${r.totalPressureLoss}</td><td>${r.totalPressureValveCircuit}</td><td>${r.pressureDifferenceValve}</td>
      <td>${velBadge}</td>
      <td>${posBadge}</td><td>${r.valveKv != null ? r.valveKv : '—'}</td><td>${r.kvNeeded || '—'}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function renderCollectorResultsTable(colResults) {
  const wrap = document.getElementById('collectorResultsWrap');
  const cols = ['Collector', 'Flow (kg/h)', 'Diam (mm)', 'Pipe Loss (Pa)', 'Collector Loss (Pa)', 'Total Loss (Pa)'];
  let html = `<table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
  colResults.forEach(c => {
    html += `<tr>
      <td>${c.name}</td><td>${Math.round(c.mfr)}</td><td>${c.diam}</td>
      <td>${c.pipeLoss}</td><td>${c.colLoss}</td><td>${c.totalLoss}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}