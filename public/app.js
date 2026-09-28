// Internet Speed Test PWA — Main Application Logic
// Methodology modelled on Ookla Speedtest, Fast.com, and Cloudflare.

// ---------- Configuration ----------
const PING_COUNT = 10;

// Cloudflare's public speed test API — CORS-enabled, no API key.
const CF_DOWN = 'https://speed.cloudflare.com/__down?bytes=';
const CF_UP   = 'https://speed.cloudflare.com/__up';
const TEST_SERVER = 'Cloudflare Edge Network';

// Test phase parameters
const TEST_DURATION_MS = 12000;   // hard cap per phase
const WARMUP_MS        = 2000;    // discard first 2s (TCP slow start)
const MIN_SAMPLES      = 8;       // need this many before early stop
const STABLE_WINDOW    = 5;       // rolling window for stability check
const STABLE_THRESHOLD = 0.08;    // stop when max/min spread < 8%

// Parallel connection policy (Ookla-style)
const MIN_THREADS = 2;
const MAX_THREADS = 4;
const THREAD_SPEED_THRESHOLD_MBPS = 4; // if pre-test >= 4 Mbps, go to 4 threads

// Chunk size ladder (adaptive, based on current speed)
function pickChunkSize(mbps) {
  if (mbps > 200) return 50 * 1024 * 1024;
  if (mbps > 50)  return 25 * 1024 * 1024;
  if (mbps > 10)  return 10 * 1024 * 1024;
  if (mbps > 2)   return  5 * 1024 * 1024;
  return 2 * 1024 * 1024;
}

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

// ---------- Network info ----------
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

// ---------- Device info ----------
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
function drawGauge(value, max = 1000) {
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

// ---------- Statistics helpers ----------

// Trim outliers the way Ookla does on the HTTP path:
// sort samples by speed, drop the top slice and the bottom slice,
// average the remainder.
function trimAndAverage(samples, dropTopFrac = 0.10, dropBottomFrac = 0.25) {
  if (samples.length < 6) {
    return samples.reduce((a, b) => a + b, 0) / Math.max(samples.length, 1);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const bottom = Math.floor(sorted.length * dropBottomFrac);
  const top = Math.max(bottom + 1, sorted.length - Math.floor(sorted.length * dropTopFrac));
  const kept = sorted.slice(bottom, top);
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

// Stability check — how spread is the rolling window?
// If max/min are within threshold, we can stop early.
function isStable(samples) {
  if (samples.length < STABLE_WINDOW) return false;
  const recent = samples.slice(-STABLE_WINDOW);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  if (avg <= 0) return false;
  const max = Math.max(...recent);
  const min = Math.min(...recent);
  return (max - min) / avg < STABLE_THRESHOLD;
}

// Take a quick pre-test sample to decide how many threads to use.
async function preTestDownload() {
  try {
    const start = performance.now();
    const res = await fetch(`${CF_DOWN}${2 * 1024 * 1024}&t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return 0;
    const buf = await res.arrayBuffer();
    const sec = (performance.now() - start) / 1000;
    return (buf.byteLength * 8) / sec / 1e6;
  } catch {
    return 0;
  }
}

// ---------- Ping / jitter / packet loss ----------
async function measurePing() {
  const pings = [];
  let failed = 0;

  // Warm-up (not counted)
  try {
    await fetch(`${CF_DOWN}1000&w=${Math.random()}`, { cache: 'no-store' });
  } catch {}

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

  // Ookla uses the MINIMUM ping, not the average.
  const minPing = Math.min(...pings);

  let jitterSum = 0;
  for (let i = 1; i < pings.length; i++) jitterSum += Math.abs(pings[i] - pings[i - 1]);
  const jitter = pings.length > 1 ? jitterSum / (pings.length - 1) : 0;
  const packetLoss = (failed / PING_COUNT) * 100;

  pingValue.textContent = minPing.toFixed(0);
  jitterValue.textContent = jitter.toFixed(0);
  packetLossValue.textContent = packetLoss.toFixed(1);

  return { avgPing: minPing, jitter, packetLoss };
}

// ---------- Download ----------
async function measureDownload() {
  phaseText.textContent = 'Pre-testing connection...';

  // Step 1: pre-test to decide thread count
  const preSpeed = await preTestDownload();
  const threads = preSpeed >= THREAD_SPEED_THRESHOLD_MBPS ? MAX_THREADS : MIN_THREADS;
  console.log(`Pre-test: ${preSpeed.toFixed(1)} Mbps → using ${threads} threads`);

  phaseText.textContent = 'Testing download...';

  const startTime = performance.now();
  const controller = new AbortController();
  let active = true;
  let totalBytes = 0;
  let currentChunk = pickChunkSize(preSpeed);
  const samples = []; // rolling window of instantaneous speeds

  // Sampler: every 250 ms, compute instantaneous speed over the interval
  let lastTime = startTime;
  let lastBytes = 0;
  const sampler = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    const dBytes = totalBytes - lastBytes;
    lastTime = now;
    lastBytes = totalBytes;

    if (dt > 0.2 && dBytes > 0) {
      const inst = (dBytes * 8) / dt / 1e6;
      samples.push(inst);
      currentChunk = pickChunkSize(inst);

      const elapsed = now - startTime;
      if (elapsed > WARMUP_MS) {
        drawGauge(inst, Math.max(1000, Math.ceil(inst * 1.2 / 100) * 100));
        downloadValue.textContent = inst.toFixed(1);
      }
    }

    const elapsed = now - startTime;
    progressFill.style.width = Math.min(20 + (elapsed / TEST_DURATION_MS) * 40, 60) + '%';

    // Dynamic stop: enough samples, past warm-up, and stable
    if (elapsed > WARMUP_MS + 2000 &&
        samples.length >= MIN_SAMPLES &&
        isStable(samples)) {
      active = false;
      controller.abort();
    }
  }, 250);

  async function worker() {
    while (active) {
      try {
        const res = await fetch(
          `${CF_DOWN}${currentChunk}&t=${Date.now()}-${Math.random()}`,
          { signal: controller.signal, cache: 'no-store' }
        );
        if (!res.ok) break;
        const reader = res.body.getReader();
        while (active) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.length;
        }
      } catch {
        break;
      }
    }
  }

  const workers = Array.from({ length: threads }, () => worker());
  await new Promise(r => setTimeout(r, TEST_DURATION_MS));
  active = false;
  try { controller.abort(); } catch {}
  await Promise.allSettled(workers);
  clearInterval(sampler);

  // Step 2: discard warm-up samples, then trim outliers
  const postWarmup = samples.filter((_, i) => i >= Math.floor(WARMUP_MS / 250));
  const finalSpeed = trimAndAverage(postWarmup);

  drawGauge(finalSpeed, Math.max(1000, Math.ceil(finalSpeed * 1.2 / 100) * 100));
  downloadValue.textContent = finalSpeed.toFixed(1);
  return { speedMbps: finalSpeed, duration: (performance.now() - startTime) / 1000 };
}

// ---------- Upload ----------
async function measureUpload() {
  phaseText.textContent = 'Testing upload...';

  // Same thread policy: use pre-test speed from download phase (passed via global).
  const threads = window.__lastDownloadMbps >= THREAD_SPEED_THRESHOLD_MBPS ? MAX_THREADS : MIN_THREADS;

  const startTime = performance.now();
  let active = true;
  let totalBytes = 0;
  const samples = [];
  const activeXhrs = [];
  let currentChunk = 2 * 1024 * 1024;
  let lastTime = startTime;
  let lastBytes = 0;

  const sampler = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    const dBytes = totalBytes - lastBytes;
    lastTime = now;
    lastBytes = totalBytes;

    if (dt > 0.2 && dBytes > 0) {
      const inst = (dBytes * 8) / dt / 1e6;
      samples.push(inst);
      // Upload chunks are smaller — a quarter of the download chunk.
      currentChunk = Math.max(512 * 1024, Math.floor(pickChunkSize(inst) / 4));

      const elapsed = now - startTime;
      if (elapsed > WARMUP_MS) {
        drawGauge(inst, Math.max(1000, Math.ceil(inst * 1.2 / 100) * 100));
        uploadValue.textContent = inst.toFixed(1);
      }
    }

    const elapsed = now - startTime;
    progressFill.style.width = Math.min(60 + (elapsed / TEST_DURATION_MS) * 30, 90) + '%';

    if (elapsed > WARMUP_MS + 2000 &&
        samples.length >= MIN_SAMPLES &&
        isStable(samples)) {
      active = false;
    }
  }, 250);

  function makePayload(size) {
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) data[i] = (i * 31 + 7) & 0xff;
    return new Blob([data]);
  }

  function startWorker() {
    return new Promise((resolve) => {
      let sentThisRound = 0;
      let chunkSizeThisRound = currentChunk;

      const doUpload = () => {
        if (!active) return resolve();

        chunkSizeThisRound = currentChunk;
        sentThisRound = 0;
        const blob = makePayload(chunkSizeThisRound);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', CF_UP);

        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const delta = e.loaded - sentThisRound;
          if (delta > 0) {
            totalBytes += delta;
            sentThisRound = e.loaded;
          }
        };

        xhr.onload = () => {
          // Account for any bytes not reported by progress events
          if (sentThisRound < chunkSizeThisRound) {
            totalBytes += chunkSizeThisRound - sentThisRound;
          }
          doUpload();
        };
        xhr.onerror = xhr.onabort = () => resolve();

        activeXhrs.push(xhr);
        try { xhr.send(blob); } catch { resolve(); }
      };

      doUpload();
    });
  }

  const workers = Array.from({ length: threads }, () => startWorker());
  await new Promise(r => setTimeout(r, TEST_DURATION_MS));
  active = false;
  activeXhrs.forEach(x => { try { x.abort(); } catch {} });
  await Promise.allSettled(workers);
  clearInterval(sampler);

  const postWarmup = samples.filter((_, i) => i >= Math.floor(WARMUP_MS / 250));
  const finalSpeed = trimAndAverage(postWarmup);

  drawGauge(finalSpeed, Math.max(1000, Math.ceil(finalSpeed * 1.2 / 100) * 100));
  uploadValue.textContent = finalSpeed.toFixed(1);
  return { speedMbps: finalSpeed, duration: (performance.now() - startTime) / 1000 };
}

// ---------- Quality score ----------
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

// ---------- Main test flow ----------
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
  drawGauge(0, 1000);

  const start = performance.now();

  try {
    phaseText.textContent = 'Connecting...';
    await new Promise(r => setTimeout(r, 400));

    if (!state.networkInfo) await fetchNetworkInfo();

    phaseText.textContent = 'Testing latency...';
    const pingResults = await measurePing();
    progressFill.style.width = '20%';

    const dl = await measureDownload();
    window.__lastDownloadMbps = dl.speedMbps;
    progressFill.style.width = '60%';

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
  drawGauge(0, 1000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(err => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }
}

init();