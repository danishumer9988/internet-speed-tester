// Internet Speed Test PWA — Main Application Logic

// ---------- Configuration ----------
const PING_COUNT = 10;
const DOWNLOAD_SIZE = 5 * 1024 * 1024; // 5 MB
const UPLOAD_SIZE = 2 * 1024 * 1024; // 2 MB
const TEST_SERVER = 'Local Server'; // Will be updated from network info

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

// ---------- DOM Elements ----------
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

// Results elements
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

// ---------- Theme Management ----------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  state.theme = theme;
}

function toggleTheme() {
  const newTheme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
}

// Initialize theme immediately to prevent flash
applyTheme(state.theme);
themeToggle.addEventListener('click', toggleTheme);

// ---------- UI Navigation ----------
function showScreen(screen) {
  [startScreen, testingScreen, resultsScreen].forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

// ---------- Location Handling ----------
function showLocationModal() {
  locationModal.hidden = false;
}

function hideLocationModal() {
  locationModal.hidden = true;
}

async function requestLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        state.location = loc;
        localStorage.setItem('locationPermission', 'granted');
        resolve(loc);
      },
      (error) => {
        console.warn('Location error:', error);
        localStorage.setItem('locationPermission', 'denied');
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  });
}

async function initLocation() {
  const permission = state.locationPermission;
  if (permission === 'granted') {
    const loc = await requestLocation();
    if (loc) {
      locationStatus.textContent = `${loc.latitude.toFixed(3)}, ${loc.longitude.toFixed(3)}`;
    } else {
      locationStatus.textContent = 'Not available';
    }
  } else if (permission === 'denied') {
    locationStatus.textContent = 'Not provided';
  } else {
    locationStatus.textContent = 'Not provided';
  }
}

// ---------- Network Info ----------
async function fetchNetworkInfo() {
  try {
    networkStatus.textContent = 'Detecting...';
    const res = await fetch('/api/network-info');
    if (!res.ok) throw new Error('Network info failed');
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

// ---------- Device Info ----------
function getDeviceInfo() {
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  let os = 'Unknown';
  let deviceType = 'Desktop';

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

  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) deviceType = 'Mobile';
  else if (/Tablet|iPad/i.test(ua)) deviceType = 'Tablet';

  return {
    browser,
    os,
    deviceType,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  };
}

// ---------- Gauge Drawing ----------
function drawGauge(value, max = 200) {
  const ctx = gaugeCanvas.getContext('2d');
  const w = gaugeCanvas.width;
  const h = gaugeCanvas.height;
  const centerX = w / 2;
  const centerY = h - 10;
  const radius = Math.min(w, h) * 0.8;

  ctx.clearRect(0, 0, w, h);

  // Background arc
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, Math.PI, 2 * Math.PI);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--gauge-bg').trim() || '#334155';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Value arc
  const percentage = Math.min(value / max, 1);
  const endAngle = Math.PI + percentage * Math.PI;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, Math.PI, endAngle);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#38bdf8';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Needle
  const needleAngle = Math.PI + percentage * Math.PI;
  const needleX = centerX + Math.cos(needleAngle) * radius * 0.7;
  const needleY = centerY + Math.sin(needleAngle) * radius * 0.7;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(needleX, needleY);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(centerX, centerY, 6, 0, 2 * Math.PI);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#38bdf8';
  ctx.fill();

  gaugeValue.textContent = value.toFixed(1);
}

// ---------- Speed Test Logic ----------
async function measurePing() {
  const pings = [];
  let failed = 0;
  for (let i = 0; i < PING_COUNT; i++) {
    try {
      const start = performance.now();
      const res = await fetch('/api/speedtest/ping?t=' + Date.now());
      if (!res.ok) throw new Error('Ping failed');
      await res.text();
      const end = performance.now();
      pings.push(end - start);
    } catch (err) {
      failed++;
    }
    const progress = (i + 1) / PING_COUNT * 20;
    progressFill.style.width = progress + '%';
  }
  if (pings.length === 0) throw new Error('All ping attempts failed');

  const avgPing = pings.reduce((a, b) => a + b, 0) / pings.length;

  let jitterSum = 0;
  for (let i = 1; i < pings.length; i++) {
    jitterSum += Math.abs(pings[i] - pings[i - 1]);
  }
  const jitter = pings.length > 1 ? jitterSum / (pings.length - 1) : 0;
  const packetLoss = (failed / PING_COUNT) * 100;

  pingValue.textContent = avgPing.toFixed(0);
  jitterValue.textContent = jitter.toFixed(0);
  packetLossValue.textContent = packetLoss.toFixed(1);

  return { avgPing, jitter, packetLoss };
}

async function measureDownload() {
  phaseText.textContent = 'Testing download...';
  const start = performance.now();
  const res = await fetch(`/api/speedtest/download?size=${DOWNLOAD_SIZE}&t=${Date.now()}`);
  if (!res.ok) throw new Error('Download test failed');

  const reader = res.body.getReader();
  let received = 0;
  const contentLength = DOWNLOAD_SIZE;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    const progress = 20 + (received / contentLength) * 40;
    progressFill.style.width = Math.min(progress, 60) + '%';
    const currentSpeed = (received * 8) / ((performance.now() - start) / 1000) / 1e6;
    drawGauge(currentSpeed, 200);
    downloadValue.textContent = currentSpeed.toFixed(1);
  }

  const end = performance.now();
  const duration = (end - start) / 1000;
  const speedMbps = (contentLength * 8) / duration / 1e6;
  downloadValue.textContent = speedMbps.toFixed(1);
  drawGauge(speedMbps, 200);
  return { speedMbps, duration };
}

async function measureUpload() {
  phaseText.textContent = 'Testing upload...';
  const data = new Uint8Array(UPLOAD_SIZE);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(Math.random() * 256);
  const blob = new Blob([data]);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/speedtest/upload');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    const start = performance.now();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const progress = 60 + (e.loaded / e.total) * 30;
        progressFill.style.width = Math.min(progress, 90) + '%';
        const currentSpeed = (e.loaded * 8) / ((performance.now() - start) / 1000) / 1e6;
        drawGauge(currentSpeed, 200);
        uploadValue.textContent = currentSpeed.toFixed(1);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const end = performance.now();
        const duration = (end - start) / 1000;
        const speedMbps = (UPLOAD_SIZE * 8) / duration / 1e6;
        uploadValue.textContent = speedMbps.toFixed(1);
        drawGauge(speedMbps, 200);
        resolve({ speedMbps, duration });
      } else {
        reject(new Error('Upload failed'));
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(blob);
  });
}

// ---------- Quality Score ----------
function calculateQuality(download, upload, ping, jitter, packetLoss) {
  let score = 0;
  if (download > 100) score += 2; else if (download > 25) score += 1;
  if (upload > 20) score += 2; else if (upload > 5) score += 1;
  if (ping < 30) score += 2; else if (ping < 80) score += 1;
  if (jitter < 10) score += 1;
  if (packetLoss < 1) score += 1;

  if (score >= 7) return 'Excellent';
  if (score >= 5) return 'Good';
  if (score >= 3) return 'Fair';
  return 'Poor';
}

// ---------- Save Test ----------
async function saveTestResult(data) {
  try {
    const res = await fetch('/api/tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to save test');
    return await res.json();
  } catch (err) {
    console.error('Save test error:', err);
    return null;
  }
}

// ---------- Local History ----------
function saveLocalHistory(data) {
  const history = JSON.parse(localStorage.getItem('testHistory') || '[]');
  history.unshift({
    download: data.download_speed,
    upload: data.upload_speed,
    ping: data.ping,
    timestamp: new Date().toISOString(),
  });
  if (history.length > 10) history.pop();
  localStorage.setItem('testHistory', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem('testHistory') || '[]');
  if (history.length === 0) {
    historyList.innerHTML = '<p class="empty-history">No recent tests yet.</p>';
    return;
  }
  historyList.innerHTML = history.map(item => {
    const date = new Date(item.timestamp);
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `
      <div class="history-item">
        <div class="history-date">${dateStr}</div>
        <div class="history-metrics">
          <span>${item.download.toFixed(1)} Mbps ↓</span>
          <span>${item.upload.toFixed(1)} Mbps ↑</span>
          <span>${item.ping.toFixed(0)} ms</span>
        </div>
      </div>
    `;
  }).join('');
}

// ---------- Main Test Flow ----------
async function runTest() {
  if (state.isTesting) return;
  state.isTesting = true;
  testError.hidden = true;
  showScreen(testingScreen);

  // Reset UI
  pingValue.textContent = '—';
  downloadValue.textContent = '—';
  uploadValue.textContent = '—';
  jitterValue.textContent = '—';
  packetLossValue.textContent = '—';
  progressFill.style.width = '0%';
  drawGauge(0, 200);

  const testStartTime = performance.now();
  let pingResults, downloadResults, uploadResults;

  try {
    phaseText.textContent = 'Connecting...';
    await new Promise(r => setTimeout(r, 500));

    if (!state.networkInfo) {
      await fetchNetworkInfo();
    }

    phaseText.textContent = 'Testing latency...';
    pingResults = await measurePing();
    progressFill.style.width = '20%';

    phaseText.textContent = 'Testing download...';
    downloadResults = await measureDownload();
    progressFill.style.width = '60%';

    phaseText.textContent = 'Testing upload...';
    uploadResults = await measureUpload();
    progressFill.style.width = '90%';

    phaseText.textContent = 'Calculating...';
    await new Promise(r => setTimeout(r, 500));

    const testDuration = (performance.now() - testStartTime) / 1000;
    progressFill.style.width = '100%';

    const results = {
      download_speed: downloadResults.speedMbps,
      upload_speed: uploadResults.speedMbps,
      ping: pingResults.avgPing,
      jitter: pingResults.jitter,
      packet_loss: pingResults.packetLoss,
      test_duration: testDuration,
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
    await new Promise(r => setTimeout(r, 300));
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

function displayResults(results) {
  resultDownload.textContent = results.download_speed.toFixed(1);
  resultUpload.textContent = results.upload_speed.toFixed(1) + ' Mbps';
  resultPing.textContent = results.ping.toFixed(0) + ' ms';
  resultJitter.textContent = results.jitter.toFixed(0) + ' ms';
  resultPacketLoss.textContent = results.packet_loss.toFixed(1) + ' %';
  resultDuration.textContent = results.test_duration.toFixed(1) + ' s';

  resultISP.textContent = results.isp || 'Not available';
  resultIP.textContent = results.public_ip || 'Not available';
  resultConnection.textContent = results.connection_type || 'Not available';

  const locationParts = [results.city, results.region, results.country].filter(Boolean);
  resultLocation.textContent = locationParts.length > 0 ? locationParts.join(', ') : 'Not provided';

  resultServer.textContent = results.test_server || 'Local Server';

  const deviceParts = [results.operating_system, results.browser].filter(Boolean);
  resultDevice.textContent = deviceParts.length > 0 ? deviceParts.join(' / ') : 'Not available';

  const quality = calculateQuality(
    results.download_speed,
    results.upload_speed,
    results.ping,
    results.jitter,
    results.packet_loss
  );
  qualityBadge.textContent = quality;
  qualityBadge.className = 'quality-badge ' + quality.toLowerCase();
}

// ---------- Event Listeners ----------
startBtn.addEventListener('click', async () => {
  if (!state.locationPermission) {
    showLocationModal();
    return;
  }
  await runTest();
});

allowLocationBtn.addEventListener('click', async () => {
  hideLocationModal();
  await requestLocation();
  if (state.location) {
    locationStatus.textContent = `${state.location.latitude.toFixed(3)}, ${state.location.longitude.toFixed(3)}`;
  } else {
    locationStatus.textContent = 'Not provided';
  }
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
  locationStatus.textContent = state.location ? `${state.location.latitude.toFixed(3)}, ${state.location.longitude.toFixed(3)}` : 'Not provided';
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

// ---------- Initialization ----------
async function init() {
  state.deviceInfo = getDeviceInfo();
  renderHistory();
  await initLocation();
  await fetchNetworkInfo();
  drawGauge(0, 200);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(err => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }
}

init();