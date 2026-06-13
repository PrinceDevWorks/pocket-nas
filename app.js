// app.js - Unified Multi-Device NAS Frontend Controller with Cryptographic Central Registry

// Application State
let state = {
    devices: [],             // Decrypted drive list: [{ id, name, apiToken, serverUrlOverride }]
    activeDeviceId: '',
    resolvedUrl: '',         // Base Cloudflare URL for active session
    files: [],
    activeTab: 'dashboard',  // dashboard, all, images, videos, documents, audit, settings
    diskInfo: null,          // Holds full multi-drive status payload from server
    devicesStatus: {},       // Maps driveId to state: { id: { status, message, storage, url } }
    
    // Centralized Authentication Registry credentials
    username: '',
    githubPat: '',
    gistId: '',
    derivedKey: null         // AES key derived from Master Password
};

// Cryptographic Encryption/Decryption Helpers (WebCrypto API)
async function deriveKey(password, username) {
    const enc = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    const salt = enc.encode(username.toLowerCase().trim());
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        passwordKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptData(plaintext, key) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        enc.encode(plaintext)
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    let binary = "";
    for (let i = 0; i < combined.length; i++) {
        binary += String.fromCharCode(combined[i]);
    }
    return btoa(binary);
}

async function decryptData(ciphertextBase64, key) {
    const binary = atob(ciphertextBase64);
    const combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        combined[i] = binary.charCodeAt(i);
    }
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const dec = new TextDecoder();
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        ciphertext
    );
    return dec.decode(decrypted);
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

// Login/Register tabs & forms
const tabLoginBtn = document.getElementById('tab-login-btn');
const tabRegisterBtn = document.getElementById('tab-register-btn');
const loginFormContainer = document.getElementById('login-form-container');
const registerFormContainer = document.getElementById('register-form-container');

// Forms fields
const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const btnLoginAccount = document.getElementById('btn-login-account');

const registerUsernameInput = document.getElementById('register-username');
const registerPasswordInput = document.getElementById('register-password');
const registerPatInput = document.getElementById('register-pat');
const btnRegisterAccount = document.getElementById('btn-register-account');

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

// Initialize Icons Helper
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

// Update connection status UI badge
function updateStatus(status) {
    const dot = statusIndicator.querySelector('.status-dot');
    const text = statusIndicator.querySelector('.status-text');
    dot.className = 'status-dot';
    
    if (status === 'connected') {
        dot.classList.add('connected');
        text.textContent = 'Connected';
    } else if (status === 'syncing') {
        dot.classList.add('syncing');
        text.textContent = 'Decrypting Profile';
    } else {
        dot.classList.add('disconnected');
        text.textContent = 'Disconnected';
    }
}

// Show specific state panel and hide others
function showState(elementToShow) {
    loadingState.classList.add('hidden');
    emptyState.classList.add('hidden');
    setupState.classList.add('hidden');
    filesGrid.classList.add('hidden');
    auditContainer.classList.add('hidden');
    dashboardView.classList.add('hidden');
    
    elementToShow.classList.remove('hidden');
}

// Display Configuration Login Screen
function showSetupScreen() {
    showState(setupState);
    updateStatus('disconnected');
    diskBadge.classList.add('hidden');
    headerDeviceSwitcher.classList.add('hidden');
}

// Toggle setup screen forms
tabLoginBtn.onclick = () => {
    tabLoginBtn.classList.add('active');
    tabRegisterBtn.classList.remove('active');
    loginFormContainer.style.display = 'flex';
    registerFormContainer.classList.add('hidden');
    registerFormContainer.style.display = 'none';
};

tabRegisterBtn.onclick = () => {
    tabRegisterBtn.classList.add('active');
    tabLoginBtn.classList.remove('active');
    registerFormContainer.classList.remove('hidden');
    registerFormContainer.style.display = 'flex';
    loginFormContainer.style.display = 'none';
};

// Account Registration Logic
async function registerAccount() {
    const username = registerUsernameInput.value.trim();
    const password = registerPasswordInput.value.trim();
    const pat = registerPatInput.value.trim();
    
    if (!username || !password || !pat) {
        alert("Please fill in all fields to create your account registry.");
        return;
    }
    
    showState(loadingState);
    updateStatus('syncing');
    
    try {
        // Derive key
        const derivedKey = await deriveKey(password, username);
        
        // Initialize an empty registry payload
        const emptyRegistry = {
            github_pat: pat,
            drives: []
        };
        const ciphertext = await encryptData(JSON.stringify(emptyRegistry), derivedKey);
        
        // Push initial Registry Gist to GitHub
        const payload = {
            description: "Pocket NAS Registry",
            public: true, // Publicly readable so login works anywhere without PAT; encrypted contents keep it secure
            files: {
                "registry.json.enc": {
                    "content": ciphertext
                },
                "drives_status.json": {
                    "content": JSON.stringify({ url: "", updated_at: "", drives: {} })
                }
            }
        };
        
        const response = await fetch("https://api.github.com/gists", {
            method: "POST",
            headers: {
                "Authorization": `token ${pat}`,
                "Accept": "application/vnd.github.v3+json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            throw new Error(`GitHub Gist creation failed: ${response.statusText}`);
        }
        
        const gistData = await response.json();
        alert("Encrypted Account Registry successfully initialized on your GitHub profile!");
        
        // Save session state
        state.username = username;
        state.gistId = gistData.id;
        state.githubPat = pat;
        state.derivedKey = derivedKey;
        state.devices = [];
        
        sessionStorage.setItem('nas_session', JSON.stringify({
            username: username,
            password: password,
            gistId: gistData.id
        }));
        
        // Proceed to dashboard
        state.activeTab = 'dashboard';
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('data-tab') === 'dashboard') item.classList.add('active');
        });
        
        pingDevices();
    } catch (e) {
        console.error(e);
        alert(`Failed to initialize account: ${e.message}`);
        showSetupScreen();
    }
}

// Account Login Logic (Model B)
async function loginAccount(username, password) {
    showState(loadingState);
    updateStatus('syncing');
    
    try {
        // 1. Fetch user public gists to locate the Registry
        const response = await fetch(`https://api.github.com/users/${username}/gists?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`Could not locate GitHub profile: ${response.statusText}`);
        }
        const gists = await response.json();
        
        // 2. Find Gist containing registry.json.enc
        let gistId = null;
        let encryptedContent = null;
        let drivesStatusContent = null;
        
        for (const gist of gists) {
            if (gist.files && gist.files['registry.json.enc']) {
                gistId = gist.id;
                break;
            }
        }
        
        if (!gistId) {
            throw new Error("No Pocket NAS profile registry found on this GitHub account. Please Create an Account first.");
        }
        
        // 3. Fetch Gist payload details
        const gistResponse = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`);
        if (!gistResponse.ok) {
            throw new Error(`Failed to fetch Gist profile: ${gistResponse.statusText}`);
        }
        const gistDetails = await gistResponse.json();
        encryptedContent = gistDetails.files['registry.json.enc'].content;
        
        if (gistDetails.files['drives_status.json']) {
            try {
                drivesStatusContent = JSON.parse(gistDetails.files['drives_status.json'].content);
            } catch (err) {
                console.warn("drives_status.json empty or corrupted");
            }
        }
        
        // 4. Derive key and decrypt registry
        const derivedKey = await deriveKey(password, username);
        let decryptedData = "";
        try {
            decryptedData = await decryptData(encryptedContent, derivedKey);
        } catch (decErr) {
            throw new Error("Authentication failed: Incorrect password.");
        }
        
        const registry = JSON.parse(decryptedData);
        
        // 5. Populate global state
        state.username = username;
        state.gistId = gistId;
        state.githubPat = registry.github_pat;
        state.derivedKey = derivedKey;
        state.devices = registry.drives || [];
        
        if (drivesStatusContent) {
            state.resolvedUrl = drivesStatusContent.url || '';
        }
        
        if (state.devices.length > 0 && !state.activeDeviceId) {
            state.activeDeviceId = state.devices[0].id;
        }
        
        sessionStorage.setItem('nas_session', JSON.stringify({
            username: username,
            password: password,
            gistId: gistId
        }));
        
        // 6. Go to dashboard
        state.activeTab = 'dashboard';
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('data-tab') === 'dashboard') item.classList.add('active');
        });
        
        pingDevices();
    } catch (e) {
        console.error(e);
        alert(e.message);
        showSetupScreen();
    }
}

// Push updated registry to Gist
async function saveRegistryOnGist() {
    if (!state.gistId || !state.githubPat || !state.derivedKey) return;
    
    try {
        const payloadJson = JSON.stringify({
            github_pat: state.githubPat,
            drives: state.devices
        });
        const ciphertext = await encryptData(payloadJson, state.derivedKey);
        
        const response = await fetch(`https://api.github.com/gists/${state.gistId}`, {
            method: "PATCH",
            headers: {
                "Authorization": `token ${state.githubPat}`,
                "Accept": "application/vnd.github.v3+json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                files: {
                    "registry.json.enc": {
                        "content": ciphertext
                    }
                }
            })
        });
        
        if (!response.ok) {
            throw new Error(`Gist update failed: ${response.statusText}`);
        }
        console.log("Registry Gist successfully updated!");
    } catch (e) {
        console.error("Failed to save registry to Gist:", e);
        alert("Failed to sync changes to GitHub. Please check network connection.");
    }
}

// Ping central PC backend and fetch statuses of all drives in parallel
async function pingDevices() {
    if (!state.gistId) {
        showSetupScreen();
        return;
    }
    
    state.devicesStatus = {};
    renderDashboard(); // Show connecting placeholder immediately
    
    try {
        // 1. Fetch drives_status.json from Gist to check latest Cloudflare URL
        const gistResponse = await fetch(`https://api.github.com/gists/${state.gistId}?t=${Date.now()}`, {
            headers: { 'Accept': 'application/json' }
        });
        if (!gistResponse.ok) throw new Error("Gist lookup failed");
        
        const gistData = await gistResponse.json();
        let serverUrl = '';
        let serverDriveStatuses = {};
        
        if (gistData.files && gistData.files['drives_status.json']) {
            const statusContent = JSON.parse(gistData.files['drives_status.json'].content);
            serverUrl = statusContent.url || '';
            serverDriveStatuses = statusContent.drives || {};
        }
        
        state.resolvedUrl = serverUrl;
        
        if (!serverUrl) {
            // No tunnel URL stored on Gist, meaning PC service is offline
            state.devices.forEach(device => {
                state.devicesStatus[device.id] = {
                    status: 'offline',
                    message: 'Offline (Tunnel Closed)',
                    storage: null,
                    url: ''
                };
            });
            updateStatus('disconnected');
            diskBadge.classList.add('hidden');
            renderDashboard();
            updateHeaderSwitcher();
            return;
        }
        
        // 2. Fetch full multi-drive status info in a single request to PC server
        const cleanUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
        
        // We use the api token from any active configured drive to authorize status query
        const activeDev = state.devices.find(d => d.id === state.activeDeviceId) || state.devices[0];
        const authHeader = activeDev ? activeDev.apiToken : 'secure-nas-passcode-12345';
        
        // 2a. Warm up the Cloudflare tunnel with a no-auth /ping first.
        // Cloudflare quick tunnels show an HTML interstitial to browsers
        // on the FIRST request. The Accept: application/json header signals
        // this is an API call and bypasses the challenge.
        try {
            await fetch(`${cleanUrl}/ping`, {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(8000)
            });
        } catch (pingErr) {
            // /ping warmup failure is non-fatal; proceed to main request
            console.warn('[Ping] Tunnel warmup failed:', pingErr.message);
        }
        
        let serverResponse;
        try {
            serverResponse = await fetch(`${cleanUrl}/api/disk/status`, {
                headers: { 
                    'Authorization': `Bearer ${authHeader}`,
                    'Accept': 'application/json'
                },
                signal: AbortSignal.timeout(12000)
            });
        } catch (netErr) {
            throw new Error("offline");
        }
        
        if (!serverResponse.ok) {
            throw new Error("offline");
        }
        
        // Detect Cloudflare HTML challenge page served as 200 OK
        const contentType = serverResponse.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            // Got HTML challenge page — tunnel needs browser activation
            const challengeUrl = cleanUrl;
            state.devices.forEach(device => {
                state.devicesStatus[device.id] = {
                    status: 'challenge',
                    message: 'Activate Tunnel',
                    storage: null,
                    url: challengeUrl
                };
            });
            updateStatus('disconnected');
            diskBadge.classList.add('hidden');
            renderDashboard();
            updateHeaderSwitcher();
            return;
        }
        
        state.diskInfo = await serverResponse.json(); // returns {"drives": { id: { name, status, storage, audit_log, path } }}
        
        // 3. Populate devicesStatus maps
        state.devices.forEach(device => {
            const devData = state.diskInfo.drives[device.id];
            if (devData && devData.status === 'online') {
                state.devicesStatus[device.id] = {
                    status: 'online',
                    message: 'Online',
                    storage: devData.storage,
                    url: cleanUrl
                };
                
                if (device.id === state.activeDeviceId) {
                    diskBadgeName.textContent = devData.name;
                    diskBadge.classList.remove('hidden');
                    updateStatus('connected');
                }
            } else {
                state.devicesStatus[device.id] = {
                    status: 'offline',
                    message: devData ? 'Offline' : 'Not Connected to PC',
                    storage: null,
                    url: ''
                };
                
                if (device.id === state.activeDeviceId) {
                    diskBadge.classList.add('hidden');
                    updateStatus('disconnected');
                }
            }
        });
        
    } catch (e) {
        // Central server offline
        console.warn("Central server connection offline:", e);
        state.devices.forEach(device => {
            state.devicesStatus[device.id] = {
                status: 'offline',
                message: 'Offline (PC Service Stopped)',
                storage: null,
                url: ''
            };
        });
        updateStatus('disconnected');
        diskBadge.classList.add('hidden');
    }
    
    renderDashboard();
    updateHeaderSwitcher();
}

// Render Dashboard Grid Card
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
        } else if (info.status === 'challenge') {
            storageHtml = `<p class="text-secondary" style="font-size: 0.85rem; margin-top:0.25rem; color: #f59e0b;">⚠️ Cloudflare tunnel needs one-time browser activation.</p>`;
        }
        
        let urlHtml = `<div class="card-url-section"><i data-lucide="link-2"></i><span>Disconnected</span></div>`;
        if (info.url && info.status === 'online') {
            urlHtml = `<div class="card-url-section"><i data-lucide="link-2"></i><a href="${info.url}" target="_blank">${info.url}</a></div>`;
        } else if (info.url && info.status === 'challenge') {
            urlHtml = `<div class="card-url-section"><i data-lucide="link-2"></i><a href="${info.url}" target="_blank" style="color:#f59e0b;">${info.url}</a></div>`;
        }
        
        const isOnline = info.status === 'online';
        const isChallenge = info.status === 'challenge';
        
        card.innerHTML = `
            <div class="card-header-status">
                <h4>${device.name}</h4>
                <span class="status-badge ${info.status === 'challenge' ? 'offline' : info.status}" style="${info.status === 'challenge' ? 'background:rgba(245,158,11,0.15);color:#f59e0b;border-color:rgba(245,158,11,0.3)' : ''}">
                    <span class="status-dot ${info.status === 'challenge' ? 'offline' : info.status}"></span>
                    ${info.message}
                </span>
            </div>
            <div class="card-body-storage">
                ${storageHtml}
            </div>
            ${urlHtml}
            <div class="card-actions-row">
                ${isChallenge ? `
                <button class="btn btn-full activate-btn" data-id="${device.id}" data-url="${info.url}" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;font-weight:600;grid-column:1/-1;">
                    <i data-lucide="external-link" style="width:14px;height:14px;"></i> Activate Tunnel — Click Here
                </button>
                ` : `
                <button class="btn btn-primary btn-full browse-btn" data-id="${device.id}" ${!isOnline ? 'disabled' : ''}>
                    <i data-lucide="folder-open" style="width:14px;height:14px;"></i> Browse
                </button>
                <button class="btn btn-secondary btn-full audit-btn" data-id="${device.id}" ${!isOnline ? 'disabled' : ''}>
                    <i data-lucide="activity" style="width:14px;height:14px;"></i> Logs
                </button>
                `}
            </div>
        `;
        
        const browseBtn = card.querySelector('.browse-btn');
        const auditBtn = card.querySelector('.audit-btn');
        const activateBtn = card.querySelector('.activate-btn');
        
        if (isOnline) {
            browseBtn.onclick = (e) => {
                e.stopPropagation();
                setActiveDevice(device.id, 'all');
            };
            auditBtn.onclick = (e) => {
                e.stopPropagation();
                setActiveDevice(device.id, 'audit');
            };
        } else if (isChallenge && activateBtn) {
            activateBtn.onclick = (e) => {
                e.stopPropagation();
                // Open tunnel in new tab to satisfy CF challenge, then retry
                window.open(activateBtn.dataset.url, '_blank');
                setTimeout(() => {
                    console.log('[Retry] Re-pinging after tunnel activation...');
                    pingDevices();
                }, 6000);
            };
        }
        
        devicesDashboardGrid.appendChild(card);
    });
    
    // Add new drive registration card
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

// Switch active drive target
function setActiveDevice(deviceId, targetTab) {
    state.activeDeviceId = deviceId;
    state.activeTab = targetTab;
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-tab') === targetTab) item.classList.add('active');
    });
    
    fetchActiveDeviceFiles();
}

// Update header switcher drop list
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

// Load media files indexing for the selected drive
async function fetchActiveDeviceFiles() {
    const device = state.devices.find(d => d.id === state.activeDeviceId);
    if (!device) {
        showSetupScreen();
        return;
    }
    
    showState(loadingState);
    updateStatus('syncing');
    
    try {
        if (!state.resolvedUrl) {
            throw new Error("Connection URL not resolved. Verify PC backend service is running.");
        }
        
        // Fetch files list for specific drive ID
        const response = await fetch(`${state.resolvedUrl}/api/files?drive_id=${encodeURIComponent(device.id)}`, {
            headers: { 
                'Authorization': `Bearer ${device.apiToken}`,
                'Accept': 'application/json'
            }
        });
        
        if (response.status === 401) {
            throw new Error("Unauthorized: Invalid API passcode for this drive.");
        }
        if (!response.ok) {
            throw new Error(`NAS server returned status: ${response.status}`);
        }
        
        const data = await response.json();
        state.files = data.files || [];
        
        // Update storage and logs metadata
        const statData = state.diskInfo.drives[device.id];
        if (statData) {
            state.diskInfo = {
                disk_name: statData.name,
                disk_id: device.id,
                storage: statData.storage,
                audit_log: statData.audit_log
            };
        }
        
        updateStatus('connected');
        renderActiveTab();
    } catch (err) {
        console.error("Fetch error:", err);
        updateStatus('disconnected');
        diskBadge.classList.add('hidden');
        
        showState(emptyState);
        emptyState.querySelector('h3').textContent = "Connection Failed";
        emptyState.querySelector('p').textContent = err.message || `Could not fetch files from ${device.name}`;
    }
    updateHeaderSwitcher();
}

// Router for navigation panels
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
        emptyState.querySelector('p').textContent = `The category '${state.activeTab}' is currently empty.`;
        return;
    }
    
    showState(filesGrid);
    filesGrid.innerHTML = '';
    
    filteredFiles.forEach(file => {
        const device = state.devices.find(d => d.id === state.activeDeviceId);
        const fileUrl = `${state.resolvedUrl}/api/files/download/${encodeURIComponent(file.path)}?drive_id=${encodeURIComponent(state.activeDeviceId)}&token=${encodeURIComponent(device.apiToken)}`;
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

// Render dynamic settings and account parameters
function renderSettingsTab() {
    tabTitle.textContent = "Settings & Account";
    tabSubtitle.textContent = "Register devices, view profile details, or log out of your profile";
    
    showState(filesGrid);
    
    let devicesListHtml = '';
    if (state.devices.length === 0) {
        devicesListHtml = '<p class="text-secondary" style="grid-column: 1/-1; text-align: center; margin: 1rem 0;">No drives registered yet. Add your first drive below!</p>';
    } else {
        state.devices.forEach(device => {
            devicesListHtml += `
                <div class="audit-item glass" style="border-radius: 8px; margin-bottom: 0.75rem; padding: 1rem; flex-direction: row; justify-content: space-between; align-items: center; display: flex;">
                    <div>
                        <strong style="color: #fff; font-size: 1rem;">${device.name}</strong>
                        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">
                            Drive UUID ID: <span style="font-family: monospace;">${device.id}</span>
                            ${device.serverUrlOverride ? ` | Direct URL Override: <span style="font-family: monospace;">${device.serverUrlOverride}</span>` : ''}
                        </div>
                    </div>
                    <div>
                        <button class="btn btn-secondary btn-icon delete-device-btn" data-id="${device.id}" title="Remove Drive" style="border-color: rgba(239, 68, 110, 0.2); color: var(--error); width: 34px; height: 34px; padding: 0;">
                            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                        </button>
                    </div>
                </div>
            `;
        });
    }
    
    filesGrid.innerHTML = `
        <div class="card glass" style="grid-column: 1 / -1; margin: 0 auto; max-width: 680px; width: 100%; padding: 2rem; border-radius: var(--border-radius); display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                <h3 style="margin: 0;">Registered Devices</h3>
                <span class="text-secondary" style="font-size: 0.85rem;">Account: <strong>${state.username}</strong></span>
            </div>
            
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
                <label for="new-device-id">Unique Drive ID (from server's config.json)</label>
                <input type="text" id="new-device-id" placeholder="e.g. disk-uuid-...">
            </div>
            <div class="form-group">
                <label for="new-device-token">Drive API passcode Token</label>
                <input type="password" id="new-device-token" placeholder="Enter drive passcode">
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
            
            <button class="btn btn-primary btn-full" id="btn-add-device" style="margin-top: 1.5rem; width: 100%;">Add Drive to Network</button>
            <button class="btn btn-secondary btn-full" id="btn-logout" style="margin-top: 1rem; border-color: rgba(239, 68, 110, 0.2); color: var(--error); width: 100%;">Log Out Account</button>
        </div>
    `;
    
    // Bind deletes
    document.querySelectorAll('.delete-device-btn').forEach(btn => {
        btn.onclick = async () => {
            const id = btn.getAttribute('data-id');
            const dev = state.devices.find(d => d.id === id);
            if (dev && confirm(`Are you sure you want to remove '${dev.name}' from your dashboard?`)) {
                state.devices = state.devices.filter(d => d.id !== id);
                if (state.activeDeviceId === id) {
                    state.activeDeviceId = state.devices.length > 0 ? state.devices[0].id : '';
                    state.diskInfo = null;
                    diskBadge.classList.add('hidden');
                }
                await saveRegistryOnGist();
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
    
    document.getElementById('btn-add-device').onclick = async () => {
        const name = document.getElementById('new-device-name').value.trim();
        const devId = document.getElementById('new-device-id').value.trim();
        const token = document.getElementById('new-device-token').value.trim();
        const url = document.getElementById('new-device-url').value.trim();
        
        if (!name || !devId || !token) {
            alert("Please fill in Drive Name, Unique Drive ID, and API passcode.");
            return;
        }
        
        const newDev = {
            id: devId,
            name: name,
            apiToken: token,
            serverUrlOverride: url
        };
        
        state.devices.push(newDev);
        if (!state.activeDeviceId) {
            state.activeDeviceId = newDev.id;
        }
        
        await saveRegistryOnGist();
        alert(`Drive '${name}' successfully registered!`);
        renderSettingsTab();
    };
    
    document.getElementById('btn-logout').onclick = () => {
        if (confirm("Log out of your NAS account? All local session state will be cleared.")) {
            sessionStorage.removeItem('nas_session');
            state.devices = [];
            state.gistId = '';
            state.githubPat = '';
            state.derivedKey = null;
            state.activeDeviceId = '';
            state.resolvedUrl = '';
            state.files = [];
            state.diskInfo = null;
            state.devicesStatus = {};
            showSetupScreen();
        }
    };
    
    initIcons();
}

// Render dynamic audits logging tab
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
    
    const total = state.diskInfo.storage ? state.diskInfo.storage.total : 0;
    const free = state.diskInfo.storage ? state.diskInfo.storage.free : 0;
    const used = state.diskInfo.storage ? state.diskInfo.storage.used : 0;
    const usagePercent = total > 0 ? ((used / total) * 100).toFixed(1) : 0;
    
    document.getElementById('audit-disk-storage').textContent = total > 0 ? `${formatBytes(used)} / ${formatBytes(total)} (${usagePercent}% used)` : 'N/A';
    document.getElementById('audit-storage-bar').style.width = `${usagePercent}%`;
    
    const listContainer = document.getElementById('audit-list');
    listContainer.innerHTML = '';
    
    if (!state.diskInfo.audit_log || state.diskInfo.audit_log.length === 0) {
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

// Media Modals display click handler
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
        modalVideo.play().catch(e => console.log("Video playback scrub range info:", e));
    } else {
        const anchor = document.createElement('a');
        anchor.href = fileUrl;
        anchor.download = file.name;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
    }
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

btnLoginAccount.onclick = () => {
    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value.trim();
    if (username && password) {
        loginAccount(username, password);
    } else {
        alert("Please enter your Username and Password.");
    }
};

btnRegisterAccount.onclick = () => {
    registerAccount();
};

// Modal close binds
imageModalClose.onclick = () => {
    imageModal.classList.add('hidden');
    lightboxImage.src = '';
};

videoModalClose.onclick = () => {
    videoModal.classList.add('hidden');
    modalVideo.pause();
    modalVideo.src = '';
};

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

// Sidebar navigation click handler
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
        if (!state.gistId) {
            showSetupScreen();
            return;
        }
        
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

// Boot application
document.addEventListener('DOMContentLoaded', () => {
    initIcons();
    
    activeDeviceSelect.onchange = (e) => {
        setActiveDevice(e.target.value, state.activeTab);
    };
    
    // Check if user session is saved in sessionStorage
    const sessionRaw = sessionStorage.getItem('nas_session');
    if (sessionRaw) {
        try {
            const session = JSON.parse(sessionRaw);
            loginAccount(session.username, session.password);
        } catch (e) {
            sessionStorage.removeItem('nas_session');
            showSetupScreen();
        }
    } else {
        showSetupScreen();
    }
});
