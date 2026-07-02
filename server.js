const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON body parser with increased limit for speed test uploads
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static dashboard files
app.use(express.static(path.join(__dirname, 'public')));

// Directories for storing data
const DATA_DIR = path.join(__dirname, 'data');
const AUDITS_DIR = path.join(DATA_DIR, 'audits');
const INACTIVITY_DIR = path.join(DATA_DIR, 'inactivity');
const BIN_DIR = path.join(__dirname, 'bin');

// Ensure directories exist
[DATA_DIR, AUDITS_DIR, INACTIVITY_DIR, BIN_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Current active client version (change this to test OTA updates)
const LATEST_CLIENT_VERSION = '1.0.4';

// Helper to compare version strings (simple semver check)
function isOlderVersion(current, latest) {
  const cParts = current.split('.').map(Number);
  const lParts = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const c = cParts[i] || 0;
    const l = lParts[i] || 0;
    if (c < l) return true;
    if (c > l) return false;
  }
  return false;
}

// Endpoint: Send Audit Report
app.post('/api/audit', (req, res) => {
  try {
    const auditData = req.body;
    if (!auditData.documentId || !auditData.fullName) {
      return res.status(400).json({ success: false, error: 'DocumentId and FullName are required.' });
    }

    const filename = `${auditData.documentId}.json`;
    const filePath = path.join(AUDITS_DIR, filename);

    // Save/Overwrite the audit file for the user
    fs.writeFileSync(filePath, JSON.stringify(auditData, null, 2), 'utf8');
    console.log(`[AUDIT] Saved report for ${auditData.fullName} (${auditData.documentId})`);

    res.json({ success: true, message: 'Audit report saved successfully.' });
  } catch (error) {
    console.error('Error saving audit report:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// Endpoint: Send Inactivity Alert
app.post('/api/inactivity', (req, res) => {
  try {
    const alertData = req.body;
    if (!alertData.documentId || !alertData.fullName || !alertData.startTime) {
      return res.status(400).json({ success: false, error: 'DocumentId, FullName, and StartTime are required.' });
    }

    // Save with unique name: timestamp_dni.json
    const timestamp = Date.now();
    const filename = `${timestamp}_${alertData.documentId}.json`;
    const filePath = path.join(INACTIVITY_DIR, filename);

    fs.writeFileSync(filePath, JSON.stringify(alertData, null, 2), 'utf8');
    console.log(`[INACTIVITY] Saved inactivity alert for ${alertData.fullName} (${alertData.documentId}): ${alertData.durationSeconds}s`);

    res.json({ success: true, message: 'Inactivity alert saved successfully.' });
  } catch (error) {
    console.error('Error saving inactivity alert:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// Endpoint: Check for OTA Updates
app.get('/api/update/check', (req, res) => {
  const currentVersion = req.query.version;
  if (!currentVersion) {
    return res.status(400).json({ success: false, error: 'Current version query parameter required.' });
  }

  const updateAvailable = isOlderVersion(currentVersion, LATEST_CLIENT_VERSION);

  res.json({
    success: true,
    updateAvailable: updateAvailable,
    currentVersion: currentVersion,
    latestVersion: LATEST_CLIENT_VERSION,
    downloadUrl: `/api/update/download`
  });
});

// Endpoint: Download Latest Client Binary
app.get('/api/update/download', (req, res) => {
  const binaryPath = path.join(BIN_DIR, 'tester.exe');
  if (fs.existsSync(binaryPath)) {
    res.download(binaryPath, 'tester.exe');
  } else {
    // Return 404 or serve a dummy message if not compiled yet
    res.status(404).send('Latest binary not available on the server yet. Compile client and copy to src/Backend/bin/');
  }
});

// Endpoint: Speedtest Upload (receives dummy bytes and discards them)
app.post('/api/speedtest/upload', (req, res) => {
  // Just send success back to calculate time spent
  res.json({ success: true });
});

// Endpoint: Dashboard Stats Consolidation
app.get('/api/dashboard/stats', (req, res) => {
  try {
    const devices = [];
    const inactivityAlerts = [];

    // Read all audits
    if (fs.existsSync(AUDITS_DIR)) {
      const files = fs.readdirSync(AUDITS_DIR);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          try {
            const content = fs.readFileSync(path.join(AUDITS_DIR, file), 'utf8');
            devices.push(JSON.parse(content));
          } catch (e) {
            console.error(`Error reading audit file ${file}:`, e);
          }
        }
      });
    }

    // Read all inactivity alerts
    if (fs.existsSync(INACTIVITY_DIR)) {
      const files = fs.readdirSync(INACTIVITY_DIR);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          try {
            const content = fs.readFileSync(path.join(INACTIVITY_DIR, file), 'utf8');
            inactivityAlerts.push(JSON.parse(content));
          } catch (e) {
            console.error(`Error reading inactivity file ${file}:`, e);
          }
        }
      });
    }

    // Sort inactivity alerts by startTime descending (newest first)
    inactivityAlerts.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    // Calculate aggregated metrics
    const totalDevices = devices.length;
    const aptos = devices.filter(d => d.status === 'Apto').length;
    const noAptos = totalDevices - aptos;

    res.json({
      success: true,
      stats: {
        total: totalDevices,
        aptos: aptos,
        noAptos: noAptos
      },
      devices,
      inactivityAlerts
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` Hardware Monitor Backend Running on port ${PORT}`);
  console.log(` Dashboard URL: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
