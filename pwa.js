class PWAManager {
    constructor() {
        this.deferredPrompt = null;
        this.isInstalled = false;
        this.updateInterval = null;
        this.init();
    }

    async init() {
        // Register service worker
        await this.registerServiceWorker();
        
        // Setup install prompt
        this.setupInstallPrompt();

        // Initialize Vercel Analytics if available
        try {
            if (typeof window.va === 'function' && window.__vaReady) {
                window.va('init');
            }
        } catch (e) {}
        
        // Handle URL parameters for shortcuts
        this.handleShortcuts();
        
        // Listen for app updates
        this.listenForUpdates();
        
        // Setup offline/online handlers
        this.setupConnectionHandlers();
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js');
                console.log('✅ Service Worker registered:', registration.scope);
                
                // Listen for updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                this.showUpdateAvailable();
                            }
                        });
                    }
                });
                
                // Listen for messages from SW
                navigator.serviceWorker.addEventListener('message', event => {
                    this.handleServiceWorkerMessage(event.data);
                });
                
            } catch (error) {
                console.error('❌ Service Worker registration failed:', error);
            }
        }
    }

    setupInstallPrompt() {
        // Listen for install prompt
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            this.showInstallPrompt();
        });

        // Handle install button click
        document.getElementById('install-btn')?.addEventListener('click', () => {
            this.installApp();
        });

        // Handle dismiss button
        document.getElementById('install-dismiss')?.addEventListener('click', () => {
            this.hideInstallPrompt();
            // Don't show again for 7 days
            localStorage.setItem('installPromptDismissed', Date.now() + (7 * 24 * 60 * 60 * 1000));
        });

        // Check if already installed
        window.addEventListener('appinstalled', () => {
            console.log('✅ PWA installed successfully');
            this.isInstalled = true;
            this.hideInstallPrompt();
            this.showToast('🎉 App installed! Welcome to Weekend Adventure Planner!');
        });

        // Auto-show install prompt after user engagement
        setTimeout(() => {
            if (!this.isInstalled && this.shouldShowInstallPrompt()) {
                this.showInstallPrompt();
            }
        }, 30000); // Show after 30 seconds
    }

    shouldShowInstallPrompt() {
        const dismissed = localStorage.getItem('installPromptDismissed');
        if (dismissed && Date.now() < parseInt(dismissed)) {
            return false;
        }
        
        // Check if running in standalone mode (already installed)
        if (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches) {
            this.isInstalled = true;
            return false;
        }
        
        return this.deferredPrompt !== null;
    }

    showInstallPrompt() {
        if (!this.shouldShowInstallPrompt()) return;
        
        const prompt = document.getElementById('install-prompt');
        if (prompt) {
            prompt.classList.remove('hidden');
            prompt.style.animation = 'slideDown 0.3s ease';
        }
    }

    hideInstallPrompt() {
        const prompt = document.getElementById('install-prompt');
        if (prompt) {
            prompt.style.animation = 'slideUp 0.3s ease';
            setTimeout(() => {
                prompt.classList.add('hidden');
            }, 300);
        }
    }

    async installApp() {
        if (!this.deferredPrompt) return;

        try {
            // Show install prompt
            this.deferredPrompt.prompt();
            
            // Wait for user choice
            const result = await this.deferredPrompt.userChoice;
            
            if (result.outcome === 'accepted') {
                console.log('✅ User accepted install prompt');
                this.showToast('📱 Installing app...');
            } else {
                console.log('❌ User dismissed install prompt');
            }
            
            this.deferredPrompt = null;
            this.hideInstallPrompt();
            
        } catch (error) {
            console.error('❌ Install prompt failed:', error);
        }
    }

    handleShortcuts() {
        const urlParams = new URLSearchParams(window.location.search);
        const action = urlParams.get('action');
        
        if (action && window.randomPlacesFinder) {
            setTimeout(() => {
                switch (action) {
                    case 'random':
                        // Trigger random place finding
                        const surpriseBtn = document.getElementById('surprise-me');
                        if (surpriseBtn) {
                            surpriseBtn.click();
                        }
                        break;
                    case 'adventure':
                        // Switch to adventure tab
                        if (window.adventurePlanner) {
                            window.adventurePlanner.switchTab('adventure');
                        }
                        break;
                }
            }, 1000);
        }
    }

    listenForUpdates() {
        // Clear existing interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        
        // Check for updates periodically
        this.updateInterval = setInterval(async () => {
            if ('serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.getRegistration();
                if (registration) {
                    registration.update();
                }
            }
        }, 60000); // Check every minute
    }

    showUpdateAvailable() {
        this.showToast('🔄 New version available! Refresh to update.', 'update', () => {
            window.location.reload();
        });
    }

    setupConnectionHandlers() {
        // Handle online/offline events
        window.addEventListener('online', () => {
            this.showToast('🟢 Back online!', 'success');
            // Trigger any pending syncs
            try {
                if ('serviceWorker' in navigator && 'sync' in (window.ServiceWorkerRegistration?.prototype || {})) {
                    navigator.serviceWorker.ready.then(registration => {
                        try { registration.sync.register('upload-adventure'); } catch (e) {}
                    });
                }
            } catch (e) {}
        });

        window.addEventListener('offline', () => {
            this.showToast('🔴 You\'re offline - Some features may be limited', 'warning');
        });

        // Initial connection check
        if (!navigator.onLine) {
            this.showToast('🔴 You\'re offline - Some features may be limited', 'warning');
        }
    }

    handleServiceWorkerMessage(data) {
        switch (data.type) {
            case 'BACK_ONLINE':
                this.showToast('🟢 Connection restored!', 'success');
                break;
            case 'CACHE_UPDATED':
                console.log('✅ App cache updated');
                break;
        }
    }

    showToast(message, type = 'info', action = null) {
        try { if (typeof window.va === 'function' && window.__vaReady) window.va('event', { type: 'toast', level: type }); } catch (e) {}
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <span class="toast-message">${message}</span>
                ${action ? '<button class="toast-action">Act</button>' : ''}
                <button class="toast-close" aria-label="Close">×</button>
            </div>
        `;

        // Style the toast
        Object.assign(toast.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            background: this.getToastColor(type),
            color: 'white',
            padding: '12px 16px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: '10000',
            animation: 'slideInRight 0.3s ease',
            maxWidth: '320px',
            fontSize: '14px'
        });

        // Container for stacking
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            Object.assign(container.style, {
                position: 'fixed', top: '16px', right: '16px', left: 'auto', zIndex: '10000', display: 'flex', flexDirection: 'column', gap: '8px'
            });
            document.body.appendChild(container);
        }
        container.appendChild(toast);
        // Limit stacked toasts on small screens
        if (window.innerWidth < 768) {
            while (container.children.length > 2) {
                container.removeChild(container.firstChild);
            }
        }

        // Handle actions
        const actionBtn = toast.querySelector('.toast-action');
        if (actionBtn && action) {
            actionBtn.addEventListener('click', () => {
                action();
                this.removeToast(toast);
            });
        }

        const closeBtn = toast.querySelector('.toast-close');
        if (closeBtn) {
            closeBtn.style.fontSize = '14px';
            closeBtn.style.width = '22px';
            closeBtn.style.height = '22px';
            closeBtn.style.display = 'inline-flex';
            closeBtn.style.alignItems = 'center';
            closeBtn.style.justifyContent = 'center';
            closeBtn.style.lineHeight = '1';
            closeBtn.style.borderRadius = '4px';
            closeBtn.addEventListener('click', () => {
                this.removeToast(toast);
            });
            // Swipe to dismiss on mobile
            let startX = 0; let deltaX = 0; let touching = false;
            toast.addEventListener('touchstart', (e) => { touching = true; startX = e.touches[0].clientX; }, { passive: true });
            toast.addEventListener('touchmove', (e) => { if (!touching) return; deltaX = e.touches[0].clientX - startX; toast.style.transform = `translateX(${deltaX}px)`; toast.style.opacity = String(1 - Math.min(Math.abs(deltaX)/120, 0.9)); }, { passive: true });
            toast.addEventListener('touchend', () => { touching = false; if (Math.abs(deltaX) > 80) { this.removeToast(toast); } else { toast.style.transform = ''; toast.style.opacity = '1'; } }, { passive: true });
        }

        // Auto remove after 5 seconds
        setTimeout(() => {
            this.removeToast(toast);
        }, 5000);
    }

    getToastColor(type) {
        const colors = {
            info: '#667eea',
            success: '#10b981',
            warning: '#f59e0b',
            error: '#ef4444',
            update: '#8b5cf6'
        };
        return colors[type] || colors.info;
    }

    removeToast(toast) {
        if (toast.parentNode) {
            toast.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }
    }

    // Share functionality
    async shareAdventure(adventure) {
        const shareData = {
            title: 'My Weekend Adventure',
            text: `Check out my ${adventure.places.length}-stop adventure!`,
            url: `${window.location.origin}?shared=${btoa(JSON.stringify(adventure))}`
        };

        try {
            if (navigator.share) {
                await navigator.share(shareData);
                this.showToast('🎉 Adventure shared!', 'success');
            } else {
                // Fallback to clipboard
                await navigator.clipboard.writeText(shareData.url);
                this.showToast('🔗 Adventure link copied to clipboard!', 'success');
            }
        } catch (error) {
            console.error('Share failed:', error);
            this.showToast('❌ Share failed', 'error');
        }
    }
}

// Add CSS animations for PWA elements
const pwaStyles = document.createElement('style');
pwaStyles.textContent = `
    .install-prompt {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: white;
        z-index: 1000;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }

    .install-content {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px 20px;
        gap: 12px;
        flex-wrap: wrap;
    }

    .install-icon {
        font-size: 1.2em;
    }

    .install-text {
        flex: 1;
        min-width: 200px;
        font-weight: 500;
    }

    .install-button {
        background: rgba(255,255,255,0.2);
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .install-button:hover {
        background: rgba(255,255,255,0.3);
        transform: translateY(-1px);
    }

    .install-dismiss {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        padding: 4px;
        opacity: 0.7;
        transition: opacity 0.3s ease;
    }

    .install-dismiss:hover {
        opacity: 1;
    }

    @keyframes slideDown {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
    }

    @keyframes slideUp {
        from { transform: translateY(0); }
        to { transform: translateY(-100%); }
    }

    @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }

    @keyframes slideOutRight {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }

    .toast-content {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .toast-message {
        flex: 1;
    }

    .toast-action, .toast-close {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        line-height: 1;
        height: 22px;
        min-width: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .toast-action:hover, .toast-close:hover {
        background: rgba(255,255,255,0.3);
    }

    @media (max-width: 768px) {
        .install-content {
            padding: 10px 15px;
            gap: 8px;
        }
        
        .install-text {
            min-width: 150px;
            font-size: 14px;
        }
        
        #toast-container {
            right: 10px !important;
            left: 10px !important;
        }
    }
`;
document.head.appendChild(pwaStyles);

// Initialize PWA when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.pwaManager = new PWAManager();
});

// Add cleanup method to PWAManager prototype
PWAManager.prototype.destroy = function() {
    if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
    }
};