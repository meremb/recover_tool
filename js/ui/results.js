/**
 * ui/results.js
 * =============
 * Tab 3 rendering: metric cards, six Chart.js charts, detailed results
 * tables, and the valve-balancing table with override/re-solve support.
 *
 * Mirrors: ui/callbacks/hydraulics.py  (results portion)
 *          ui/callbacks/valve.py       (balancing section)
 */

// ---------------------------------------------------------------------------
//  Chart instance registry
// ---------------------------------------------------------------------------
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
    pumpCurvePoints, valveCfg, fixedSupplyT, deltaT,
  } = state.calcResults;

  _renderWarnings(warnings);
  _renderMetrics(radResults, totalMFR, weightedDT);
  _renderSummary(radResults, totalMFR, weightedDT, maxPressure);
  _renderCharts(radResults, pumpCurvePoints, totalMFR, maxPressure, valveCfg);
  _renderBalancingSection();
  renderMergedResultsTable(radResults);
  renderCollectorResultsTable(colResults);
}

// ---------------------------------------------------------------------------
//  Warnings
// ---------------------------------------------------------------------------

function _renderWarnings(warnings) {
  const div = document.getElementById('resultsWarnings');
  if (warnings && warnings.length) {
    div.innerHTML = warnings.map(w => `⚠️ ${w}`).join('<br/>');
    div.style.display = 'block';
  } else {
    div.style.display = 'none';
  }
}

// ---------------------------------------------------------------------------
//  Metric cards
// ---------------------------------------------------------------------------

function _renderMetrics(radResults, totalMFR, weightedDT) {
  const totalHL      = radResults.reduce((s, r) => s + r.heatLoss, 0);
  const totalPow     = radResults.reduce((s, r) => s + r.qNom, 0);
  const highestSupply = radResults.length ? Math.max(...radResults.map(r => r.supplyT)) : 0;

  document.getElementById('mTotalHeatLoss').textContent  = totalHL + ' W';
  document.getElementById('mTotalPower').textContent     = totalPow + ' W';
  document.getElementById('mFlowRate').textContent       = Math.round(totalMFR * 10) / 10 + ' kg/h';
  document.getElementById('mDeltaT').textContent         = Math.round(weightedDT * 10) / 10 + ' °C';
  document.getElementById('mHighestSupply').textContent  = highestSupply + ' °C';
}

// ---------------------------------------------------------------------------
//  Summary bar
// ---------------------------------------------------------------------------

function _renderSummary(radResults, totalMFR, weightedDT, maxPressure) {
  const totalHL         = radResults.reduce((s, r) => s + r.heatLoss, 0);
  const totalPow        = radResults.reduce((s, r) => s + r.qNom, 0);
  const totalExtraPow   = radResults.reduce((s, r) => s + (r.extraPower || 0), 0);
  const modeLabel = {
    existing: 'Existing System', fixed: 'LT Dimensioning',
    pump: 'Pump-Based', balancing: 'Balancing',
  }[state.designMode] || '';

  let html = `<strong>Mode:</strong> ${modeLabel} &nbsp;|&nbsp;
    Heat loss: <strong>${totalHL} W</strong> &nbsp;|&nbsp;
    Radiator power: <strong>${totalPow} W</strong> &nbsp;|&nbsp;
    Flow: <strong>${Math.round(totalMFR)} kg/h</strong> &nbsp;|&nbsp;
    Weighted ΔT: <strong>${Math.round(weightedDT * 10) / 10} °C</strong> &nbsp;|&nbsp;
    Sys. pressure: <strong>${Math.round(maxPressure)} Pa</strong>`;

  if (state.designMode === MODE_FIXED && totalExtraPow > 0)
    html += ` &nbsp;|&nbsp; ⚠️ Extra power needed: <strong>${Math.round(totalExtraPow)} W</strong>`;

  document.getElementById('summaryMetrics').innerHTML = html;
}

// ---------------------------------------------------------------------------
//  Charts
// ---------------------------------------------------------------------------

function _renderCharts(radResults, pumpCurvePoints, totalMFR, maxPressure, valveCfg) {
  const labels = radResults.map(r => `Rad ${r.id} (${r.room})`);
  const barOpts = { responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top' } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } };

  // 1. Power distribution
  destroyChart('chartPower');
  chartInstances['chartPower'] = new Chart(document.getElementById('chartPower'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Heat Loss (W)', data: radResults.map(r => r.heatLoss),
        backgroundColor: 'rgba(192,57,43,.75)', borderRadius: 4 },
      { label: 'Radiator Power (W)', data: radResults.map(r => r.qNom),
        backgroundColor: 'rgba(41,128,185,.45)', borderRadius: 4 },
      ...(state.designMode === MODE_FIXED
        ? [{ label: 'Extra Power (W)', data: radResults.map(r => r.extraPower || 0),
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
      { label: 'Valve Loss (Pa)', data: radResults.map(r => r.valveLoss),
        backgroundColor: 'rgba(230,126,34,.7)', borderRadius: 4 },
      { label: 'Total Circuit (Pa)', data: radResults.map(r => r.totalCircuitLoss),
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

  // 5. Pump vs system curve
  _renderPumpChart(pumpCurvePoints, totalMFR, maxPressure);

  // 6. Valve positions
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
                y: { beginAtZero: true, max: maxPos, title: { display: true, text: 'Position' } } } },
  });
}

function _renderPumpChart(pumpCurvePoints, totalMFR, maxPressure) {
  destroyChart('chartPump');
  const qArr = [];
  for (let q = 0; q <= 2000; q += 25) qArr.push(q);

  const pumpHead = qArr.map(q => interpolatePump(pumpCurvePoints, q));

  const K       = totalMFR > 0 ? maxPressure / (totalMFR * totalMFR) : 0;
  const sysHead = qArr.map(q => K * q * q / 1000);

  // Find operating point
  let opQ = null, opH = null;
  for (let i = 0; i < qArr.length - 1; i++) {
    const p0 = pumpHead[i], p1 = pumpHead[i + 1];
    if (p0 === null || p1 === null) continue;
    const s0 = maxPressure / 1000 * Math.pow(qArr[i]   / Math.max(totalMFR, 1), 2);
    const s1 = maxPressure / 1000 * Math.pow(qArr[i+1] / Math.max(totalMFR, 1), 2);
    if ((p0 - s0) * (p1 - s1) <= 0) {
      opQ = (qArr[i] + qArr[i + 1]) / 2;
      opH = (p0 + p1) / 2;
      break;
    }
  }

  chartInstances['chartPump'] = new Chart(document.getElementById('chartPump'), {
    type: 'line',
    data: { labels: qArr, datasets: [
      { label: 'Pump Curve (kPa)', data: pumpHead,
        borderColor: 'rgba(41,128,185,1)', backgroundColor: 'rgba(41,128,185,.1)',
        tension: 0.3, pointRadius: 0, fill: true },
      { label: 'System Curve (kPa)', data: sysHead,
        borderColor: 'rgba(231,76,60,1)', backgroundColor: 'rgba(231,76,60,.05)',
        tension: 0.3, pointRadius: 0 },
      ...(opQ ? [{ label: 'Operating Point',
        data: [{ x: opQ, y: opH }], type: 'scatter',
        pointStyle: 'crossRot', pointRadius: 12,
        borderColor: '#e74c3c', backgroundColor: '#e74c3c' }] : []),
    ]},
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { title: { display: true, text: 'Flow (kg/h)' }, grid: { display: false } },
        y: { title: { display: true, text: 'Head (kPa)' }, beginAtZero: true },
      } },
  });
}

// ---------------------------------------------------------------------------
//  Detailed results tables
// ---------------------------------------------------------------------------

function renderMergedResultsTable(radResults) {
  const wrap    = document.getElementById('mergedResultsWrap');
  const isFixed = state.designMode === MODE_FIXED;
  const hasActual = radResults[0]?.actualOutput !== undefined;
  const maxPos  = state.calcResults?.valveCfg
    ? state.calcResults.valveCfg.positions
    : parseInt(document.getElementById('valvePositions').value) || 8;

  const cols = [
    '#', 'Room', 'Collector', 'Heat Loss (W)', 'Nom Power (W)',
    ...(isFixed ? ['Extra Power (W)'] : ['q-ratio']),
    'Supply T (°C)', 'Return T (°C)',
    ...(hasActual ? ['Actual Output (W)'] : []),
    'Flow (kg/h)', 'Diam (mm)', 'Pipe Loss (Pa)', 'Valve Loss (Pa)',
    'Total ΔP (Pa)', 'Velocity (m/s)', 'Valve Pos', 'Kv needed',
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
      <td>${r.pipeLoss}</td><td>${r.valveLoss}</td>
      <td>${r.totalCircuitLoss}</td><td>${velBadge}</td>
      <td>${posBadge}</td><td>${r.kvNeeded || '—'}</td>
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

// ---------------------------------------------------------------------------
//  Valve balancing section
// ---------------------------------------------------------------------------

function _renderBalancingSection() {
  const isBalancing = state.designMode === MODE_BALANCING;
  document.getElementById('valveBalancingSection').style.display = isBalancing ? 'block' : 'none';
}

function renderValveBalancingTable(radResults) {
  const tbody     = document.getElementById('valveBalancingBody');
  tbody.innerHTML = '';

  radResults.forEach(r => {
    const override = state.valveOverrides[r.id];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.id}</td><td>${r.room}</td>
      <td>${r.mfr}</td><td>${r.returnT}</td>
      <td>${r.valvePos}</td><td>${r.valveLoss}</td><td>${r.totalCircuitLoss}</td>
      <td class="editable-cell">
        <input type="number" placeholder="auto" value="${override || ''}" min="1" step="1"
          onchange="
            const v=parseInt(this.value);
            if(this.value && !isNaN(v)) state.valveOverrides[${r.id}]=v;
            else delete state.valveOverrides[${r.id}]
          "
          style="width:70px"/>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function applyValveOverrides() {
  if (!state.calcResults) return;
  const { radResults, colResults, valveCfg, kvMax, nPositions, deltaT, fixedSupplyT } = state.calcResults;
  const fb = document.getElementById('overrideFeedback');
  fb.textContent = '⏳ Solving network…';

  const tinMap = {};
  if (state.heatMode === 'known') {
    state.manualLossData.forEach((r, i) => {
      const name = state.roomData[i]?.name || `Room ${r.id}`;
      tinMap[name] = 20;
    });
  } else {
    state.roomData.forEach(r => { tinMap[r.name || `Room ${r.id}`] = r.tin; });
  }

  // Yield to browser paint, then solve
  setTimeout(() => {
    try {
      const { rad, col, logs } = solveNetwork(
        radResults, colResults,
        state.valveOverrides,
        valveCfg, kvMax, nPositions,
        deltaT, fixedSupplyT, tinMap,
        state.collectorData,
      );

      // Re-check velocities after solve
      checkVelocities(rad, col);

      const totalMFR   = rad.reduce((s, r) => s + r.mfr, 0);
      const weightedDT = totalMFR > 0
        ? rad.reduce((s, r) => s + r.mfr * (r.supplyT - r.returnT), 0) / totalMFR : 0;
      const maxPressure = Math.max(...rad.map(r => r.totalCircuitLoss || 0));

      state.calcResults = {
        ...state.calcResults,
        radResults: rad, colResults: col,
        weightedDT, totalMFR, maxPressure,
        warnings: [...logs],
      };

      renderValveBalancingTable(rad);
      renderResults();
      fb.textContent = '✅ Network re-solved. ' + (logs[0] || '');
    } catch (e) {
      fb.textContent = '❌ Solver error: ' + e.message;
    }
    setTimeout(() => (fb.textContent = ''), 6000);
  }, 50);
}
