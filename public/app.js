document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const refreshBtn = document.getElementById('refreshBtn');
  const statTotal = document.getElementById('statTotal');
  const statAptos = document.getElementById('statAptos');
  const statAptosPct = document.getElementById('statAptosPct');
  const statNoAptos = document.getElementById('statNoAptos');
  const statNoAptosPct = document.getElementById('statNoAptosPct');
  const statAlerts = document.getElementById('statAlerts');
  
  const tabCardsBtn = document.getElementById('tabCardsBtn');
  const tabListBtn = document.getElementById('tabListBtn');
  const devicesContainer = document.getElementById('devicesContainer');
  const devicesTableContainer = document.getElementById('devicesTableContainer');
  const devicesTableBody = document.getElementById('devicesTableBody');
  const inactivityTimeline = document.getElementById('inactivityTimeline');
  const deviceSearch = document.getElementById('deviceSearch');
  const dateFilter = document.getElementById('dateFilter');
  const exportDevicesBtn = document.getElementById('exportDevicesBtn');
  const exportInactivityBtn = document.getElementById('exportInactivityBtn');
  
  const deviceModal = document.getElementById('deviceModal');
  const closeModal = document.getElementById('closeModal');
  const modalDeviceName = document.getElementById('modalDeviceName');
  const modalBody = document.getElementById('modalBody');

  // Status Filter Buttons
  const filterAllBtn = document.getElementById('filterAllBtn');
  const filterOnlineBtn = document.getElementById('filterOnlineBtn');
  const filterOfflineBtn = document.getElementById('filterOfflineBtn');

  let allDevices = [];
  let allAlerts = [];
  let activeStateFilter = 'all'; // 'all', 'online', 'offline'

  // Global State for Alerts
  let previousDeviceStates = {}; // documentId -> isOnline
  let previousAlertCount = 0;
  let isMuted = localStorage.getItem('alertsMuted') === 'true';

  // Set initial default tab view (Monitoreo de Conexión active)
  devicesContainer.style.display = 'none';
  devicesTableContainer.style.display = 'block';

  // Synth sounds using Web Audio API (no dependencies)
  function playChimeSound() {
    if (isMuted) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.45);
    } catch (e) {
      console.warn("AudioContext blocked:", e);
    }
  }

  function playWarningSound() {
    if (isMuted) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, ctx.currentTime); // A3
      osc.frequency.setValueAtTime(220, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.12, ctx.currentTime + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) {
      console.warn("AudioContext blocked:", e);
    }
  }

  // Floating Toast Notifications Center
  function showToast(title, desc, type = 'danger') {
    const container = document.getElementById('notificationCenter');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;

    let iconSvg = '';
    if (type === 'danger') {
      iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    } else if (type === 'warning') {
      iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
    } else {
      iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    toast.innerHTML = `
      <div class="toast-notification-icon" style="display:flex; align-items:center;">${iconSvg}</div>
      <div class="toast-notification-content">
        <div class="toast-notification-title">${escapeHtml(title)}</div>
        <div class="toast-notification-desc">${escapeHtml(desc)}</div>
      </div>
      <button class="toast-notification-close">&times;</button>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 50);

    const removeTimeout = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 6000);

    toast.querySelector('.toast-notification-close').addEventListener('click', () => {
      clearTimeout(removeTimeout);
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    });
  }

  // Load / Update dynamic config from web
  const thresholdInput = document.getElementById('thresholdInput');
  const saveConfigBtn = document.getElementById('saveConfigBtn');

  async function loadSystemConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      if (data.success && data.config) {
        thresholdInput.value = data.config.inactivityThresholdSeconds;
      }
    } catch (e) {
      console.error("Error loading config:", e);
    }
  }

  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', async () => {
      const val = parseInt(thresholdInput.value, 10);
      if (isNaN(val) || val <= 0) {
        alert("Por favor ingresa un número de segundos válido.");
        return;
      }
      saveConfigBtn.disabled = true;
      saveConfigBtn.innerText = "...";
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inactivityThresholdSeconds: val })
        });
        const data = await res.json();
        if (data.success) {
          showToast("Configuración Guardada", `El umbral de inactividad se actualizó a ${val} segundos.`, 'info');
        } else {
          alert("Error al guardar: " + data.error);
        }
      } catch (e) {
        alert("Error al conectar con el servidor.");
      } finally {
        saveConfigBtn.disabled = false;
        saveConfigBtn.innerText = "Aplicar";
      }
    });
  }

  // Mute / Unmute Button toggler
  const muteBtn = document.getElementById('muteBtn');
  const volumeIcon = document.getElementById('volumeIcon');

  function updateMuteButtonState() {
    if (isMuted) {
      muteBtn.classList.add('muted');
      volumeIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
        <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
      `;
    } else {
      muteBtn.classList.remove('muted');
      volumeIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      `;
    }
  }

  if (muteBtn) {
    updateMuteButtonState();
    muteBtn.addEventListener('click', () => {
      isMuted = !isMuted;
      localStorage.setItem('alertsMuted', isMuted);
      updateMuteButtonState();
    });
  }

  // Fetch Data from Server API
  async function fetchStats() {
    try {
      showLoading(true);
      const response = await fetch('/api/dashboard/stats');
      const data = await response.json();
      
      if (data.success) {
        const devices = data.devices || [];
        const alerts = data.inactivityAlerts || [];
        
        // 1. Connection Warning Check (Offline Drops)
        devices.forEach(dev => {
          const docId = dev.documentId;
          const wasOnline = previousDeviceStates[docId];
          const isOnlineNow = dev.isOnline;
          
          if (wasOnline === true && isOnlineNow === false) {
            showToast("Dispositivo Desconectado", `${dev.fullName} se ha desconectado o apagado.`, 'danger');
            playWarningSound();
            
            // Flash row & card in red warning
            setTimeout(() => {
              const rowEl = document.getElementById(`device-row-${docId}`);
              const cardEl = document.getElementById(`device-card-${docId}`);
              if (rowEl) {
                rowEl.classList.add('row-alert-active');
                setTimeout(() => rowEl.classList.remove('row-alert-active'), 10000);
              }
              if (cardEl) {
                cardEl.classList.add('row-alert-active');
                setTimeout(() => cardEl.classList.remove('row-alert-active'), 10000);
              }
            }, 100);
          }
          
          previousDeviceStates[docId] = isOnlineNow;
        });

        // 2. New Inactivity Alert Check
        const currentAlertCount = alerts.length;
        if (previousAlertCount > 0 && currentAlertCount > previousAlertCount) {
          const latestAlert = alerts[0];
          if (latestAlert) {
            showToast("Alerta de Inactividad", `${latestAlert.fullName} estuvo inactivo por ${Math.round(latestAlert.durationSeconds)}s.`, 'warning');
            playChimeSound();
          }
        }
        previousAlertCount = currentAlertCount;

        allDevices = devices;
        allAlerts = alerts;
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

  // Helper to format minutes into a human-readable format (e.g. 15 min or 3h 48m)
  function formatInactivityTime(totalMinutes) {
    if (totalMinutes < 60) {
      return `${totalMinutes} min`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  }

  // Helper to filter alerts list by date selection
  function getFilteredAlertsByDate() {
    const selectVal = dateFilter ? dateFilter.value : 'today';
    const now = new Date();
    
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    
    const startOfYesterday = new Date();
    startOfYesterday.setDate(now.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);
    
    const endOfYesterday = new Date();
    endOfYesterday.setDate(now.getDate() - 1);
    endOfYesterday.setHours(23, 59, 59, 999);
    
    const startOf7DaysAgo = new Date();
    startOf7DaysAgo.setDate(now.getDate() - 7);
    startOf7DaysAgo.setHours(0, 0, 0, 0);

    return allAlerts.filter(alert => {
      const alertDate = new Date(alert.startTime);
      if (selectVal === 'today') {
        return alertDate >= startOfToday;
      } else if (selectVal === 'yesterday') {
        return alertDate >= startOfYesterday && alertDate <= endOfYesterday;
      } else if (selectVal === 'week') {
        return alertDate >= startOf7DaysAgo;
      }
      return true; // 'all'
    });
  }

  // Helper for friendly relative time
  function getRelativeTime(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 5) return 'Justo ahora';
    if (seconds < 60) return `Hace ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Hace ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Hace ${hours}h`;
    return date.toLocaleDateString('es-ES');
  }

  // Render dashboard elements
  function renderDashboard() {
    const activeAlerts = getFilteredAlertsByDate();

    // 1. KPI Numbers
    const total = allDevices.length;
    const aptos = allDevices.filter(d => d.status === 'Apto').length;
    const noAptos = total - aptos;
    const alertsCount = activeAlerts.length;

    const online = allDevices.filter(d => d.isOnline).length;

    statTotal.innerHTML = `${total} <span style="font-size:0.75rem; font-weight:normal; opacity:0.85; display:block; margin-top:4px;">(${online} en línea)</span>`;
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

  // Filter, Sort and Render Devices (both Cards Grid and Connectivity List)
  function filterAndRenderDevices() {
    const searchTerm = deviceSearch.value.trim().toLowerCase();
    const activeAlerts = getFilteredAlertsByDate();
    
    // First, apply text filter
    let filteredDevices = allDevices.filter(d => 
      d.fullName.toLowerCase().includes(searchTerm) || 
      d.documentId.toLowerCase().includes(searchTerm) ||
      (d.activeWindow && d.activeWindow.toLowerCase().includes(searchTerm))
    );

    // Second, apply state filter (Todos / Funcionando / Apagados)
    if (activeStateFilter === 'online') {
      filteredDevices = filteredDevices.filter(d => d.isOnline);
    } else if (activeStateFilter === 'offline') {
      filteredDevices = filteredDevices.filter(d => !d.isOnline);
    }

    // Third, sort: Connected advisors first, ordered by cumulative inactivity descending (highest idle stand out at top!)
    filteredDevices.sort((a, b) => {
      if (a.isOnline !== b.isOnline) {
        return a.isOnline ? -1 : 1;
      }
      
      const inactivityA = activeAlerts
        .filter(alert => alert.documentId === a.documentId)
        .reduce((sum, alert) => sum + alert.durationSeconds, 0);
      const inactivityB = activeAlerts
        .filter(alert => alert.documentId === b.documentId)
        .reduce((sum, alert) => sum + alert.durationSeconds, 0);
      
      if (a.isOnline) {
        return inactivityB - inactivityA;
      }
      
      return a.fullName.localeCompare(b.fullName);
    });

    // Check for empty results
    if (filteredDevices.length === 0) {
      devicesContainer.innerHTML = `
        <div class="no-data" style="grid-column: 1 / -1;">
          <p>No se encontraron asesores en este estado.</p>
        </div>
      `;
      devicesTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="no-data">No se encontraron asesores en este estado.</td>
        </tr>
      `;
      return;
    }

    devicesContainer.innerHTML = '';
    devicesTableBody.innerHTML = '';

    filteredDevices.forEach(device => {
      // Calculate Cumulative Inactivity minutes for selected date range
      const totalInactivitySeconds = activeAlerts
        .filter(a => a.documentId === device.documentId)
        .reduce((sum, a) => sum + a.durationSeconds, 0);
      const totalInactivityMinutes = Math.round(totalInactivitySeconds / 60);

      // Positive indicator
      let inactivityClass = 'zero';
      let inactivityText = '🕒 Activo';
      if (totalInactivityMinutes > 0) {
        inactivityClass = totalInactivityMinutes >= 15 ? 'heavy' : '';
        inactivityText = `🕒 Ocio: ${formatInactivityTime(totalInactivityMinutes)}`;
      }

      const totalInactivityBadge = `<span class="inactivity-badge-total ${inactivityClass}" title="Tiempo total de inactividad en el período">${inactivityText}</span>`;
      const rowInactivityBadge = `<span class="inactivity-badge-total ${inactivityClass}" title="Tiempo total de inactividad en el período">${inactivityText}</span>`;

      // Active window name formatting
      const activeWin = device.activeWindow || 'Ninguno';
      const truncatedActiveWin = truncateString(activeWin, 25);
      const activeAppTag = `
        <div class="active-app-tag" title="${escapeHtml(activeWin)}">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:2px;">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
          <span>${escapeHtml(truncatedActiveWin)}</span>
        </div>
      `;

      const advisorName = device.fullName ? escapeHtml(device.fullName) : 'Asesor Desconocido';
      const docId = device.documentId ? escapeHtml(device.documentId) : '—';

      // --- Render Device Card ---
      const card = document.createElement('div');
      card.className = 'device-card';
      card.id = `device-card-${device.documentId}`;
      
      const statusClass = device.status === 'Apto' ? 'badge-apto' : 'badge-noapto';
      const diskLabel = device.hardware.isSSD ? 'SSD' : 'HDD';
      
      const downloadSpeed = device.network.downloadMbps ? device.network.downloadMbps.toFixed(1) : 'N/A';
      const uploadSpeed = device.network.uploadMbps ? device.network.uploadMbps.toFixed(1) : 'N/A';

      const onlineIndicatorClass = device.isOnline ? 'status-online' : 'status-offline';
      const onlineIndicatorText = device.isOnline ? 'Conectado / Funcionando' : 'Apagado / Desconectado';

      card.innerHTML = `
        <div class="device-card-header">
          <div class="device-user">
            <h3 style="display: flex; align-items: center; gap: 8px;">
              <span class="status-indicator ${onlineIndicatorClass}" title="${onlineIndicatorText}"></span>
              ${advisorName}
            </h3>
            <p>ID: ${docId}</p>
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
            <span class="badge ${statusClass}">${device.status}</span>
            ${totalInactivityBadge}
          </div>
        </div>
        <div style="margin-top: -6px; margin-bottom: 4px;">
          ${activeAppTag}
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
            <span class="speed-dl" title="Velocidad de Descarga">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="19 12 12 19 5 12"></polyline>
              </svg>
              ${downloadSpeed} M
            </span>
            <span class="speed-ul" title="Velocidad de Subida">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
              ${uploadSpeed} M
            </span>
          </div>
          <button class="btn btn-secondary btn-sm request-audit-btn" style="font-size: 0.68rem; padding: 0.25rem 0.5rem; line-height: 1; border-color: rgba(3,70,121,0.15); color: #5e6b85; background: rgba(0,0,0,0.03); cursor: pointer;">
            Actualizar
          </button>
        </div>
      `;

      // Card event listeners
      card.addEventListener('click', (e) => {
        if (e.target.closest('.request-audit-btn')) return;
        openDeviceDetails(device);
      });
      card.querySelector('.request-audit-btn').addEventListener('click', (e) => {
        requestSilentAudit(device.documentId, e.target);
      });

      devicesContainer.appendChild(card);

      // --- Render Device Table Row ---
      const row = document.createElement('tr');
      row.id = `device-row-${device.documentId}`;
      row.style.cursor = 'pointer';
      
      const onlineBadgeClass = device.isOnline ? 'badge-online' : 'badge-offline';
      const onlineText = device.isOnline ? '🟢 Conectado' : '🔴 Apagado';
      const lastActiveFriendly = getRelativeTime(device.lastActive);

      row.innerHTML = `
        <td><strong>${advisorName}</strong></td>
        <td>${docId}</td>
        <td>${activeAppTag}</td>
        <td>
          <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start; justify-content: center; width: 100%;">
            <span class="badge ${onlineBadgeClass}" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.68rem; padding: 0.2rem 0.5rem; justify-content: center; width: max-content;">
              ${onlineText}
            </span>
            ${rowInactivityBadge}
          </div>
        </td>
        <td>${lastActiveFriendly}</td>
        <td>
          <div style="display: flex; flex-direction: column; gap: 4px; align-items: stretch; justify-content: center; width: 100%;">
            <button class="btn btn-secondary btn-sm table-request-audit-btn" style="padding: 0.25rem 0.4rem; font-size: 0.68rem; line-height: 1; text-align: center; white-space: nowrap; width: 100%;">
              Actualizar
            </button>
            <button class="btn btn-secondary btn-sm table-details-btn" style="padding: 0.25rem 0.4rem; font-size: 0.68rem; line-height: 1; text-align: center; white-space: nowrap; width: 100%;">
              Detalles
            </button>
          </div>
        </td>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn') || e.target.closest('.active-app-tag')) return;
        openDeviceDetails(device);
      });
      row.querySelector('.table-details-btn').addEventListener('click', () => {
        openDeviceDetails(device);
      });
      row.querySelector('.table-request-audit-btn').addEventListener('click', (e) => {
        requestSilentAudit(device.documentId, e.target);
      });

      devicesTableBody.appendChild(row);
    });
  }

  // Render Inactivity Log Timeline (descriptive language)
  function renderInactivityAlerts() {
    const activeAlerts = getFilteredAlertsByDate();
    if (activeAlerts.length === 0) {
      inactivityTimeline.innerHTML = `
        <div class="no-data">No hay registros de ocio para el período seleccionado.</div>
      `;
      return;
    }

    inactivityTimeline.innerHTML = '';
    activeAlerts.forEach(alert => {
      const timeString = new Date(alert.startTime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      const dateFriendly = getRelativeTime(alert.startTime);
      
      const minutes = Math.floor(alert.durationSeconds / 60);
      const seconds = Math.floor(alert.durationSeconds % 60);
      const durationStr = minutes > 0 ? `${minutes} minutos y ${seconds} segundos` : `${seconds} segundos`;

      const item = document.createElement('div');
      item.className = 'timeline-item';
      item.innerHTML = `
        <div class="timeline-marker"></div>
        <div class="timeline-content">
          <div class="timeline-header">
            <span class="timeline-user">${escapeHtml(alert.fullName)}</span>
            <span class="timeline-time" title="${new Date(alert.startTime).toLocaleString('es-ES')}">${dateFriendly} (${timeString})</span>
          </div>
          <div class="timeline-body" style="margin-top: 4px;">
            <span>DNI: ${escapeHtml(alert.documentId)}</span>
            <span class="inactivity-duration" style="font-size:0.75rem;">Estuvo inactivo por ${durationStr}</span>
          </div>
        </div>
      `;
      inactivityTimeline.appendChild(item);
    });
  }

  // Open Details Modal for a Device
  function openDeviceDetails(device) {
    modalDeviceName.textContent = `Reporte: ${device.fullName}`;
    
    // Evaluation Logic representation
    const cpuPass = device.hardware.cpuApto ? 'pass' : 'fail';
    const ramPass = device.hardware.ramApto ? (device.hardware.ramGB >= 15.5 ? 'pass' : 'warn') : 'fail';
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

    // Progress Bar Percentages
    const ramPct = Math.min(100, Math.round((device.hardware.ramGB / 16.0) * 100));
    const diskPct = Math.min(100, Math.round((device.hardware.freeDiskGB / 240.0) * 100));

    // Calculate Cumulative Inactivity minutes for selected date range
    const activeAlerts = getFilteredAlertsByDate();
    const totalInactivitySeconds = activeAlerts
      .filter(a => a.documentId === device.documentId)
      .reduce((sum, a) => sum + a.durationSeconds, 0);
    const totalInactivityMinutes = Math.round(totalInactivitySeconds / 60);

    // Get date range text label
    const selectVal = dateFilter ? dateFilter.value : 'today';
    let rangeText = 'Hoy';
    if (selectVal === 'yesterday') rangeText = 'Ayer';
    if (selectVal === 'week') rangeText = 'Últimos 7 días';
    if (selectVal === 'all') rangeText = 'Total Histórico';

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
          
          <div class="detail-row" style="background: rgba(245, 158, 11, 0.04); padding: 0.5rem; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.15); margin-top: 0.5rem; margin-bottom: 0.5rem;">
            <span class="detail-label" style="font-weight:600; color:var(--color-warning);">Inactividad Acumulada (${rangeText})</span>
            <span class="detail-value" style="color:var(--color-warning); font-weight:700;">
              ${formatInactivityTime(totalInactivityMinutes)} (${Math.round(totalInactivitySeconds)} segundos)
            </span>
          </div>

          <div class="detail-row" style="background: rgba(4, 116, 160, 0.04); padding: 0.5rem; border-radius: 6px; border: 1px solid rgba(3, 70, 121, 0.12);">
            <span class="detail-label" style="font-weight:600; color:var(--color-secondary);">Aplicación Activa (En uso)</span>
            <span class="detail-value text-highlight" title="${escapeHtml(device.activeWindow || 'Ninguno')}" style="font-size:0.86rem; word-break:break-all;">
              ${escapeHtml(device.activeWindow || 'Ninguno')}
            </span>
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
            <span class="detail-value ${ramPass}" style="display:inline-flex; align-items:center;">
              <span>${device.hardware.ramGB} GB</span>
              <div class="progress-bar-container"><div class="progress-bar-fill ${ramPass}" style="width: ${ramPct}%"></div></div>
            </span>
          </div>
          <div class="detail-row">
            <span class="spec-key">Tipo de Disco</span>
            <span class="detail-value ${diskTypePass}">${device.hardware.isSSD ? 'SSD (Apto)' : 'HDD (No Apto)'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Espacio Libre</span>
            <span class="detail-value ${diskSpacePass}" style="display:inline-flex; align-items:center;">
              <span>${device.hardware.freeDiskGB.toFixed(0)} GB</span>
              <div class="progress-bar-container"><div class="progress-bar-fill ${diskSpacePass}" style="width: ${diskPct}%"></div></div>
            </span>
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
            <span class="detail-value ${latencyPass}">${device.network.pingMs.toFixed(0)} ms</span>
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
      refreshBtn.classList.add('spin-anim');
      refreshBtn.innerHTML = `
        <span class="btn-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20 15"></path>
          </svg>
        </span>
        Actualizando...
      `;
    } else {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('spin-anim');
      refreshBtn.innerHTML = `
        <span class="btn-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20 15"></path>
          </svg>
        </span>
        Actualizar Datos
      `;
    }
  }

  function showError(msg) {
    devicesTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="no-data" style="color: var(--color-danger); text-align:center;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:6px; display:inline-block;">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          ${escapeHtml(msg)}
        </td>
      </tr>
    `;
    inactivityTimeline.innerHTML = `
      <div class="no-data" style="color: var(--color-danger); text-align:center;">
        ${escapeHtml(msg)}
      </div>
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

  // Date Filter select event
  if (dateFilter) {
    dateFilter.addEventListener('change', renderDashboard);
  }

  // Refresh button event
  refreshBtn.addEventListener('click', fetchStats);

  // Initial loads
  loadSystemConfig();

  // Export button events
  if (exportDevicesBtn) exportDevicesBtn.addEventListener('click', exportDevices);
  if (exportInactivityBtn) exportInactivityBtn.addEventListener('click', exportInactivity);

  // Helper to download CSV openable in Excel
  function downloadCSV(csvContent, filename) {
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  // Export Devices to CSV
  function exportDevices() {
    if (allDevices.length === 0) {
      alert("No hay equipos auditados para exportar.");
      return;
    }
    
    let csv = "Colaborador;DNI / ID;Estado;Procesador;RAM (GB);Tipo Disco;Espacio Libre (GB);S.O.;Descarga (Mbps);Subida (Mbps);Latencia (ms);Microfono;Camara;Encendido de PC;Fecha Auditoria;Programa Activo\n";
    
    allDevices.forEach(d => {
      const isSSD = d.hardware.isSSD ? "SSD" : "HDD";
      const hasMic = d.multimedia.hasMicrophone ? "Si" : "No";
      const hasCam = d.multimedia.hasWebcam ? "Si" : "No";
      const bootTime = d.uptime && d.uptime.bootTimestamp ? new Date(d.uptime.bootTimestamp).toLocaleString('es-ES') : 'N/A';
      const auditTime = new Date(d.auditTimestamp).toLocaleString('es-ES');
      const actWin = d.activeWindow || 'Ninguno';
      
      csv += `"${d.fullName}";"${d.documentId}";"${d.status}";"${d.hardware.cpuName}";${d.hardware.ramGB.toFixed(2)};"${isSSD}";${d.hardware.freeDiskGB.toFixed(2)};"${d.hardware.osName}";${d.network.downloadMbps ? d.network.downloadMbps.toFixed(1) : 0};${d.network.uploadMbps ? d.network.uploadMbps.toFixed(1) : 0};${d.network.pingMs ? d.network.pingMs.toFixed(0) : 0};"${hasMic}";"${hasCam}";"${bootTime}";"${auditTime}";"${actWin}"\n`;
    });
    
    downloadCSV(csv, "Equipos_Auditados_Biass.csv");
  }

  // Export Inactivity Log to CSV
  function exportInactivity() {
    const activeAlerts = getFilteredAlertsByDate();
    if (activeAlerts.length === 0) {
      alert("No hay alertas de inactividad para exportar en este período.");
      return;
    }
    
    let csv = "Colaborador;DNI / ID;Inicio de Inactividad;Duracion\n";
    
    activeAlerts.forEach(a => {
      const timeString = new Date(a.startTime).toLocaleString('es-ES');
      const minutes = Math.floor(a.durationSeconds / 60);
      const seconds = Math.floor(a.durationSeconds % 60);
      const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      
      csv += `"${a.fullName}";"${a.documentId}";"${timeString}";"${durationStr}"\n`;
    });
    
    downloadCSV(csv, "Reporte_Inactividad_Biass.csv");
  }

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

  // Send request for silent background audit
  async function requestSilentAudit(documentId, buttonEl) {
    try {
      const originalHtml = buttonEl.innerHTML;
      buttonEl.disabled = true;
      buttonEl.innerHTML = 'Enviando...';
      
      const response = await fetch(`/api/devices/${documentId}/request-audit`, { method: 'POST' });
      const data = await response.json();
      
      if (data.success) {
        buttonEl.innerHTML = 'Solicitado ✔';
        buttonEl.style.background = 'var(--color-success-bg)';
        buttonEl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        buttonEl.style.color = 'var(--color-success)';
        
        setTimeout(() => {
          buttonEl.disabled = false;
          buttonEl.innerHTML = originalHtml;
          buttonEl.style.background = '';
          buttonEl.style.borderColor = '';
          buttonEl.style.color = '';
        }, 3000);
      } else {
        alert('Error al solicitar re-auditoría: ' + data.error);
        buttonEl.disabled = false;
        buttonEl.innerHTML = originalHtml;
      }
    } catch (e) {
      console.error('Error requesting silent audit:', e);
      alert('Error de conexión al solicitar re-auditoría.');
      buttonEl.disabled = false;
      buttonEl.innerHTML = originalHtml;
    }
  }

  // Tab Switching Logic
  tabCardsBtn.addEventListener('click', () => {
    tabCardsBtn.classList.add('active');
    tabListBtn.classList.remove('active');
    devicesContainer.style.display = 'grid';
    devicesTableContainer.style.display = 'none';
  });

  tabListBtn.addEventListener('click', () => {
    tabListBtn.classList.add('active');
    tabCardsBtn.classList.remove('active');
    devicesContainer.style.display = 'none';
    devicesTableContainer.style.display = 'block';
  });

  // State Filter Button Listeners
  filterAllBtn.addEventListener('click', () => {
    activeStateFilter = 'all';
    filterAllBtn.classList.add('active');
    filterOnlineBtn.classList.remove('active');
    filterOfflineBtn.classList.remove('active');
    filterAndRenderDevices();
  });

  filterOnlineBtn.addEventListener('click', () => {
    activeStateFilter = 'online';
    filterOnlineBtn.classList.add('active');
    filterAllBtn.classList.remove('active');
    filterOfflineBtn.classList.remove('active');
    filterAndRenderDevices();
  });

  filterOfflineBtn.addEventListener('click', () => {
    activeStateFilter = 'offline';
    filterOfflineBtn.classList.add('active');
    filterAllBtn.classList.remove('active');
    filterOnlineBtn.classList.remove('active');
    filterAndRenderDevices();
  });

  // Initial Fetch & Auto-Refresh every 15 seconds to track active status
  fetchStats();
  setInterval(fetchStats, 15000);
});
