// app.js - Unified Multi-Device NAS Frontend Controller

// Application State
let state = {
    devices: JSON.parse(localStorage.getItem('nas_devices')) || [],
    activeDeviceId: localStorage.getItem('nas_active_device_id') || '',
    resolvedUrl: '',
    files: [],
    activeTab: 'dashboard', // dashboard, all, images, videos, documents, audit, settings
    diskInfo: null,
    devicesStatus: {} // caches status of all devices: { deviceId: { status: 'checking/online/offline', message: '...', storage: obj, url: '...' } }
};

// Check for legacy single-device configuration and auto-migrate
const oldGist = localStorage.getItem('nas_gist_id');
const oldToken = localStorage.getItem('nas_api_token');
const oldUrl = localStorage.getItem('nas_server_url');

if (state.devices.length === 0 && (oldGist || oldUrl)) {
    const migratedDevice = {
        id: 'device-' + Date.now(),
        name: 'Vault-SD-Card',
        gistId: oldGist || '',
        apiToken: oldToken || 'secure-nas-passcode-12345',
        serverUrlOverride: oldUrl || ''
    };
    state.devices = [migratedDevice];
    state.activeDeviceId = migratedDevice.id;
    localStorage.setItem('nas_devices', JSON.stringify(state.devices));
    localStorage.setItem('nas_active_device_id', state.activeDeviceId);
}

// DOM Elements
const statusIndicator = document.getElementById('status-indicator');
const loadingState = document.getElementById('loading-state');
const emptyState = document.getElementById('empty-state');
const setupState = document.getElementById('setup-state');
const filesGrid = document.getElementById('files-grid');

const tabTitle = document.getElementById('tab-title');
const tabSubtitle = document.getElementById('tab-subtitle');
const btnRefresh = document.getElementById('btn-refresh');

// Multi-Device DOM targets
const dashboardView = document.getElementById('dashboard-view');
const devicesDashboardGrid = document.getElementById('devices-dashboard-grid');
const auditContainer = document.getElementById('audit-container');
const diskBadge = document.getElementById('disk-badge');
const diskBadgeName = document.getElementById('disk-badge-name');
const headerDeviceSwitcher = document.getElementById('header-device-switcher');
const activeDeviceSelect = document.getElementById('active-device-select');
const statOnlineCount = document.getElementById('stat-online-count');
const statTotalCount = document.getElementById('stat-total-count');

// Setup Modal Elements
const setupGistId = document.getElementById('setup-gist-id');
const setupToken = document.getElementById('setup-token');
const setupServerUrl = document.getElementById('setup-server-url');
const btnSaveSetup = document.getElementById('btn-save-setup');
const toggleAdvanced = document.getElementById('toggle-advanced');
const advancedBody = document.getElementById('advanced-body');

// Image Modal Elements
const imageModal = document.getElementById('image-modal');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxTitle = document.getElementById('lightbox-title');
const lightboxDownload = document.getElementById('lightbox-download');
const imageModalClose = document.getElementById('image-modal-close');

// Video Modal Elements
const videoModal = document.getElementById('video-modal');
const modalVideo = document.getElementById('modal-video');
const videoTitle = document.getElementById('video-title');
const videoDownload = document.getElementById('video-download');
const videoModalClose = document.getElementById('video-modal-close');

// Initialize Lucide Icons
function initIcons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Format file size utility
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Update connection status UI
function updateStatus(status) {
    const dot = statusIndicator.querySelector('.status-dot');
    const text = statusIndicator.querySelector('.status-text');
    
    dot.className = 'status-dot';
    
    if (status === 'connected') {
        dot.classList.add('connected');
        text.textContent = 'Connected';
    } else if (status === 'syncing') {
        dot.classList.add('syncing');
        text.textContent = 'Resolving URL';
    } else {
        dot.classList.add('disconnected');
        text.textContent = 'Disconnected';
    }
}

// Resolve Server URL via Gist or Override
async function resolveDeviceUrl(device) {
    if (device.serverUrlOverride) {
        return device.serverUrlOverride;
    }
    
    if (!device.gistId) {
        throw new Error("Gist ID not configured");
    }
    
    // Add cache buster to prevent stale API responses
    const response = await fetch(`https://api.github.com/gists/${device.gistId}?t=${Date.now()}`);
    if (!response.ok) {
        throw new Error(`Gist lookup failed: ${response.statusText}`);
    }
    
    const gistData = await response.json();
    if (!gistData.files || !gistData.files['nas_url.json']) {
        throw new Error("nas_url.json not found in Gist");
    }
    
    const content = JSON.parse(gistData.files['nas_url.json'].content);
    if (!content.url) {
        throw new Error("No URL entry inside Gist");
    }
    
    return content.url;
}

// Show a specific state element and hide others
function showState(elementToShow) {
    loadingState.classList.add('hidden');
    emptyState.classList.add('hidden');
    setupState.classList.add('hidden');
    filesGrid.classList.add('hidden');
    auditContainer.classList.add('hidden');
    dashboardView.classList.add('hidden');
    
    elementToShow.classList.remove('hidden');
}

// Display Configuration Entry Screen
function showSetupScreen() {
    showState(setupState);
    setupGistId.value = '';
    setupToken.value = '';
    setupServerUrl.value = '';
    updateStatus('disconnected');
    diskBadge.classList.add('hidden');
    headerDeviceSwitcher.classList.add('hidden');
}

// Ping all registered devices to check status and storage
async function pingDevices() {
    if (state.devices.length === 0) {
        showSetupScreen();
        return;
    }
    
    state.devicesStatus = {};
    renderDashboard(); // Show connecting statuses immediately
    
    const promises = state.devices.map(async (device) => {
        try {
            const url = await resolveDeviceUrl(device);
            const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
            state.devicesStatus[device.id] = { status: 'checking', message: 'Checking API...', storage: null, url: cleanUrl };
            
            // Test connection
            const response = await fetch(`${cleanUrl}/api/disk/status`, {
                headers: { 'Authorization': `Bearer ${device.apiToken}` }
            });
            
            if (response.status === 401) {
                throw new Error("Unauthorized");
            }
            if (!response.ok) {
                throw new Error(`Error: ${response.status}`);
            }
            
            const data = await response.json();
            state.devicesStatus[device.id] = {
                status: 'online',
                message: 'Online',
                storage: data.storage,
                url: cleanUrl
            };
            
            if (device.id === state.activeDeviceId) {
                state.diskInfo = data;
                diskBadgeName.textContent = data.disk_name;
                diskBadge.classList.remove('hidden');
                updateStatus('connected');
            }
        } catch (e) {
            state.devicesStatus[device.id] = {
                status: 'offline',
                message: e.message === 'Failed to fetch' ? 'Offline' : (e.message || 'Offline'),
                storage: null,
                url: ''
            };
            if (device.id === state.activeDeviceId) {
                updateStatus('disconnected');
                diskBadge.classList.add('hidden');
            }
        }
    });
    
    await Promise.allSettled(promises);
    renderDashboard();
    updateHeaderSwitcher();
}

// Render the dashboard grid view
function renderDashboard() {
    tabTitle.textContent = "Dashboard";
    tabSubtitle.textContent = "Overview of your pocket NAS network";
    
    showState(dashboardView);
    devicesDashboardGrid.innerHTML = '';
    
    let onlineCount = 0;
    
    state.devices.forEach(device => {
        const info = state.devicesStatus[device.id] || { status: 'checking', message: 'Connecting...', storage: null, url: '' };
        if (info.status === 'online') onlineCount++;
        
        const card = document.createElement('div');
        card.className = 'device-dashboard-card glass';
        
        let storageHtml = `<p class="text-secondary" style="font-size: 0.85rem; margin-top:0.25rem;">Storage stats unavailable while offline.</p>`;
        if (info.status === 'online' && info.storage) {
            const total = info.storage.total;
            const used = info.storage.used;
            const pct = total > 0 ? ((used / total) * 100).toFixed(1) : 0;
            storageHtml = `
                <div class="card-storage-label">
                    <span>Storage Used</span>
                    <span class="card-storage-pct">${pct}% (${formatBytes(used)} / ${formatBytes(total)})</span>
                </div>
                <div class="storage-progress-bg">
                    <div class="storage-progress-fill" style="width: ${pct}%;"></div>
                </div>
            `;
        } else if (info.status === 'checking') {
            storageHtml = `
                <div class="spinner" style="width: 20px; height: 20px; border-width: 2px; margin: 0 0 0.5rem 0;"></div>
                <p class="text-secondary" style="font-size: 0.85rem; display:inline; margin-left:0.5rem;">Connecting to drive...</p>
            `;
        }
        
        let urlHtml = `<div class="card-url-section"><i data-lucide="link-2"></i><span>Disconnected</span></div>`;
        if (info.url) {
            urlHtml = `<div class="card-url-section"><i data-lucide="link-2"></i><a href="${info.url}" target="_blank">${info.url}</a></div>`;
        }
        
        card.innerHTML = `
            <div class="card-header-status">
                <h4>${device.name}</h4>
                <span class="status-badge ${info.status}">
                    <span class="status-dot ${info.status}"></span>
                    ${info.message}
                </span>
            </div>
            <div class="card-body-storage">
                ${storageHtml}
            </div>
            ${urlHtml}
            <div class="card-actions-row">
                <button class="btn btn-primary btn-full browse-btn" data-id="${device.id}" ${info.status !== 'online' ? 'disabled' : ''}>
                    <i data-lucide="folder-open" style="width:14px;height:14px;"></i> Browse
                </button>
                <button class="btn btn-secondary btn-full audit-btn" data-id="${device.id}" ${info.status !== 'online' ? 'disabled' : ''}>
                    <i data-lucide="activity" style="width:14px;height:14px;"></i> Logs
                </button>
            </div>
        `;
        
        // Bind actions
        const browseBtn = card.querySelector('.browse-btn');
        const auditBtn = card.querySelector('.audit-btn');
        
        if (info.status === 'online') {
            browseBtn.onclick = (e) => {
                e.stopPropagation();
                setActiveDevice(device.id, 'all');
            };
            auditBtn.onclick = (e) => {
                e.stopPropagation();
                setActiveDevice(device.id, 'audit');
            };
        }
        
        devicesDashboardGrid.appendChild(card);
    });
    
    // Add Register card
    const addCard = document.createElement('div');
    addCard.className = 'add-device-card';
    addCard.innerHTML = `
        <i data-lucide="plus-circle"></i>
        <span>Register New Drive</span>
    `;
    addCard.onclick = () => {
        state.activeTab = 'settings';
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('data-tab') === 'settings') item.classList.add('active');
        });
        renderActiveTab();
    };
    devicesDashboardGrid.appendChild(addCard);
    
    statOnlineCount.textContent = onlineCount;
    statTotalCount.textContent = state.devices.length;
    
    initIcons();
}

// Set active device and load files/logs
function setActiveDevice(deviceId, targetTab) {
    state.activeDeviceId = deviceId;
    localStorage.setItem('nas_active_device_id', deviceId);
    
    state.activeTab = targetTab;
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-tab') === targetTab) item.classList.add('active');
    });
    
    fetchActiveDeviceFiles();
}

// Update the header select switcher dropdown
function updateHeaderSwitcher() {
    if (state.activeTab === 'dashboard' || state.activeTab === 'settings' || state.devices.length === 0) {
        headerDeviceSwitcher.classList.add('hidden');
        return;
    }
    
    headerDeviceSwitcher.classList.remove('hidden');
    activeDeviceSelect.innerHTML = '';
    
    state.devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = device.name;
        option.selected = (device.id === state.activeDeviceId);
        activeDeviceSelect.appendChild(option);
    });
}

// Connect and fetch data for the active drive
async function fetchActiveDeviceFiles() {
    const device = state.devices.find(d => d.id === state.activeDeviceId);
    if (!device) {
        showSetupScreen();
        return;
    }
    
    showState(loadingState);
    updateStatus('syncing');
    
    try {
        const url = await resolveDeviceUrl(device);
        state.resolvedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        
        // Load stats
        const statusResponse = await fetch(`${state.resolvedUrl}/api/disk/status`, {
            headers: { 'Authorization': `Bearer ${device.apiToken}` }
        });
        
        if (statusResponse.status === 401) {
            throw new Error("Unauthorized: Invalid API Token");
        }
        if (!statusResponse.ok) {
            throw new Error(`NAS server returned status: ${statusResponse.status}`);
        }
        
        state.diskInfo = await statusResponse.json();
        
        // Update status badge
        diskBadgeName.textContent = state.diskInfo.disk_name;
        diskBadge.classList.remove('hidden');
        
        // Cache online state
        state.devicesStatus[device.id] = {
            status: 'online',
            message: 'Online',
            storage: state.diskInfo.storage,
            url: state.resolvedUrl
        };
        
        // Fetch files
        const filesResponse = await fetch(`${state.resolvedUrl}/api/files`, {
            headers: { 'Authorization': `Bearer ${device.apiToken}` }
        });
        
        if (!filesResponse.ok) {
            throw new Error("Failed to index files");
        }
        
        const filesData = await filesResponse.json();
        state.files = filesData.files || [];
        
        updateStatus('connected');
        renderActiveTab();
    } catch (err) {
        console.error("Connection error:", err);
        updateStatus('disconnected');
        diskBadge.classList.add('hidden');
        
        state.devicesStatus[device.id] = {
            status: 'offline',
            message: err.message || 'Offline',
            storage: null,
            url: ''
        };
        
        showState(emptyState);
        emptyState.querySelector('h3').textContent = "Connection Failed";
        emptyState.querySelector('p').textContent = err.message || `Could not connect to ${device.name}`;
        
        let retryBtn = emptyState.querySelector('.btn-retry');
        if (!retryBtn) {
            retryBtn = document.createElement('button');
            retryBtn.className = "btn btn-primary btn-retry";
            retryBtn.style.marginTop = "1rem";
            retryBtn.textContent = "Retry Connection";
            retryBtn.onclick = () => fetchActiveDeviceFiles();
            emptyState.appendChild(retryBtn);
        }
    }
    updateHeaderSwitcher();
}

// Filter and Render Media Items based on current Tab
function renderActiveTab() {
    updateHeaderSwitcher();
    
    if (state.activeTab === 'dashboard') {
        renderDashboard();
        return;
    }
    
    if (state.activeTab === 'settings') {
        renderSettingsTab();
        return;
    }
    
    if (state.activeTab === 'audit') {
        renderAuditTab();
        return;
    }
    
    let filteredFiles = [];
    if (state.activeTab === 'all') {
        filteredFiles = state.files;
        tabTitle.textContent = "All Files";
        tabSubtitle.textContent = `Displaying all ${state.files.length} items from your NAS`;
    } else if (state.activeTab === 'images') {
        filteredFiles = state.files.filter(f => f.type === 'image');
        tabTitle.textContent = "Photos";
        tabSubtitle.textContent = `Displaying ${filteredFiles.length} photo assets`;
    } else if (state.activeTab === 'videos') {
        filteredFiles = state.files.filter(f => f.type === 'video');
        tabTitle.textContent = "Videos";
        tabSubtitle.textContent = `Displaying ${filteredFiles.length} video streams`;
    } else if (state.activeTab === 'documents') {
        filteredFiles = state.files.filter(f => f.type === 'document');
        tabTitle.textContent = "Documents";
        tabSubtitle.textContent = `Displaying ${filteredFiles.length} documents`;
    }
    
    if (filteredFiles.length === 0) {
        showState(emptyState);
        emptyState.querySelector('h3').textContent = "No Items Found";
        emptyState.querySelector('p').textContent = `The category '${state.activeTab}' is currently empty inside Media/`;
        const rBtn = emptyState.querySelector('.btn-retry');
        if (rBtn) rBtn.remove();
        return;
    }
    
    showState(filesGrid);
    filesGrid.innerHTML = '';
    
    filteredFiles.forEach(file => {
        const fileUrl = `${state.resolvedUrl}/api/files/download/${encodeURIComponent(file.path)}?token=${encodeURIComponent(state.apiToken)}`;
        const card = document.createElement('div');
        card.className = 'media-card glass';
        
        let previewHtml = '';
        if (file.type === 'image') {
            previewHtml = `<img src="${fileUrl}" alt="${file.name}" class="media-preview-img" loading="lazy">`;
        } else if (file.type === 'video') {
            previewHtml = `
                <div class="media-icon-overlay">
                    <i data-lucide="play"></i>
                </div>
                <div class="video-badge">
                    <i data-lucide="video"></i> VIDEO
                </div>
            `;
        } else {
            previewHtml = `
                <div class="media-icon-overlay">
                    <i data-lucide="file-text"></i>
                </div>
            `;
        }
        
        card.innerHTML = `
            <div class="media-preview-container">
                ${previewHtml}
            </div>
            <div class="media-meta">
                <div class="media-title" title="${file.name}">${file.name}</div>
                <div class="media-details">
                    <span class="media-size">${formatBytes(file.size)}</span>
                    <span class="media-icon-type"><i data-lucide="${getFileIcon(file.type)}" style="width: 14px; height: 14px;"></i></span>
                </div>
            </div>
        `;
        
        card.onclick = () => handleMediaClick(file, fileUrl);
        filesGrid.appendChild(card);
    });
    
    initIcons();
}

function getFileIcon(type) {
    if (type === 'image') return 'image';
    if (type === 'video') return 'film';
    return 'file-text';
}

// Render dynamic settings interface inside main panel
function renderSettingsTab() {
    tabTitle.textContent = "Settings & Devices";
    tabSubtitle.textContent = "Register and manage your portable pocket NAS network drives";
    
    showState(filesGrid);
    
    let devicesListHtml = '';
    if (state.devices.length === 0) {
        devicesListHtml = '<p class="text-secondary" style="grid-column: 1/-1; text-align: center; margin: 1rem 0;">No drives registered yet. Add your first drive below!</p>';
    } else {
        state.devices.forEach(device => {
            devicesListHtml += `
                <div class="audit-item glass" style="border-radius: 8px; margin-bottom: 0.75rem; padding: 1rem; flex-direction: row; justify-content: space-between; align-items: center; display: flex; font-family: inherit;">
                    <div>
                        <strong style="color: #fff; font-size: 1rem;">${device.name}</strong>
                        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">
                            Gist ID: <span style="font-family: monospace;">${device.gistId || 'N/A'}</span>
                            ${device.serverUrlOverride ? ` | Direct URL: <span style="font-family: monospace;">${device.serverUrlOverride}</span>` : ''}
                        </div>
                    </div>
                    <div>
                        <button class="btn btn-secondary btn-icon delete-device-btn" data-id="${device.id}" title="Remove Drive" style="border-color: rgba(239, 68, 110, 0.2); color: var(--error); width: 34px; height: 34px;">
                            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                        </button>
                    </div>
                </div>
            `;
        });
    }
    
    filesGrid.innerHTML = `
        <div class="card glass" style="grid-column: 1 / -1; margin: 0 auto; max-width: 680px; width: 100%; padding: 2rem; border-radius: var(--border-radius);">
            <h3 style="margin-bottom: 1.25rem;">Registered Devices</h3>
            <div style="margin-bottom: 2rem; max-height: 250px; overflow-y: auto; padding-right: 0.5rem;">
                ${devicesListHtml}
            </div>
            
            <hr style="border-color: var(--border-color); margin-bottom: 1.5rem;">
            
            <h3 style="margin-bottom: 1.25rem;">Register New Drive</h3>
            <div class="form-group">
                <label for="new-device-name">Friendly Drive Name</label>
                <input type="text" id="new-device-name" placeholder="e.g. Vault-SSD-1">
            </div>
            <div class="form-group">
                <label for="new-device-gist">GitHub Gist ID (Auto-Sync)</label>
                <input type="text" id="new-device-gist" placeholder="Enter Gist ID containing nas_url.json">
            </div>
            <div class="form-group">
                <label for="new-device-token">Drive API passcode Token</label>
                <input type="password" id="new-device-token" placeholder="Enter Security Token passcode">
            </div>
            
            <div class="form-group url-override-group" style="margin-top: 1rem;">
                <div class="accordion-header" id="settings-toggle-advanced">
                    <span>Advanced: Direct Server URL Override</span>
                    <i data-lucide="chevron-down" class="accordion-arrow"></i>
                </div>
                <div class="accordion-body hidden" id="settings-advanced-body">
                    <label for="new-device-url">Direct URL Override (Optional)</label>
                    <input type="text" id="new-device-url" placeholder="http://127.0.0.1:8000">
                    <span class="input-hint">Specify direct address to bypass dynamic Gist lookup.</span>
                </div>
            </div>
            
            <button class="btn btn-primary btn-full" id="btn-add-device" style="margin-top: 1rem;">Add Drive to Network</button>
        </div>
    `;
    
    // Bind deletes
    document.querySelectorAll('.delete-device-btn').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-id');
            const dev = state.devices.find(d => d.id === id);
            if (dev && confirm(`Are you sure you want to remove '${dev.name}' from your dashboard?`)) {
                state.devices = state.devices.filter(d => d.id !== id);
                localStorage.setItem('nas_devices', JSON.stringify(state.devices));
                if (state.activeDeviceId === id) {
                    state.activeDeviceId = state.devices.length > 0 ? state.devices[0].id : '';
                    localStorage.setItem('nas_active_device_id', state.activeDeviceId);
                    state.diskInfo = null;
                    diskBadge.classList.add('hidden');
                }
                renderSettingsTab();
            }
        };
    });
    
    const toggleBtn = document.getElementById('settings-toggle-advanced');
    const advBody = document.getElementById('settings-advanced-body');
    toggleBtn.onclick = () => {
        advBody.classList.toggle('hidden');
        toggleBtn.querySelector('.accordion-arrow').classList.toggle('rotated');
    };
    
    document.getElementById('btn-add-device').onclick = () => {
        const name = document.getElementById('new-device-name').value.trim();
        const gist = document.getElementById('new-device-gist').value.trim();
        const token = document.getElementById('new-device-token').value.trim();
        const url = document.getElementById('new-device-url').value.trim();
        
        if (!name) {
            alert("Please enter a friendly name for this drive.");
            return;
        }
        if (!gist && !url) {
            alert("Please specify either a Gist ID or a Direct Server URL.");
            return;
        }
        if (!token) {
            alert("Please enter the API passcode token configured in the drive's config.json.");
            return;
        }
        
        const newDev = {
            id: 'device-' + Date.now(),
            name: name,
            gistId: gist,
            apiToken: token,
            serverUrlOverride: url
        };
        
        state.devices.push(newDev);
        localStorage.setItem('nas_devices', JSON.stringify(state.devices));
        if (!state.activeDeviceId) {
            state.activeDeviceId = newDev.id;
            localStorage.setItem('nas_active_device_id', newDev.id);
        }
        
        alert(`Drive '${name}' successfully registered!`);
        renderSettingsTab();
    };
    
    initIcons();
}

// Render dynamic audit logs tab
function renderAuditTab() {
    tabTitle.textContent = "Audit Logs";
    tabSubtitle.textContent = "Browse system actions and file modifications for this drive";
    
    showState(auditContainer);
    
    if (!state.diskInfo) {
        document.getElementById('audit-disk-name').textContent = "Unknown Disk";
        document.getElementById('audit-disk-id').textContent = "N/A";
        document.getElementById('audit-disk-storage').textContent = "N/A";
        document.getElementById('audit-list').innerHTML = '<li class="audit-item"><span class="audit-item-detail">No disk information loaded</span></li>';
        return;
    }
    
    document.getElementById('audit-disk-name').textContent = state.diskInfo.disk_name;
    document.getElementById('audit-disk-id').textContent = state.diskInfo.disk_id;
    
    const total = state.diskInfo.storage.total;
    const free = state.diskInfo.storage.free;
    const used = state.diskInfo.storage.used;
    const usagePercent = total > 0 ? ((used / total) * 100).toFixed(1) : 0;
    
    document.getElementById('audit-disk-storage').textContent = `${formatBytes(used)} / ${formatBytes(total)} (${usagePercent}% used)`;
    document.getElementById('audit-storage-bar').style.width = `${usagePercent}%`;
    
    const listContainer = document.getElementById('audit-list');
    listContainer.innerHTML = '';
    
    if (state.diskInfo.audit_log.length === 0) {
        listContainer.innerHTML = '<li class="audit-item"><span class="audit-item-detail">No audit records found on this drive</span></li>';
        return;
    }
    
    state.diskInfo.audit_log.forEach(log => {
        const parts = log.split(' | ');
        if (parts.length >= 4) {
            const time = parts[0];
            const action = parts[2];
            const detail = parts.slice(3).join(' | ');
            
            const item = document.createElement('li');
            item.className = 'audit-item';
            item.innerHTML = `
                <span class="audit-item-time">${time}</span>
                <span class="audit-item-action audit-action-${action.toLowerCase()}">${action}</span>
                <span class="audit-item-detail" title="${detail}">${detail}</span>
            `;
            listContainer.appendChild(item);
        } else {
            const item = document.createElement('li');
            item.className = 'audit-item';
            item.innerHTML = `<span class="audit-item-detail">${log}</span>`;
            listContainer.appendChild(item);
        }
    });
}

// Media Click Handler (Opens modals)
function handleMediaClick(file, fileUrl) {
    if (file.type === 'image') {
        lightboxImage.src = fileUrl;
        lightboxTitle.textContent = file.name;
        lightboxDownload.href = fileUrl;
        imageModal.classList.remove('hidden');
    } else if (file.type === 'video') {
        modalVideo.src = fileUrl;
        videoTitle.textContent = file.name;
        videoDownload.href = fileUrl;
        videoModal.classList.remove('hidden');
        modalVideo.play().catch(e => console.log("Auto-play blocked or streaming range issue:", e));
    } else {
        const anchor = document.createElement('a');
        anchor.href = fileUrl;
        anchor.download = file.name;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
    }
}

// Save configuration credentials helper (for initial setup)
function saveConfiguration(gist, token, serverUrl) {
    if (!gist && !serverUrl) {
        alert("Please enter either a Gist ID or a Direct Server URL to connect.");
        return;
    }
    
    if (!token) {
        alert("Please enter the API passcode token.");
        return;
    }
    
    const defaultDev = {
        id: 'device-' + Date.now(),
        name: 'Default-Vault',
        gistId: gist,
        apiToken: token,
        serverUrlOverride: serverUrl
    };
    
    state.devices = [defaultDev];
    state.activeDeviceId = defaultDev.id;
    localStorage.setItem('nas_devices', JSON.stringify(state.devices));
    localStorage.setItem('nas_active_device_id', defaultDev.id);
    
    state.activeTab = 'dashboard';
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-tab') === 'dashboard') {
            item.classList.add('active');
        }
    });
    
    pingDevices();
}

// Event Bindings
btnRefresh.onclick = () => {
    if (state.activeTab === 'settings') return;
    if (state.activeTab === 'dashboard') {
        pingDevices();
    } else {
        fetchActiveDeviceFiles();
    }
};

// Setup Screen Bindings
btnSaveSetup.onclick = () => {
    const gist = setupGistId.value.trim();
    const token = setupToken.value.trim();
    const serverUrl = setupServerUrl.value.trim();
    saveConfiguration(gist, token, serverUrl);
};

// Advanced Section toggle in setup card
toggleAdvanced.onclick = () => {
    advancedBody.classList.toggle('hidden');
    const arrow = toggleAdvanced.querySelector('.accordion-arrow');
    arrow.classList.toggle('rotated');
};

// Modal Close Triggers
imageModalClose.onclick = () => {
    imageModal.classList.add('hidden');
    lightboxImage.src = '';
};

videoModalClose.onclick = () => {
    videoModal.classList.add('hidden');
    modalVideo.pause();
    modalVideo.src = '';
};

// Close modal when clicking backdrop
document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.onclick = (e) => {
        const modal = e.target.closest('.modal');
        modal.classList.add('hidden');
        
        if (modal.id === 'video-modal') {
            modalVideo.pause();
            modalVideo.src = '';
        } else if (modal.id === 'image-modal') {
            lightboxImage.src = '';
        }
    };
});

// Tab Switch Binding
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        btn.classList.add('active');
        
        state.activeTab = btn.getAttribute('data-tab');
        
        if (state.activeTab === 'settings') {
            btnRefresh.classList.add('hidden');
        } else {
            btnRefresh.classList.remove('hidden');
        }
        
        renderActiveTab();
    };
});

// Bootstrap Application
document.addEventListener('DOMContentLoaded', () => {
    initIcons();
    
    activeDeviceSelect.onchange = (e) => {
        setActiveDevice(e.target.value, state.activeTab);
    };
    
    if (state.devices.length > 0) {
        pingDevices();
    } else {
        showSetupScreen();
    }
});
