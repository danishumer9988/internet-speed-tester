// Internet Speed Test PWA — Main Application Logic

// ---------- Configuration ----------
const PING_COUNT = 10;
const DOWNLOAD_SIZE = 5 * 1024 * 1024;   // 5 MB per request
const UPLOAD_SIZE = 2 * 1024 * 1024;     // 2 MB per request

// Cloudflare's public speed test API — CORS-enabled, no API key.
// These endpoints measure the browser's real internet path, not the server's.
const CF_DOWN = 'https://speed.cloudflare.com/__down?bytes=';
const CF_UP   = 'https://speed.cloudflare.com/__up';
const TEST_SERVER = 'Cloudflare Edge Network';

// ---------- State ----------
let state = {
  theme: localStorage.getItem('theme') || 'dark',
  locationPermission: localStorage.getItem('locationPermission') || null,
  location: null,
  networkInfo: null,
  deviceInfo: null,
  testResults: null,
  isTesting: false,
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const startScreen = $('startScreen');
const testingScreen = $('testingScreen');
const resultsScreen = $('resultsScreen');
const startBtn = $('startBtn');
const testAgainBtn = $('testAgainBtn');
const themeToggle = $('themeToggle');
const locationStatus = $('locationStatus');
const networkStatus = $('networkStatus');
const locationModal = $('locationModal');
const allowLocationBtn = $('allowLocationBtn');
const denyLocationBtn = $('denyLocationBtn');
const phaseText = $('phaseText');
const progressFill = $('progressFill');
const gaugeCanvas = $('gaugeCanvas');
const gaugeValue = $('gaugeValue');
const pingValue = $('pingValue');
const downloadValue = $('downloadValue');
const uploadValue = $('uploadValue');
const jitterValue = $('jitterValue');
const packetLossValue = $('packetLossValue');
const testError = $('testError');
const historyList = $('historyList');

const resultDownload = $('resultDownload');
const resultUpload = $('resultUpload');
const resultPing = $('resultPing');
const resultJitter = $('resultJitter');
const resultPacketLoss = $('resultPacketLoss');
const resultDuration = $('resultDuration');
const resultISP = $('resultISP');
const resultIP = $('resultIP');
const resultConnection = $('resultConnection');
const resultLocation = $('resultLocation');
const resultServer = $('resultServer');
const resultDevice = $('resultDevice');
const qualityBadge = $('qualityBadge');

// ---------- Theme ----------
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  state.theme = t;
}
function toggleTheme() { applyTheme(state.theme === 'dark' ? 'light' : 'dark'); }
applyTheme(state.theme);
themeToggle.addEventListener('click', toggleTheme);

// ---------- Navigation ----------
function showScreen(s) {
  [startScreen, testingScreen, resultsScreen].forEach(x => x.classList.remove('active'));
  s.classList.add('active');
}

// ---------- Location ----------
function showLocationModal() { locationModal.hidden = false; }
function hideLocationModal() { locationModal.hidden = true; }

async function requestLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const loc = {
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
        };
        state.location = loc;
        localStorage.setItem('locationPermission', 'granted');
        resolve(loc);
      },
      (err) => {
        console.warn('Location error:', err);
        localStorage.setItem('locationPermission', 'denied');
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  });
}

async function initLocation() {
  if (state.locationPermission === 'granted') {
    const loc = await requestLocation();
    locationStatus.textContent = loc
      ? `${loc.latitude.toFixed(3)}, ${loc.longitude.toFixed(3)}`
      : 'Not available';
  } else {
    locationStatus.textContent = 'Not provided';
  }
}

// ---------- Network ----------
async function fetchNetworkInfo() {
  try {
    networkStatus.textContent = 'Detecting...';
    const res = await fetch('/api/network-info');
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    state.networkInfo = data;
    networkStatus.textContent = data.isp || data.city || 'Unknown';
    return data;
  } catch (err) {
    console.warn('Network info error:', err);
    networkStatus.textContent = 'Not available';
    return null;
  }
}

// ---------- Device ----------
function getDeviceInfo() {
  const ua = navigator.userAgent;
  let browser = 'Unknown', os = 'Unknown', deviceType = 'Desktop';
  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg')) browser = 'Edge';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Opera') || ua.includes('OPR')) browser = 'Opera';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) { os = 'Android'; deviceType = 'Mobile'; }
  else if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) { os = 'iOS'; deviceType = 'Mobile'; }
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) deviceType = 'Mobile';
  else if (/Tablet|iPad/i.test(ua)) deviceType = 'Tablet';
  return {
    browser, os, deviceType,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  };
}

// ---------- Gauge ----------
function drawGauge(value, max = 200) {
  const ctx = gaugeCanvas.getContext('2d');
  const w = gaugeCanvas.width, h = gaugeCanvas.height;
  const cx = w / 2, cy = h - 10;
  const radius = Math.min(w, h) * 0.8;
  const css = getComputedStyle(document.documentElement);

  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, 2 * Math.PI);
  ctx.strokeStyle = css.getPropertyValue('--gauge-bg').trim() || '#334155';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.stroke();

  const pct = Math.min(Math.max(value, 0) / max, 1);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, Math.PI + pct * Math.PI);
  ctx.strokeStyle = css.getPropertyValue('--accent').trim() || '#38bdf8';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.stroke();

  const needleAngle = Math.PI + pct * Math.PI;
  const nx = cx + Math.cos(needleAngle) * radius * 0.7;
  const ny = cy + Math.sin(needleAngle) * radius * 0.7;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.strokeStyle = css.getPropertyValue('--text-primary').trim() || '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
  ctx.fillStyle = css.getPropertyValue('--accent').trim() || '#38bdf8';
  ctx.fill();

  gaugeValue.textContent = value.toFixed(1);
}

// ---------- Ping / jitter / packet loss ----------
async function measurePing() {
  const pings = [];
  let failed = 0;

  // Warm-up (not counted)
  try { await fetch(`${CF_DOWN}1000&w=${Math.random()}`, { cache: 'no-store' }); } catch {}

  for (let i = 0; i < PING_COUNT; i++) {
    try {
      const start = performance.now();
      const res = await fetch(`${CF_DOWN}1000&t=${Date.now()}-${Math.random()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('bad status');
      await res.arrayBuffer();
      pings.push(performance.now() - start);
    } catch {
      failed++;
    }
    progressFill.style.width = ((i + 1) / PING_COUNT * 20) + '%';
  }

  if (pings.length === 0) throw new Error('All ping attempts failed');

  const avgPing = pings.reduce((a, b) => a + b, 0) / pings.length;
  let jitterSum = 0;
  for (let i = 1; i < pings.length; i++) jitterSum += Math.abs(pings[i] - pings[i - 1]);
  const jitter = pings.length > 1 ? jitterSum / (pings.length - 1) : 0;
  const packetLoss = (failed / PING_COUNT) * 100;

  pingValue.textContent = avgPing.toFixed(0);
  jitterValue.textContent = jitter.toFixed(0);
  packetLossValue.textContent = packetLoss.toFixed(1);

  return { avgPing, jitter, packetLoss };
}

// ---------- Download ----------
async function measureDownload() {
  phaseText.textContent = 'Testing download...';
  const start = performance.now();
  const res = await fetch(`${CF_DOWN}${DOWNLOAD_SIZE}&t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Download test failed');

  const reader = res.body.getReader();
  let received = 0;
  let warmupSkipped = false;
  let bytesAfterWarmup = 0;
  let warmupEndTime = 0;
  const WARMUP_MS = 1500;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;

    const elapsed = performance.now() - start;
    if (elapsed < WARMUP_MS) {
      progressFill.style.width = (20 + (elapsed / WARMUP_MS) * 10) + '%';
      continue;
    }
    if (!warmupSkipped) {
      warmupSkipped = true;
      warmupEndTime = performance.now();
      bytesAfterWarmup = received;
    }

    const steadyElapsed = (performance.now() - warmupEndTime) / 1000;
    if (steadyElapsed > 0) {
      const inst = ((received - bytesAfterWarmup) * 8) / steadyElapsed / 1e6;
      drawGauge(inst, 500);
      downloadValue.textContent = inst.toFixed(1);
    }
    progressFill.style.width = Math.min(20 + (elapsed / 8000) * 40, 60) + '%';
  }

  const end = performance.now();
  const elapsed = (end - start) / 1000;
  const steadySec = warmupEndTime ? (end - warmupEndTime) / 1000 : elapsed;
  const steadyBytes = warmupEndTime ? (received - bytesAfterWarmup) : received;
  const speedMbps = (steadyBytes * 8) / steadySec / 1e6;

  drawGauge(speedMbps, 500);
  downloadValue.textContent = speedMbps.toFixed(1);
  return { speedMbps, duration: elapsed };
}

// ---------- Upload ----------
async function measureUpload() {
  phaseText.textContent = 'Testing upload...';
  const data = new Uint8Array(UPLOAD_SIZE);
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff;
  const blob = new Blob([data]);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', CF_UP);

    const start = performance.now();
    const WARMUP_MS = 1500;
    let warmupEndTime = 0;
    let bytesAtWarmup = 0;
    let lastLoaded = 0;

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const elapsed = performance.now() - start;

      if (elapsed < WARMUP_MS) {
        progressFill.style.width = (60 + (elapsed / WARMUP_MS) * 10) + '%';
        lastLoaded = e.loaded;
        return;
      }
      if (!warmupEndTime) {
        warmupEndTime = performance.now();
        bytesAtWarmup = e.loaded;
      }

      const steadySec = (performance.now() - warmupEndTime) / 1000;
      if (steadySec > 0) {
        const inst = ((e.loaded - bytesAtWarmup) * 8) / steadySec / 1e6;
        drawGauge(inst, 500);
        uploadValue.textContent = inst.toFixed(1);
      }
      lastLoaded = e.loaded;
      progressFill.style.width = Math.min(60 + (elapsed / 8000) * 30, 90) + '%';
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error('Upload failed'));
      const end = performance.now();
      const elapsed = (end - start) / 1000;
      const steadySec = warmupEndTime ? (end - warmupEndTime) / 1000 : elapsed;
      const steadyBytes = warmupEndTime ? (lastLoaded - bytesAtWarmup) : lastLoaded;
      const speedMbps = (steadyBytes * 8) / steadySec / 1e6;
      drawGauge(speedMbps, 500);
      uploadValue.textContent = speedMbps.toFixed(1);
      resolve({ speedMbps, duration: elapsed });
    };

    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(blob);
  });
}

// ---------- Quality ----------
function calculateQuality(d, u, p, j, pl) {
  let s = 0;
  if (d > 100) s += 2; else if (d > 25) s += 1;
  if (u > 20)  s += 2; else if (u > 5)  s += 1;
  if (p < 30)  s += 2; else if (p < 80) s += 1;
  if (j < 10) s += 1;
  if (pl < 1) s += 1;
  if (s >= 7) return 'Excellent';
  if (s >= 5) return 'Good';
  if (s >= 3) return 'Fair';
  return 'Poor';
}

// ---------- Persistence ----------
async function saveTestResult(data) {
  try {
    const res = await fetch('/api/tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('save failed');
    return await res.json();
  } catch (err) {
    console.error('Save test error:', err);
    return null;
  }
}

function saveLocalHistory(data) {
  const h = JSON.parse(localStorage.getItem('testHistory') || '[]');
  h.unshift({
    download: data.download_speed,
    upload: data.upload_speed,
    ping: data.ping,
    timestamp: new Date().toISOString(),
  });
  if (h.length > 10) h.pop();
  localStorage.setItem('testHistory', JSON.stringify(h));
  renderHistory();
}

function renderHistory() {
  const h = JSON.parse(localStorage.getItem('testHistory') || '[]');
  if (h.length === 0) {
    historyList.innerHTML = '<p class="empty-history">No recent tests yet.</p>';
    return;
  }
  historyList.innerHTML = h.map(item => {
    const d = new Date(item.timestamp);
    const ds = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `
      <div class="history-item">
        <div class="history-date">${ds}</div>
        <div class="history-metrics">
          <span>${item.download.toFixed(1)} Mbps ↓</span>
          <span>${item.upload.toFixed(1)} Mbps ↑</span>
          <span>${item.ping.toFixed(0)} ms</span>
        </div>
      </div>`;
  }).join('');
}

// ---------- Main ----------
async function runTest() {
  if (state.isTesting) return;
  state.isTesting = true;
  testError.hidden = true;
  showScreen(testingScreen);

  pingValue.textContent = '—';
  downloadValue.textContent = '—';
  uploadValue.textContent = '—';
  jitterValue.textContent = '—';
  packetLossValue.textContent = '—';
  progressFill.style.width = '0%';
  drawGauge(0, 500);

  const start = performance.now();

  try {
    phaseText.textContent = 'Connecting...';
    await new Promise(r => setTimeout(r, 400));

    if (!state.networkInfo) await fetchNetworkInfo();

    phaseText.textContent = 'Testing latency...';
    const pingResults = await measurePing();
    progressFill.style.width = '20%';

    phaseText.textContent = 'Testing download...';
    const dl = await measureDownload();
    progressFill.style.width = '60%';

    phaseText.textContent = 'Testing upload...';
    const ul = await measureUpload();
    progressFill.style.width = '90%';

    phaseText.textContent = 'Calculating...';
    await new Promise(r => setTimeout(r, 400));

    const duration = (performance.now() - start) / 1000;
    progressFill.style.width = '100%';

    const results = {
      download_speed: dl.speedMbps,
      upload_speed: ul.speedMbps,
      ping: pingResults.avgPing,
      jitter: pingResults.jitter,
      packet_loss: pingResults.packetLoss,
      test_duration: duration,
      public_ip: state.networkInfo?.ip || null,
      country: state.networkInfo?.country || null,
      region: state.networkInfo?.region || null,
      city: state.networkInfo?.city || null,
      latitude: state.location?.latitude || null,
      longitude: state.location?.longitude || null,
      location_accuracy: state.location?.accuracy || null,
      isp: state.networkInfo?.isp || null,
      asn: state.networkInfo?.asn || null,
      connection_type: navigator.connection?.effectiveType || null,
      device_type: state.deviceInfo?.deviceType || null,
      operating_system: state.deviceInfo?.os || null,
      browser: state.deviceInfo?.browser || null,
      browser_language: state.deviceInfo?.language || null,
      timezone: state.deviceInfo?.timezone || null,
      screen_width: state.deviceInfo?.screenWidth || null,
      screen_height: state.deviceInfo?.screenHeight || null,
      test_server: TEST_SERVER,
    };

    state.testResults = results;

    phaseText.textContent = 'Saving results...';
    await saveTestResult(results);
    saveLocalHistory(results);
    displayResults(results);

    phaseText.textContent = 'Complete';
    await new Promise(r => setTimeout(r, 250));
    showScreen(resultsScreen);
  } catch (err) {
    console.error('Test error:', err);
    testError.textContent = 'Unable to complete the test. Please check your connection and try again.';
    testError.hidden = false;
    phaseText.textContent = 'Test failed';
  } finally {
    state.isTesting = false;
  }
}

function displayResults(r) {
  resultDownload.textContent = r.download_speed.toFixed(1);
  resultUpload.textContent = r.upload_speed.toFixed(1) + ' Mbps';
  resultPing.textContent = r.ping.toFixed(0) + ' ms';
  resultJitter.textContent = r.jitter.toFixed(0) + ' ms';
  resultPacketLoss.textContent = r.packet_loss.toFixed(1) + ' %';
  resultDuration.textContent = r.test_duration.toFixed(1) + ' s';

  resultISP.textContent = r.isp || 'Not available';
  resultIP.textContent = r.public_ip || 'Not available';
  resultConnection.textContent = r.connection_type || 'Not available';

  const loc = [r.city, r.region, r.country].filter(Boolean);
  resultLocation.textContent = loc.length ? loc.join(', ') : 'Not provided';
  resultServer.textContent = r.test_server || 'Cloudflare Edge Network';

  const dev = [r.operating_system, r.browser].filter(Boolean);
  resultDevice.textContent = dev.length ? dev.join(' / ') : 'Not available';

  const q = calculateQuality(r.download_speed, r.upload_speed, r.ping, r.jitter, r.packet_loss);
  qualityBadge.textContent = q;
  qualityBadge.className = 'quality-badge ' + q.toLowerCase();
}

// ---------- Events ----------
startBtn.addEventListener('click', async () => {
  if (!state.locationPermission) { showLocationModal(); return; }
  await runTest();
});

allowLocationBtn.addEventListener('click', async () => {
  hideLocationModal();
  await requestLocation();
  locationStatus.textContent = state.location
    ? `${state.location.latitude.toFixed(3)}, ${state.location.longitude.toFixed(3)}`
    : 'Not provided';
  await runTest();
});

denyLocationBtn.addEventListener('click', async () => {
  hideLocationModal();
  localStorage.setItem('locationPermission', 'denied');
  state.locationPermission = 'denied';
  locationStatus.textContent = 'Not provided';
  await runTest();
});

testAgainBtn.addEventListener('click', () => {
  showScreen(startScreen);
  locationStatus.textContent = state.location
    ? `${state.location.latitude.toFixed(3)}, ${state.location.longitude.toFixed(3)}`
    : 'Not provided';
  networkStatus.textContent = state.networkInfo?.isp || state.networkInfo?.city || 'Unknown';
});

document.querySelectorAll('#privacyLink, #privacyLink2, #privacyFooter').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    alert('Privacy Notice:\n\nThis app records anonymous test results including speed measurements, approximate location, network/ISP information, device/browser information, and test timestamp. No personal information is collected.');
  });
});

document.querySelectorAll('#aboutLink, #termsFooter').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    alert('Internet Speed Test PWA\n\nA professional, privacy-conscious speed test tool. Built with vanilla JavaScript, Express, and SQLite/PostgreSQL.');
  });
});

// ---------- Init ----------
async function init() {
  state.deviceInfo = getDeviceInfo();
  renderHistory();
  await initLocation();
  await fetchNetworkInfo();
  drawGauge(0, 500);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(err => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }
}

init();