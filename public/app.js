document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const refreshBtn = document.getElementById('refreshBtn');
  const statTotal = document.getElementById('statTotal');
  const statAptos = document.getElementById('statAptos');
  const statAptosPct = document.getElementById('statAptosPct');
  const statNoAptos = document.getElementById('statNoAptos');
  const statNoAptosPct = document.getElementById('statNoAptosPct');
  const statAlerts = document.getElementById('statAlerts');
  
  const devicesContainer = document.getElementById('devicesContainer');
  const inactivityTableBody = document.getElementById('inactivityTableBody');
  const deviceSearch = document.getElementById('deviceSearch');
  
  const deviceModal = document.getElementById('deviceModal');
  const closeModal = document.getElementById('closeModal');
  const modalDeviceName = document.getElementById('modalDeviceName');
  const modalBody = document.getElementById('modalBody');

  let allDevices = [];
  let allAlerts = [];

  // Fetch Data from Server API
  async function fetchStats() {
    try {
      showLoading(true);
      const response = await fetch('/api/dashboard/stats');
      const data = await response.json();
      
      if (data.success) {
        allDevices = data.devices || [];
        allAlerts = data.inactivityAlerts || [];
        renderDashboard();
      } else {
        console.error('Error returned by API:', data.error);
        showError('No se pudo obtener información del servidor.');
      }
    } catch (error) {
      console.error('Network error fetching dashboard stats:', error);
      showError('Error de red. Asegúrate de que el servidor está en ejecución.');
    } finally {
      showLoading(false);
    }
  }

  // Render dashboard elements
  function renderDashboard() {
    // 1. KPI Numbers
    const total = allDevices.length;
    const aptos = allDevices.filter(d => d.status === 'Apto').length;
    const noAptos = total - aptos;
    const alertsCount = allAlerts.length;

    statTotal.textContent = total;
    statAptos.textContent = aptos;
    statNoAptos.textContent = noAptos;
    statAlerts.textContent = alertsCount;

    // Percentages
    const aptosPctVal = total > 0 ? Math.round((aptos / total) * 100) : 0;
    const noAptosPctVal = total > 0 ? Math.round((noAptos / total) * 100) : 0;
    
    statAptosPct.textContent = `${aptosPctVal}% del total`;
    statNoAptosPct.textContent = `${noAptosPctVal}% del total`;

    // 2. Render Devices List (Filtered)
    filterAndRenderDevices();

    // 3. Render Inactivity Logs
    renderInactivityAlerts();
  }

  // Filter and Render Devices Grid
  function filterAndRenderDevices() {
    const searchTerm = deviceSearch.value.trim().toLowerCase();
    const filteredDevices = allDevices.filter(d => 
      d.fullName.toLowerCase().includes(searchTerm) || 
      d.documentId.toLowerCase().includes(searchTerm)
    );

    if (filteredDevices.length === 0) {
      devicesContainer.innerHTML = `
        <div class="no-data" style="grid-column: 1 / -1;">
          <p>No se encontraron equipos auditados.</p>
        </div>
      `;
      return;
    }

    devicesContainer.innerHTML = '';
    filteredDevices.forEach(device => {
      const card = document.createElement('div');
      card.className = 'device-card';
      card.addEventListener('click', () => openDeviceDetails(device));

      const statusClass = device.status === 'Apto' ? 'badge-apto' : 'badge-noapto';
      const diskLabel = device.hardware.isSSD ? 'SSD' : 'HDD';
      
      // Calculate speeds in Mbps
      const downloadSpeed = device.network.downloadMbps ? device.network.downloadMbps.toFixed(1) : 'N/A';
      const uploadSpeed = device.network.uploadMbps ? device.network.uploadMbps.toFixed(1) : 'N/A';

      card.innerHTML = `
        <div class="device-card-header">
          <div class="device-user">
            <h3>${escapeHtml(device.fullName)}</h3>
            <p>ID: ${escapeHtml(device.documentId)}</p>
          </div>
          <span class="badge ${statusClass}">${device.status}</span>
        </div>
        <div class="device-specs">
          <div class="spec-item">
            <span class="spec-key">Procesador</span>
            <span class="spec-val" title="${escapeHtml(device.hardware.cpuName)}">${truncateString(device.hardware.cpuName, 22)}</span>
          </div>
          <div class="spec-item">
            <span class="spec-key">RAM</span>
            <span class="spec-val">${device.hardware.ramGB} GB</span>
          </div>
          <div class="spec-item">
            <span class="spec-key">Disco</span>
            <span class="spec-val">${diskLabel} (${device.hardware.freeDiskGB.toFixed(0)} GB Libres)</span>
          </div>
        </div>
        <div class="device-card-footer">
          <div class="speed-summary">
            <span>⬇️ ${downloadSpeed} M</span>
            <span>⬆️ ${uploadSpeed} M</span>
          </div>
          <div class="ping-summary">
            <span>⚡ ${device.network.pingMs.toFixed(0)} ms</span>
          </div>
        </div>
      `;
      devicesContainer.appendChild(card);
    });
  }

  // Render Inactivity Log Table
  function renderInactivityAlerts() {
    if (allAlerts.length === 0) {
      inactivityTableBody.innerHTML = `
        <tr>
          <td colspan="4" class="no-data">No hay alertas de inactividad registradas.</td>
        </tr>
      `;
      return;
    }

    inactivityTableBody.innerHTML = '';
    allAlerts.forEach(alert => {
      const row = document.createElement('tr');
      const timeString = new Date(alert.startTime).toLocaleString('es-ES');
      const minutes = Math.floor(alert.durationSeconds / 60);
      const seconds = Math.floor(alert.durationSeconds % 60);
      const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

      row.innerHTML = `
        <td><strong>${escapeHtml(alert.fullName)}</strong></td>
        <td>${escapeHtml(alert.documentId)}</td>
        <td>${timeString}</td>
        <td><span class="inactivity-duration">${durationStr}</span></td>
      `;
      inactivityTableBody.appendChild(row);
    });
  }

  // Open Details Modal for a Device
  function openDeviceDetails(device) {
    modalDeviceName.textContent = `Reporte de: ${device.fullName}`;
    
    // Evaluation Logic representation
    const cpuPass = device.hardware.cpuApto ? 'pass' : 'fail';
    const ramPass = device.hardware.ramApto ? (device.hardware.ramGB >= 16 ? 'pass' : 'warn') : 'fail';
    const diskSpacePass = device.hardware.diskSpaceApto ? 'pass' : 'fail';
    const diskTypePass = device.hardware.isSSD ? 'pass' : 'fail';
    const osPass = device.hardware.osApto ? 'pass' : 'fail';
    
    const downloadPass = device.network.downloadApto ? 'pass' : 'fail';
    const uploadPass = device.network.uploadApto ? 'pass' : 'fail';
    const latencyPass = device.network.pingApto ? 'pass' : 'fail';
    
    const micPass = device.multimedia.hasMicrophone ? 'pass' : 'fail';
    const camPass = device.multimedia.hasWebcam ? 'pass' : 'fail';

    const bootTimeStr = new Date(device.uptime.bootTimestamp).toLocaleString('es-ES');
    const auditTimeStr = new Date(device.auditTimestamp).toLocaleString('es-ES');

    modalBody.innerHTML = `
      <div class="detail-grid">
        <!-- Colaborador Section -->
        <div class="detail-section detail-full-width">
          <h3>Información General</h3>
          <div class="detail-row">
            <span class="detail-label">Nombre del Colaborador</span>
            <span class="detail-value"><strong>${escapeHtml(device.fullName)}</strong></span>
          </div>
          <div class="detail-row">
            <span class="detail-label">DNI / ID</span>
            <span class="detail-value">${escapeHtml(device.documentId)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Fecha de Auditoría</span>
            <span class="detail-value">${auditTimeStr}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Uptime (Encendido de PC)</span>
            <span class="detail-value">${bootTimeStr}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Versión de Agente</span>
            <span class="detail-value">${escapeHtml(device.agentVersion || '1.0.0')}</span>
          </div>
        </div>

        <!-- Hardware Evaluation -->
        <div class="detail-section">
          <h3>Evaluación de Hardware</h3>
          <div class="detail-row">
            <span class="detail-label">Procesador</span>
            <span class="detail-value ${cpuPass}" title="${escapeHtml(device.hardware.cpuName)}">${truncateString(device.hardware.cpuName, 18)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Memoria RAM</span>
            <span class="detail-value ${ramPass}">${device.hardware.ramGB} GB ${device.hardware.ramGB >= 16 ? '(Recomendado)' : (device.hardware.ramGB >= 8 ? '(Mínimo)' : '(Insuficiente)')}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label font-bold">Tipo de Disco</span>
            <span class="detail-value ${diskTypePass}">${device.hardware.isSSD ? 'SSD (Apto)' : 'HDD (No Apto)'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Espacio Libre</span>
            <span class="detail-value ${diskSpacePass}">${device.hardware.freeDiskGB.toFixed(1)} GB Libres</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Sistema Operativo</span>
            <span class="detail-value ${osPass}">${escapeHtml(device.hardware.osName)}</span>
          </div>
        </div>

        <!-- Network Evaluation -->
        <div class="detail-section">
          <h3>Prueba de Conexión</h3>
          <div class="detail-row">
            <span class="detail-label">Velocidad Descarga</span>
            <span class="detail-value ${downloadPass}">${device.network.downloadMbps ? device.network.downloadMbps.toFixed(1) : 'N/A'} Mbps</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Velocidad Subida</span>
            <span class="detail-value ${uploadPass}">${device.network.uploadMbps ? device.network.uploadMbps.toFixed(1) : 'N/A'} Mbps</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Latencia (Ping)</span>
            <span class="detail-value ${latencyPass}">${device.network.pingMs.toFixed(1)} ms</span>
          </div>
        </div>

        <!-- Multimedia Evaluation -->
        <div class="detail-section detail-full-width">
          <h3>Auditoría Multimedia</h3>
          <div class="detail-row">
            <span class="detail-label">Micrófonos Habilitados</span>
            <span class="detail-value ${micPass}">${device.multimedia.hasMicrophone ? `Sí (${device.multimedia.micCount} detectados)` : 'No se detecta Micrófono'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Cámara Web Habilitada</span>
            <span class="detail-value ${camPass}">${device.multimedia.hasWebcam ? `Sí (${device.multimedia.webcamCount} detectadas)` : 'No se detecta Cámara'}</span>
          </div>
        </div>
      </div>
    `;
    
    deviceModal.classList.add('open');
  }

  // Loading indicator helper
  function showLoading(isLoading) {
    if (isLoading) {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<span class="spinner" style="width:16px; height:16px; border-width:2px; display:inline-block;"></span> Actualizando...';
    } else {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<span class="btn-icon">🔄</span> Actualizar Datos';
    }
  }

  function showError(msg) {
    devicesContainer.innerHTML = `
      <div class="no-data" style="grid-column: 1 / -1; color: var(--color-danger);">
        <p>⚠️ ${escapeHtml(msg)}</p>
      </div>
    `;
    inactivityTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="no-data" style="color: var(--color-danger);">⚠️ ${escapeHtml(msg)}</td>
      </tr>
    `;
  }

  // Close modal event
  closeModal.addEventListener('click', () => {
    deviceModal.classList.remove('open');
  });

  window.addEventListener('click', (e) => {
    if (e.target === deviceModal) {
      deviceModal.classList.remove('open');
    }
  });

  // Search input event
  deviceSearch.addEventListener('input', () => {
    filterAndRenderDevices();
  });

  // Refresh button event
  refreshBtn.addEventListener('click', fetchStats);

  // HTML escaping helper
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // String truncator
  function truncateString(str, num) {
    if (!str) return 'N/A';
    if (str.length <= num) return str;
    return str.slice(0, num) + '...';
  }

  // Initial Fetch
  fetchStats();
});
