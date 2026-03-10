/**
 * ui/navigation.js
 * ================
 * Tab navigation, heat-loss mode toggling,
 * insulation presets, and general UI visibility callbacks.
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
  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i < n) s.classList.add('done');
    if (i === n) s.classList.add('active');
  });
  if (n === 2 && state.calcResults) renderResults();
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
//  Supply temperature input — determines calculation mode
// ---------------------------------------------------------------------------

/**
 * Called whenever the supply temperature input changes.
 * Updates state.designMode and shows/hides a mode hint banner.
 */
function onSupplyTempChange() {
  const inputEl = document.getElementById('supplyTempInput');
  if (!inputEl) return;
  const val     = inputEl.value.trim();
  const hasTemp = val !== '' && !isNaN(parseFloat(val));
  state.designMode = hasTemp ? MODE_FIXED : MODE_EXISTING;

  const hint = document.getElementById('calcModeHint');
  if (hint) {
    if (hasTemp) {
      hint.textContent = `📌 LT Dimensioning mode: fixed supply at ${val} °C — extra power deficit will be calculated.`;
      hint.className   = 'alert alert-warn';
    } else {
      hint.textContent = '🔍 Existing system mode: required supply temperature will be calculated from current radiators.';
      hint.className   = 'alert alert-secondary';
    }
  }
}

// ---------------------------------------------------------------------------
//  Insulation / glazing presets
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
  const vt        = document.getElementById('valveType').value;
  const specsDiv  = document.getElementById('valveSpecs');
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

// ---------------------------------------------------------------------------
//  Pump check (Tab 2, after calculation)
// ---------------------------------------------------------------------------

/**
 * Run pump adequacy check against computed system requirements.
 * Checks whether the selected pump/speed can deliver the required
 * flow at the required head.
 */
/**
 * Find the operating point where the system curve intersects a pump curve.
 * System curve: H_sys = K * Q²  where K = maxPressure / totalMFR²
 * Returns { q, h } in [kg/h, kPa] or null if no intersection found.
 */
function _findOperatingPoint(pts, maxPressure, totalMFR) {
  if (!pts || !pts.length || totalMFR <= 0) return null;
  const K = maxPressure / 1000 / (totalMFR * totalMFR); // kPa / (kg/h)²

  // Scan pump curve for crossover with system curve
  for (let i = 0; i < pts.length - 1; i++) {
    const q0 = pts[i][0],   h0 = pts[i][1];
    const q1 = pts[i+1][0], h1 = pts[i+1][1];
    const s0 = K * q0 * q0;
    const s1 = K * q1 * q1;
    if ((h0 - s0) * (h1 - s1) <= 0) {
      // Linear interpolation of intersection
      const dPump = (h1 - h0);
      const dSys  = (s1 - s0);
      const dDiff = (h0 - s0);
      const t = dDiff / (dSys - dPump); // fraction along segment
      const qOp = q0 + t * (q1 - q0);
      const hOp = h0 + t * (h1 - h0);
      return { q: Math.round(qOp * 10) / 10, h: Math.round(hOp * 100) / 100 };
    }
  }
  // No crossing found — pump curve always above system curve (pump oversized for range)
  // Return the last pump curve point as approximate max
  return null;
}

function runPumpCheck() {
  if (!state.calcResults) {
    alert('Run the heating calculation first.');
    return;
  }

  const { totalMFR, maxPressure } = state.calcResults;
  const pumpModel = document.getElementById('pumpCheckModel').value;
  const resultDiv = document.getElementById('pumpCheckResult');
  const allSpeeds = PUMP_LIBRARY[pumpModel];

  if (!allSpeeds) {
    resultDiv.innerHTML = '<span style="color:#e74c3c">No pump data for this model.</span>';
    return;
  }

  const requiredFlowKgh = Math.round(totalMFR * 10) / 10;
  const requiredHeadKPa = Math.round(maxPressure / 1000 * 100) / 100;
  const K = maxPressure / 1000 / (totalMFR * totalMFR); // system curve coefficient

  // Speed colours
  const speedColors = {
    speed_1: { line: 'rgba(52,152,219,1)',  fill: 'rgba(52,152,219,0.08)',  label: 'Speed 1' },
    speed_2: { line: 'rgba(155,89,182,1)',  fill: 'rgba(155,89,182,0.08)', label: 'Speed 2' },
    speed_3: { line: 'rgba(231,76,60,1)',   fill: 'rgba(231,76,60,0.08)',  label: 'Speed 3' },
  };

  // ── Per-speed analysis ────────────────────────────────────────────────────
  const speedResults = Object.entries(allSpeeds).map(([speedKey, pts]) => {
    const op         = _findOperatingPoint(pts, maxPressure, totalMFR);
    const headAtReq  = interpolatePump(pts, requiredFlowKgh);
    const adequate   = headAtReq !== null && headAtReq >= requiredHeadKPa;
    const maxFlow    = pts[pts.length - 1][0];
    const maxHead    = pts[0][1];
    return { speedKey, pts, op, headAtReq, adequate, maxFlow, maxHead,
             color: speedColors[speedKey] || { line: '#999', fill: 'rgba(150,150,150,0.1)', label: speedKey } };
  });

  // ── Speed comparison table ─────────────────────────────────────────────────
  let tableHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
      <thead><tr style="background:#f4f6f8">
        <th style="padding:7px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Speed</th>
        <th style="padding:7px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Op. point flow</th>
        <th style="padding:7px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Op. point head</th>
        <th style="padding:7px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Head at req. flow</th>
        <th style="padding:7px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Margin</th>
        <th style="padding:7px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Adequate?</th>
        <th style="padding:7px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Simulate</th>
      </tr></thead><tbody>`;

  speedResults.forEach(({ speedKey, op, headAtReq, adequate, color }) => {
    const margin = headAtReq !== null
      ? Math.round((headAtReq - requiredHeadKPa) * 100) / 100
      : null;
    const marginStyle = margin === null ? '' :
      margin >= 0 ? 'color:#27ae60;font-weight:600' : 'color:#e74c3c;font-weight:600';

    tableHtml += `<tr style="border-bottom:1px solid #eee">
      <td style="padding:7px 12px;font-weight:600">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color.line};margin-right:6px"></span>
        ${color.label}
      </td>
      <td style="padding:7px 12px;text-align:right;font-family:var(--mono,monospace)">
        ${op ? op.q + ' kg/h' : '<span style="color:#aaa">—</span>'}
      </td>
      <td style="padding:7px 12px;text-align:right;font-family:var(--mono,monospace)">
        ${op ? op.h + ' kPa' : '<span style="color:#aaa">—</span>'}
      </td>
      <td style="padding:7px 12px;text-align:right;font-family:var(--mono,monospace)">
        ${headAtReq !== null ? Math.round(headAtReq * 100) / 100 + ' kPa' : '<span style="color:#e74c3c">out of range</span>'}
      </td>
      <td style="padding:7px 12px;text-align:right;font-family:var(--mono,monospace)">
        ${margin !== null ? `<span style="${marginStyle}">${margin >= 0 ? '+' : ''}${margin} kPa</span>` : '—'}
      </td>
      <td style="padding:7px 12px;text-align:center">
        ${adequate
          ? '<span style="color:#27ae60;font-weight:700;font-size:15px">✔</span>'
          : '<span style="color:#e74c3c;font-weight:700;font-size:15px">✘</span>'}
      </td>
      <td style="padding:7px 12px;text-align:center">
        ${op
          ? `<button onclick="runPumpSimulation('${speedKey}',${op ? op.q : 0},${op ? op.h : 0},'${color.label}')"
              style="font-size:11px;padding:3px 10px;border:1px solid #bbb;border-radius:4px;
                     background:#f8f9fa;cursor:pointer">Simulate</button>`
          : '<span style="color:#aaa">—</span>'}
      </td>
    </tr>`;
  });

  tableHtml += `</tbody></table>
    <div style="font-size:12px;color:#8fa3ad;margin-bottom:16px">
      Required: <strong>${requiredFlowKgh} kg/h</strong> @ <strong>${requiredHeadKPa} kPa</strong>
      &nbsp;·&nbsp; System curve: H = ${Math.round(K * 1e6) / 1e6} · Q²
    </div>`;

  // ── Build Chart.js datasets ────────────────────────────────────────────────
  const qMax   = Math.max(...Object.values(allSpeeds).map(pts => pts[pts.length-1][0])) * 1.1;
  const qSteps = [];
  for (let q = 0; q <= qMax; q += qMax / 80) qSteps.push(Math.round(q));

  const datasets = [];

  // System curve
  datasets.push({
    label: 'System curve',
    data: qSteps.map(q => ({ x: q, y: Math.round(K * q * q * 100) / 100 })),
    borderColor: 'rgba(231,126,34,1)',
    backgroundColor: 'rgba(231,126,34,0.06)',
    borderWidth: 2,
    borderDash: [6, 3],
    pointRadius: 0,
    fill: false,
    tension: 0.3,
    order: 10,
  });

  // Pump curves per speed
  speedResults.forEach(({ speedKey, pts, op, color }) => {
    datasets.push({
      label: color.label,
      data: pts.map(([q, h]) => ({ x: q, y: h })),
      borderColor: color.line,
      backgroundColor: color.fill,
      borderWidth: 2,
      pointRadius: 3,
      fill: false,
      tension: 0.3,
      order: 5,
    });

    // Operating point marker
    if (op) {
      datasets.push({
        label: `${color.label} op. point`,
        data: [{ x: op.q, y: op.h }],
        type: 'scatter',
        pointStyle: 'circle',
        pointRadius: 8,
        pointHoverRadius: 10,
        borderColor: color.line,
        backgroundColor: color.line,
        order: 1,
      });
    }
  });

  // Required point marker
  datasets.push({
    label: 'Required duty',
    data: [{ x: requiredFlowKgh, y: requiredHeadKPa }],
    type: 'scatter',
    pointStyle: 'crossRot',
    pointRadius: 12,
    pointHoverRadius: 14,
    borderColor: 'rgba(0,0,0,0.7)',
    backgroundColor: 'rgba(0,0,0,0.7)',
    order: 0,
  });

  // ── Render HTML + canvas ───────────────────────────────────────────────────
  resultDiv.innerHTML = tableHtml +
    `<div style="position:relative;height:340px"><canvas id="chartPumpCheck"></canvas></div>` +
    `<div id="pumpSimResult" style="margin-top:24px"></div>`;

  // Destroy previous chart instance if any
  if (window._pumpCheckChart) { window._pumpCheckChart.destroy(); }

  window._pumpCheckChart = new Chart(
    document.getElementById('chartPumpCheck'),
    {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const d = ctx.raw;
                if (d && d.x !== undefined)
                  return ` ${ctx.dataset.label}: ${d.x} kg/h, ${d.y} kPa`;
                return ctx.formattedValue;
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Flow (kg/h)', font: { size: 12 } },
            min: 0,
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          y: {
            title: { display: true, text: 'Head (kPa)', font: { size: 12 } },
            min: 0,
            max: 200,
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
        },
      },
    }
  );
}


// ---------------------------------------------------------------------------
//  Pump simulation — redistribute flow at actual operating point
// ---------------------------------------------------------------------------

/**
 * Given the actual pump operating point (totalQ kg/h at pumpHead kPa),
 * redistribute flow over all circuits proportionally to their hydraulic
 * conductance, then recalculate radiator temperatures via EN 442 LMTD.
 *
 * Physics:
 *   Each circuit i has resistance Ri [Pa/(kg/h)²] from design results.
 *   All circuits share the same available pump head H_pump.
 *   Flow per circuit: Q_i = sqrt(H_avail / Ri)  where H_avail = pumpHead*1000 - fixed losses
 *   Total flow must equal operating point flow → iterate to find H_avail.
 */
function runPumpSimulation(speedKey, opQ, opH, speedLabel) {
  const simDiv = document.getElementById('pumpSimResult');
  if (!simDiv) return;
  if (!state.calcResults) return;

  const { radResults, colResults, fixedSupplyT, deltaT } = state.calcResults;
  const pumpHeadPa = opH * 1000; // kPa → Pa

  // Build tinMap for EN 442 recalculation
  const tinMap = {};
  if (state.heatMode === 'known') {
    state.manualLossData.forEach((r, i) => {
      tinMap[state.roomData[i]?.name || `Room ${r.id}`] = 20;
    });
  } else {
    state.roomData.forEach(r => { tinMap[r.name || `Room ${r.id}`] = r.tin; });
  }

  // ── Step 1: compute hydraulic resistance per circuit ─────────────────────
  // R_i = totalPressureLoss_i / mfr_i²  (Pa / (kg/h)²)
  // totalPressureLoss already includes pipe + radiator body + collector + boiler
  const circuits = radResults.map(r => {
    const R = r.mfr > 0.01 ? r.totalPressureLoss / (r.mfr * r.mfr) : 1e6;
    return { ...r, R };
  });

  // ── Step 2: find available head H_avail so that sum(sqrt(H/Ri)) = opQ ──
  // Binary search on H_avail in [0, pumpHeadPa]
  let lo = 0, hi = pumpHeadPa;
  let hAvail = pumpHeadPa;
  for (let iter = 0; iter < 60; iter++) {
    hAvail = (lo + hi) / 2;
    const qSum = circuits.reduce((s, c) => s + Math.sqrt(Math.max(hAvail, 0) / c.R), 0);
    if (Math.abs(qSum - opQ) < 0.1) break;
    if (qSum < opQ) hi = hAvail * 1.5 > pumpHeadPa ? pumpHeadPa : hAvail * 1.5;
    // broaden search if needed
    if (lo === 0 && hi === pumpHeadPa && qSum > opQ) { lo = 0; hi = hAvail; }
    else if (qSum > opQ) hi = hAvail;
    else lo = hAvail;
  }

  // ── Step 3: assign new flow per circuit ───────────────────────────────────
  const simCircuits = circuits.map(c => {
    const newMfr = Math.round(Math.sqrt(Math.max(hAvail, 0) / c.R) * 10) / 10;
    return { ...c, simMfr: newMfr };
  });

  const totalSimMfr = simCircuits.reduce((s, c) => s + c.simMfr, 0);

  // ── Step 4: recalculate temperatures via EN 442 ───────────────────────────
  const simRows = simCircuits.map(c => {
    const tRoom  = tinMap[c.room] || 20;
    const qNom   = c.qNom || 2000;
    const mDot   = c.simMfr;
    const tSup   = (fixedSupplyT !== null) ? fixedSupplyT : c.supplyT;
    const cp     = 4180 / 3600;
    const lmtdNom = (75 - 20 - (65 - 20)) / Math.log((75 - 20) / (65 - 20)); // 49.83 K

    let tRet = tSup - deltaT;
    if (mDot >= MIN_FLOW) {
      for (let i = 0; i < 30; i++) {
        const dt1 = tSup - tRoom, dt2 = tRet - tRoom;
        if (dt1 <= 0 || dt2 <= 0) { tRet = tSup - 0.1; break; }
        const lmtdAct = Math.abs(dt1 - dt2) < 1e-6 ? dt1 : (dt1 - dt2) / Math.log(dt1 / dt2);
        const qCalc   = qNom * Math.pow(lmtdAct / lmtdNom, EXPONENT_N);
        const tRetNew = tSup - qCalc / (mDot * cp);
        if (Math.abs(tRetNew - tRet) < 0.01) { tRet = tRetNew; break; }
        tRet = tRetNew;
      }
    }

    const dt1f = tSup - tRoom, dt2f = tRet - tRoom;
    let actualOutput = 0;
    if (dt1f > 0 && dt2f > 0) {
      const lmtdFinal = Math.abs(dt1f - dt2f) < 1e-6 ? dt1f : (dt1f - dt2f) / Math.log(dt1f / dt2f);
      actualOutput = Math.round(qNom * Math.pow(lmtdFinal / lmtdNom, EXPONENT_N));
    }

    const dMfr    = Math.round((mDot - c.mfr) * 10) / 10;
    const dOutput = actualOutput - Math.round(c.heatLoss);

    return {
      id: c.id, room: c.room,
      designMfr: c.mfr, simMfr: mDot,
      deltaMfr: dMfr,
      designSupplyT: c.supplyT, simSupplyT: Math.round(tSup * 10) / 10,
      simReturnT: Math.round(tRet * 10) / 10,
      designOutput: Math.round(c.heatLoss),
      simOutput: actualOutput,
      deltaOutput: dOutput,
      sufficient: actualOutput >= c.heatLoss,
    };
  });

  // ── Step 5: render ────────────────────────────────────────────────────────
  const sign = v => v >= 0 ? `+${v}` : `${v}`;
  const colStyle = v => v >= 0
    ? 'color:#27ae60;font-weight:600' : 'color:#e74c3c;font-weight:600';

  let html = `
    <div style="border-top:2px solid #e0e6ea;padding-top:16px;margin-top:8px">
      <h4 style="margin:0 0 4px;font-size:14px;color:#2c3e50">
        Pump simulation — ${speedLabel}
        <span style="font-weight:400;font-size:12px;color:#8fa3ad;margin-left:8px">
          Operating point: ${opQ} kg/h @ ${opH} kPa
        </span>
      </h4>
      <p style="font-size:12px;color:#8fa3ad;margin:0 0 12px">
        Flow redistributed over circuits via hydraulic resistance.
        Total simulated flow: <strong>${Math.round(totalSimMfr * 10) / 10} kg/h</strong>
        (design: <strong>${Math.round(state.calcResults.totalMFR * 10) / 10} kg/h</strong>).
        Temperatures recalculated via EN 442 LMTD.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f4f6f8">
          <th style="padding:6px 10px;text-align:left">#</th>
          <th style="padding:6px 10px;text-align:left">Room</th>
          <th style="padding:6px 10px;text-align:right">Design flow<br>(kg/h)</th>
          <th style="padding:6px 10px;text-align:right">Sim flow<br>(kg/h)</th>
          <th style="padding:6px 10px;text-align:right">Δ flow</th>
          <th style="padding:6px 10px;text-align:right">Supply T<br>(°C)</th>
          <th style="padding:6px 10px;text-align:right">Return T<br>(°C)</th>
          <th style="padding:6px 10px;text-align:right">Design output<br>(W)</th>
          <th style="padding:6px 10px;text-align:right">Sim output<br>(W)</th>
          <th style="padding:6px 10px;text-align:right">Δ output</th>
          <th style="padding:6px 10px;text-align:center">OK?</th>
        </tr></thead><tbody>`;

  simRows.forEach(r => {
    html += `<tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:6px 10px">${r.id}</td>
      <td style="padding:6px 10px">${r.room}</td>
      <td style="padding:6px 10px;text-align:right;font-family:monospace">${r.designMfr}</td>
      <td style="padding:6px 10px;text-align:right;font-family:monospace">${r.simMfr}</td>
      <td style="padding:6px 10px;text-align:right;font-family:monospace">
        <span style="${colStyle(r.deltaMfr)}">${sign(r.deltaMfr)}</span>
      </td>
      <td style="padding:6px 10px;text-align:right;font-family:monospace">${r.simSupplyT}</td>
      <td style="padding:6px 10px;text-align:right;font-family:monospace">${r.simReturnT}</td>
      <td style="padding:6px 10px;text-align:right;font-family:monospace">${r.designOutput}</td>
      <td style="padding:6px 10px;text-align:right;font-family:monospace">${r.simOutput}</td>
      <td style="padding:6px 10px;text-align:right;font-family:monospace">
        <span style="${colStyle(r.deltaOutput)}">${sign(r.deltaOutput)}</span>
      </td>
      <td style="padding:6px 10px;text-align:center">
        ${r.sufficient
          ? '<span style="color:#27ae60;font-weight:700">✔</span>'
          : '<span style="color:#e74c3c;font-weight:700">✘</span>'}
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  simDiv.innerHTML = html;
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
    "Tab 0: Configure heat-loss calculation mode.\n" +
    "Tab 1: Set building envelope and rooms → heat losses calculated via EN 12831.\n" +
    "Tab 2: Enter radiator data, collectors, valve type.\n" +
    "       • Leave Supply Temperature blank → Existing System mode:\n" +
    "         calculates the minimum required supply temperature.\n" +
    "       • Fill in Supply Temperature → LT Dimensioning mode:\n" +
    "         calculates extra power deficit per radiator.\n" +
    "       After calculation, use the Pump Check to verify pump adequacy.\n" +
    "Tab 3: View results, charts, and detailed tables.\n\n" +
    "Physics: EN 12831 heat loss · EN 442 radiator model · hydraulic solver."
  );
}

// ---------------------------------------------------------------------------
//  Utility helpers shared across UI modules
// ---------------------------------------------------------------------------

function getN(id, def) {
  const v = parseFloat(document.getElementById(id)?.value);
  return isNaN(v) ? def : v;
}

function getS(id, def) {
  return document.getElementById(id)?.value || def;
}