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

// Load environment variables from .env file if it exists (local dev)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      process.env[key] = val;
    }
  });
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
let gistId = null;

let sysConfig = {
  inactivityThresholdSeconds: 120
};

// Memory store for DNI to Team name assignments
let teamsMapping = {};

// Directories for storing data
const DATA_DIR = path.join(__dirname, 'data');
const AUDITS_DIR = path.join(DATA_DIR, 'audits');
const INACTIVITY_DIR = path.join(DATA_DIR, 'inactivity');
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');
const BIN_DIR = path.join(__dirname, 'bin');

// Ensure directories exist
[DATA_DIR, AUDITS_DIR, INACTIVITY_DIR, BIN_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Load teams cache locally at startup if it exists
if (fs.existsSync(TEAMS_FILE)) {
  try {
    teamsMapping = JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8'));
    console.log(`[TEAMS] Loaded ${Object.keys(teamsMapping).length} assignments from local cache.`);
  } catch (e) {
    console.error('[TEAMS] Error reading local teams.json:', e);
  }
}

// Current active client version (change this to test OTA updates)
const LATEST_CLIENT_VERSION = '1.2.0';

// Memory store for pending silent audit requests
const pendingAudits = {};

// Memory store for pending silent uninstall requests
const pendingUninstalls = {};

// Helper to extract the client's real public IP address
const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress;
};

// Helper to resolve an IP address to geographic location and ISP details
async function getIpLocation(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.')) {
    return {
      publicIp: ip || 'Local',
      location: 'Conexión Local / VPN',
      isp: 'Intranet / Localhost'
    };
  }

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === 'success') {
        return {
          publicIp: ip,
          location: `${data.city || 'Desconocida'}, ${data.country || 'Desconocido'}`,
          isp: data.isp || 'Desconocido'
        };
      }
    }
  } catch (e) {
    console.error(`[GEOLOCATION] Error fetching location for IP ${ip}:`, e);
  }

  return {
    publicIp: ip,
    location: 'Desconocida',
    isp: 'Desconocido'
  };
}

async function initGistDatabase() {
  if (!GITHUB_TOKEN) {
    console.warn('[GIST] WARNING: GITHUB_TOKEN environment variable not set. Persisted database will not be restored.');
    return;
  }

  try {
    console.log('[GIST] Checking for existing SecurTrack Database Gist...');
    const res = await fetch('https://api.github.com/gists', {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'SecurTrack-Backend',
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to list gists: ${res.statusText}`);
    }

    const gists = await res.json();
    const targetGist = gists.find(g => g.description === 'SecurTrack Database');

    if (targetGist) {
      gistId = targetGist.id;
      console.log(`[GIST] Found existing Gist with ID: ${gistId}. Restoring local cache...`);

      const gistRes = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'User-Agent': 'SecurTrack-Backend'
        }
      });
      const gistData = await gistRes.json();

      // Restore devices
      if (gistData.files['devices.json'] && gistData.files['devices.json'].content) {
        try {
          const devices = JSON.parse(gistData.files['devices.json'].content);
          if (Array.isArray(devices)) {
            devices.forEach(device => {
              const filePath = path.join(AUDITS_DIR, `${device.documentId}.json`);
              fs.writeFileSync(filePath, JSON.stringify(device, null, 2), 'utf8');
            });
            console.log(`[GIST] Restored ${devices.length} devices.`);
          }
        } catch (e) {
          console.error('[GIST] Error parsing devices.json from gist:', e);
        }
      }

      // Restore inactivity alerts
      if (gistData.files['inactivity.json'] && gistData.files['inactivity.json'].content) {
        try {
          const alerts = JSON.parse(gistData.files['inactivity.json'].content);
          if (Array.isArray(alerts)) {
            alerts.forEach(alert => {
              const filePath = path.join(INACTIVITY_DIR, `${Date.parse(alert.startTime) || Date.now()}_${alert.documentId}.json`);
              fs.writeFileSync(filePath, JSON.stringify(alert, null, 2), 'utf8');
            });
            console.log(`[GIST] Restored ${alerts.length} inactivity alerts.`);
          }
        } catch (e) {
          console.error('[GIST] Error parsing inactivity.json from gist:', e);
        }
      }

      // Restore config
      if (gistData.files['config.json'] && gistData.files['config.json'].content) {
        try {
          const parsedConfig = JSON.parse(gistData.files['config.json'].content);
          if (parsedConfig && typeof parsedConfig.inactivityThresholdSeconds === 'number') {
            sysConfig = parsedConfig;
            console.log(`[GIST] Restored config: Inactivity Threshold = ${sysConfig.inactivityThresholdSeconds}s`);
          }
        } catch (e) {
          console.error('[GIST] Error parsing config.json from gist:', e);
        }
      }

      // Restore teams assignments
      if (gistData.files['teams.json'] && gistData.files['teams.json'].content) {
        try {
          teamsMapping = JSON.parse(gistData.files['teams.json'].content);
          fs.writeFileSync(TEAMS_FILE, JSON.stringify(teamsMapping, null, 2), 'utf8');
          console.log(`[GIST] Restored ${Object.keys(teamsMapping).length} team assignments.`);
        } catch (e) {
          console.error('[GIST] Error parsing teams.json from gist:', e);
        }
      }
    } else {
      console.log('[GIST] SecurTrack Database Gist not found. Creating a new one...');
      const createRes = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'User-Agent': 'SecurTrack-Backend',
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify({
          description: 'SecurTrack Database',
          public: false,
          files: {
            'devices.json': { content: '[]' },
            'inactivity.json': { content: '[]' },
            'config.json': { content: JSON.stringify(sysConfig, null, 2) },
            'teams.json': { content: '{}' }
          }
        })
      });

      if (!createRes.ok) {
        throw new Error(`Failed to create gist: ${createRes.statusText}`);
      }

      const newGist = await createRes.json();
      gistId = newGist.id;
      console.log(`[GIST] Created new private Gist with ID: ${gistId}`);
    }
  } catch (error) {
    console.error('[GIST] Error during Gist initialization:', error);
  }
}

async function syncGist() {
  if (!GITHUB_TOKEN || !gistId) return;

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
          } catch (e) {}
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
          } catch (e) {}
        }
      });
    }

    // Perform PATCH update
    fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'SecurTrack-Backend',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json'
      },
      body: JSON.stringify({
        files: {
          'devices.json': { content: JSON.stringify(devices, null, 2) },
          'inactivity.json': { content: JSON.stringify(inactivityAlerts, null, 2) },
          'config.json': { content: JSON.stringify(sysConfig, null, 2) },
          'teams.json': { content: JSON.stringify(teamsMapping, null, 2) }
        }
      })
    }).then(res => {
      if (res.ok) {
        console.log('[GIST] Successfully backed up local database to GitHub Gist.');
      } else {
        console.error('[GIST] Failed to update Gist:', res.statusText);
      }
    }).catch(err => {
      console.error('[GIST] Error uploading backup to Gist:', err);
    });
  } catch (error) {
    console.error('[GIST] Error preparing Gist sync:', error);
  }
}

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
app.post('/api/audit', async (req, res) => {
  try {
    const auditData = req.body;
    if (!auditData.documentId || !auditData.fullName) {
      return res.status(400).json({ success: false, error: 'DocumentId and FullName are required.' });
    }

    // Capture and fetch geolocation info
    const clientIp = getClientIp(req);
    const locInfo = await getIpLocation(clientIp);
    auditData.publicIp = locInfo.publicIp;
    auditData.location = locInfo.location;
    auditData.isp = locInfo.isp;

    const filename = `${auditData.documentId}.json`;
    const filePath = path.join(AUDITS_DIR, filename);

    // Save/Overwrite the audit file for the user
    auditData.lastActive = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(auditData, null, 2), 'utf8');
    console.log(`[AUDIT] Saved report for ${auditData.fullName} (${auditData.documentId}) from IP ${clientIp}`);

    // Backup to GitHub Gist asynchronously
    syncGist();

    res.json({ success: true, message: 'Audit report saved successfully.' });
  } catch (error) {
    console.error('Error saving audit report:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// Endpoint: Receive Heartbeat
app.post('/api/heartbeat', (req, res) => {
  try {
    const { documentId, activeWindow } = req.body;
    if (!documentId) {
      return res.status(400).json({ success: false, error: 'DocumentId is required.' });
    }

    const filename = `${documentId}.json`;
    const filePath = path.join(AUDITS_DIR, filename);

    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      data.lastActive = new Date().toISOString();
      data.activeWindow = activeWindow || 'Ninguno';

      // Capture client IP and run async geolocation lookup if it changed
      const currentIp = getClientIp(req);
      if (data.publicIp !== currentIp) {
        data.publicIp = currentIp;
        getIpLocation(currentIp).then(locInfo => {
          try {
            if (fs.existsSync(filePath)) {
              const latestData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
              latestData.publicIp = locInfo.publicIp;
              latestData.location = locInfo.location;
              latestData.isp = locInfo.isp;
              fs.writeFileSync(filePath, JSON.stringify(latestData, null, 2), 'utf8');
              syncGist();
            }
          } catch (err) {
            console.error('[HEARTBEAT-LOC] Error updating async location:', err);
          }
        }).catch(err => {
          console.error('[HEARTBEAT-LOC] Location lookup failed:', err);
        });
      } else {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      }
      
      // Check if there is a pending audit request for this DNI
      const requestAudit = !!pendingAudits[documentId];
      if (requestAudit) {
        delete pendingAudits[documentId]; // Clear request once sent
        console.log(`[HEARTBEAT] Sent silent audit request to ${documentId}`);
      }

      // Check if there is a pending uninstall request for this DNI
      const requestUninstall = !!pendingUninstalls[documentId];
      if (requestUninstall) {
        delete pendingUninstalls[documentId]; // Clear request once sent
        console.log(`[HEARTBEAT] Sent silent uninstall request to ${documentId}`);
      }
      
      return res.json({ 
        success: true, 
        message: 'Heartbeat received.', 
        requestAudit, 
        requestUninstall,
        inactivityThresholdSeconds: sysConfig.inactivityThresholdSeconds 
      });
    }

    res.status(404).json({ success: false, error: 'Device not found.' });
  } catch (error) {
    console.error('Error handling heartbeat:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// Endpoint: Queue silent re-audit request from Dashboard
app.post('/api/devices/:documentId/request-audit', (req, res) => {
  try {
    const { documentId } = req.params;
    pendingAudits[documentId] = true;
    console.log(`[AUDIT-REQUEST] Queued silent audit command for worker ${documentId}`);
    res.json({ success: true, message: 'Re-audit request queued successfully.' });
  } catch (error) {
    console.error('Error queueing audit request:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// Endpoint: Queue silent uninstallation request from Dashboard
app.post('/api/devices/:documentId/request-uninstall', (req, res) => {
  try {
    const { documentId } = req.params;
    pendingUninstalls[documentId] = true;
    console.log(`[UNINSTALL-REQUEST] Queued silent uninstall command for worker ${documentId}`);
    res.json({ success: true, message: 'Uninstall request queued successfully.' });
  } catch (error) {
    console.error('Error queueing uninstall request:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// Endpoint: Get System Configuration
app.get('/api/config', (req, res) => {
  res.json({ success: true, config: sysConfig });
});

// Endpoint: Update System Configuration
app.post('/api/config', (req, res) => {
  try {
    const { inactivityThresholdSeconds } = req.body;
    if (typeof inactivityThresholdSeconds !== 'number' || inactivityThresholdSeconds <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid inactivity threshold value.' });
    }
    sysConfig.inactivityThresholdSeconds = inactivityThresholdSeconds;
    console.log(`[CONFIG] Updated inactivity threshold to ${inactivityThresholdSeconds} seconds.`);
    
    // Sync with GitHub Gist asynchronously
    syncGist();
    
    res.json({ success: true, message: 'Configuration updated successfully.', config: sysConfig });
  } catch (error) {
    console.error('Error updating config:', error);
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

    // Backup to GitHub Gist asynchronously
    syncGist();

    res.json({ success: true, message: 'Inactivity alert saved successfully.' });
  } catch (error) {
    console.error('Error saving inactivity alert:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// Endpoint: Get team assignments
app.get('/api/teams', (req, res) => {
  res.json({ success: true, teams: teamsMapping });
});

// Endpoint: Save team assignment for a device
app.post('/api/teams', (req, res) => {
  try {
    const { documentId, team } = req.body;
    if (!documentId) {
      return res.status(400).json({ success: false, error: 'DocumentId is required.' });
    }
    
    if (team && team !== 'Sin Equipo') {
      teamsMapping[documentId] = team;
    } else {
      delete teamsMapping[documentId];
    }
    
    fs.writeFileSync(TEAMS_FILE, JSON.stringify(teamsMapping, null, 2), 'utf8');
    console.log(`[TEAMS] Assigned DNI ${documentId} to team: ${team || 'Sin Equipo'}`);
    
    // Sync with GitHub Gist asynchronously
    syncGist();
    
    res.json({ success: true, teams: teamsMapping });
  } catch (error) {
    console.error('Error saving team assignment:', error);
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
            const deviceData = JSON.parse(content);
            deviceData.isOnline = deviceData.lastActive ? (Date.now() - new Date(deviceData.lastActive).getTime()) < 45000 : false;
            
            // Inject team classification
            deviceData.team = teamsMapping[deviceData.documentId] || 'Sin Equipo';
            
            devices.push(deviceData);
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
    const onlineCount = devices.filter(d => d.isOnline).length;

    res.json({
      success: true,
      stats: {
        total: totalDevices,
        aptos: aptos,
        noAptos: noAptos,
        online: onlineCount
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
  
  // Initialize and restore Gist database
  initGistDatabase();
});
