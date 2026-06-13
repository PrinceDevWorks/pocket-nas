// app.js - Portable NAS Frontend Controller

// Application State
let state = {
    gistId: localStorage.getItem('nas_gist_id') || '',
    apiToken: localStorage.getItem('nas_api_token') || '',
    serverUrlOverride: localStorage.getItem('nas_server_url') || '',
    resolvedUrl: '',
    files: [],
    activeTab: 'all' // all, images, videos, documents, settings
};

// DOM Elements
const statusIndicator = document.getElementById('status-indicator');
const loadingState = document.getElementById('loading-state');
const emptyState = document.getElementById('empty-state');
const setupState = document.getElementById('setup-state');
const filesGrid = document.getElementById('files-grid');

const tabTitle = document.getElementById('tab-title');
const tabSubtitle = document.getElementById('tab-subtitle');
const btnRefresh = document.getElementById('btn-refresh');

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
async function resolveServerUrl() {
    if (state.serverUrlOverride) {
        console.log("Using direct server URL override:", state.serverUrlOverride);
        return state.serverUrlOverride;
    }
    
    if (!state.gistId) {
        throw new Error("Gist ID not configured");
    }
    
    updateStatus('syncing');
    
    // Add cache buster to prevent stale API responses
    const response = await fetch(`https://api.github.com/gists/${state.gistId}?t=${Date.now()}`);
    if (!response.ok) {
        throw new Error(`Gist lookup failed: ${response.statusText}`);
    }
    
    const gistData = await response.json();
    if (!gistData.files || !gistData.files['nas_url.json']) {
        throw new Error("Invalid Gist format. 'nas_url.json' not found.");
    }
    
    const content = JSON.parse(gistData.files['nas_url.json'].content);
    if (!content.url) {
        throw new Error("No URL entry inside nas_url.json");
    }
    
    return content.url;
}

// Fetch Files from Backend API
async function fetchFiles() {
    if (!state.gistId && !state.serverUrlOverride) {
        showSetupScreen();
        return;
    }
    
    showState(loadingState);
    
    try {
        state.resolvedUrl = await resolveServerUrl();
        // Trim trailing slash from url
        if (state.resolvedUrl.endsWith('/')) {
            state.resolvedUrl = state.resolvedUrl.slice(0, -1);
        }
        
        console.log("Target server URL:", state.resolvedUrl);
        
        // Test connection and auth
        const authResponse = await fetch(`${state.resolvedUrl}/api/status`, {
            headers: { 'Authorization': `Bearer ${state.apiToken}` }
        });
        
        if (authResponse.status === 401) {
            throw new Error("Unauthorized: Invalid API Token");
        }
        
        if (!authResponse.ok) {
            throw new Error(`NAS server returned status: ${authResponse.status}`);
        }
        
        // Load files
        const filesResponse = await fetch(`${state.resolvedUrl}/api/files`, {
            headers: { 'Authorization': `Bearer ${state.apiToken}` }
        });
        
        if (!filesResponse.ok) {
            throw new Error("Failed to index files on the remote server");
        }
        
        const data = await filesResponse.json();
        state.files = data.files || [];
        
        updateStatus('connected');
        renderActiveTab();
        
    } catch (err) {
        console.error("Connection error:", err);
        updateStatus('disconnected');
        
        // Render inline error container
        showState(emptyState);
        emptyState.querySelector('h3').textContent = "Connection Failed";
        emptyState.querySelector('p').textContent = err.message || "Could not connect to the remote NAS server.";
        
        // Add a retry button
        let retryBtn = emptyState.querySelector('.btn-retry');
        if (!retryBtn) {
            retryBtn = document.createElement('button');
            retryBtn.className = "btn btn-primary btn-retry";
            retryBtn.style.marginTop = "1rem";
            retryBtn.textContent = "Retry Connection";
            retryBtn.onclick = () => fetchFiles();
            emptyState.appendChild(retryBtn);
        }
    }
}

// Show a specific state element and hide others
function showState(elementToShow) {
    loadingState.classList.add('hidden');
    emptyState.classList.add('hidden');
    setupState.classList.add('hidden');
    filesGrid.classList.add('hidden');
    
    elementToShow.classList.remove('hidden');
}

// Display Configuration Entry Screen
function showSetupScreen() {
    showState(setupState);
    setupGistId.value = state.gistId;
    setupToken.value = state.apiToken;
    setupServerUrl.value = state.serverUrlOverride;
    updateStatus('disconnected');
}

// Filter and Render Media Items based on current Tab
function renderActiveTab() {
    if (state.activeTab === 'settings') {
        renderSettingsTab();
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
        // Remove retry button if it exists
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
        
        // Handle click event on the cards
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
    tabTitle.textContent = "Settings";
    tabSubtitle.textContent = "Configure your connection endpoints and local cache keys";
    
    showState(filesGrid);
    filesGrid.innerHTML = `
        <div class="card setup-card glass" style="grid-column: 1 / -1; margin: 0 auto; max-width: 550px;">
            <i data-lucide="settings" class="state-icon" style="margin: 0 auto 1.5rem; display: block;"></i>
            <h3 style="text-align: center; margin-bottom: 0.5rem;">Connection Settings</h3>
            <p class="text-secondary" style="text-align: center; margin-bottom: 2rem;">Adjust the credentials used to locate and access your Pocket NAS</p>
            
            <div class="form-group">
                <label for="settings-gist-id">GitHub Gist ID</label>
                <input type="text" id="settings-gist-id" value="${state.gistId}" placeholder="Enter Gist ID">
            </div>

            <div class="form-group">
                <label for="settings-token">API Authorization Token</label>
                <input type="password" id="settings-token" value="${state.apiToken}" placeholder="Enter Security Token">
            </div>

            <div class="form-group">
                <label for="settings-server-url">Direct Server URL Override (Optional)</label>
                <input type="text" id="settings-server-url" value="${state.serverUrlOverride}" placeholder="e.g. http://127.0.0.1:8000">
                <span class="input-hint">Specify direct local address to bypass dynamic Gist lookup.</span>
            </div>

            <button class="btn btn-primary btn-full" id="btn-save-settings" style="margin-top: 1rem;">Save Changes & Reconnect</button>
            <button class="btn btn-secondary btn-full" id="btn-clear-settings" style="margin-top: 0.75rem; border-color: rgba(239, 68, 110, 0.2); color: #ef4444;">Disconnect & Reset Keys</button>
        </div>
    `;
    
    // Bind inline settings triggers
    document.getElementById('btn-save-settings').onclick = () => {
        const gist = document.getElementById('settings-gist-id').value.trim();
        const token = document.getElementById('settings-token').value.trim();
        const serverUrl = document.getElementById('settings-server-url').value.trim();
        
        saveConfiguration(gist, token, serverUrl);
    };

    document.getElementById('btn-clear-settings').onclick = () => {
        if (confirm("Are you sure you want to clear your local credentials? This will sign you out of the server.")) {
            localStorage.clear();
            state.gistId = '';
            state.apiToken = '';
            state.serverUrlOverride = '';
            state.files = [];
            state.activeTab = 'all';
            
            // Switch navigation active states back to all
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
                if (item.getAttribute('data-tab') === 'all') {
                    item.classList.add('active');
                }
            });
            
            showSetupScreen();
            initIcons();
        }
    };
    
    initIcons();
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
        // Direct download for other files
        const anchor = document.createElement('a');
        anchor.href = fileUrl;
        anchor.download = file.name;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
    }
}

// Save configuration credentials helper
function saveConfiguration(gist, token, serverUrl) {
    if (!gist && !serverUrl) {
        alert("Please enter either a Gist ID or a Direct Server URL to connect.");
        return;
    }
    
    if (!token) {
        alert("Please enter the API Security Token configured in config.json.");
        return;
    }
    
    localStorage.setItem('nas_gist_id', gist);
    localStorage.setItem('nas_api_token', token);
    localStorage.setItem('nas_server_url', serverUrl);
    
    state.gistId = gist;
    state.apiToken = token;
    state.serverUrlOverride = serverUrl;
    
    // Reset active tab to listing
    state.activeTab = 'all';
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-tab') === 'all') {
            item.classList.add('active');
        }
    });
    
    fetchFiles();
}

// Event Bindings
btnRefresh.onclick = () => {
    if (state.activeTab === 'settings') return;
    fetchFiles();
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
        
        // Reset contents to prevent background playing/rendering
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
        
        // Hide/show refresh button
        if (state.activeTab === 'settings') {
            btnRefresh.classList.add('hidden');
        } else {
            btnRefresh.classList.remove('hidden');
        }
        
        // If we are already loaded, just render, otherwise connect first
        if (state.files.length > 0 || state.activeTab === 'settings') {
            renderActiveTab();
        } else {
            fetchFiles();
        }
    };
});

// Bootstrap Application
document.addEventListener('DOMContentLoaded', () => {
    initIcons();
    
    // Auto initiate connection if keys exist
    if (state.gistId || state.serverUrlOverride) {
        fetchFiles();
    } else {
        showSetupScreen();
    }
});
