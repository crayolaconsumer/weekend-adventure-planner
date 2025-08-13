class AccessibilityManager {
    constructor() {
        this.focusTrap = null;
        this.lastFocusedElement = null;
        this.isHighContrast = false;
        this.announcements = [];
        this.init();
    }

    init() {
        this.addARIALabels();
        this.setupKeyboardNavigation();
        this.createLiveRegion();
        this.addFocusManagement();
        this.setupHighContrastMode();
        this.addSkipLinks();
        this.improveFormAccessibility();
        this.addLandmarks();
        this.setupReducedMotion();
    }

    addARIALabels() {
        // Add ARIA labels to interactive elements
        const elements = [
            { selector: '#use-current-location', label: 'Get current location' },
            { selector: '#find-attraction', label: 'Find random attraction near me' },
            { selector: '#find-restaurant', label: 'Find random restaurant near me' },
            { selector: '#surprise-me', label: 'Find random place with random theme' },
            { selector: '#dark-mode-toggle', label: 'Toggle between light and dark mode' },
            { selector: '#build-adventure', label: 'Build multi-stop adventure plan' },
            { selector: '#mystery-adventure', label: 'Create mystery adventure with hidden destinations' },
            { selector: '#start-adventure', label: 'Start following the adventure plan' },
            { selector: '#save-adventure', label: 'Save adventure plan for later' },
            { selector: '#get-directions', label: 'Get directions to this place' },
            { selector: '#mark-visited', label: 'Mark this place as visited' },
            { selector: '#add-to-adventure', label: 'Add this place to current adventure' }
        ];

        elements.forEach(({ selector, label }) => {
            const element = document.querySelector(selector);
            if (element) {
                element.setAttribute('aria-label', label);
                if (!element.getAttribute('title')) {
                    element.setAttribute('title', label);
                }
            }
        });

        // Add ARIA labels to tabs
        document.querySelectorAll('.tab-btn').forEach((tab, index) => {
            const tabText = tab.textContent.trim();
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-label', `Switch to ${tabText} tab`);
            tab.setAttribute('aria-selected', tab.classList.contains('active'));
            tab.setAttribute('tabindex', tab.classList.contains('active') ? '0' : '-1');
        });

        // Add ARIA labels to tab panels
        document.querySelectorAll('.tab-content').forEach((panel, index) => {
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', `tab-${index}`);
        });
    }

    setupKeyboardNavigation() {
        // Enhanced keyboard navigation
        document.addEventListener('keydown', (e) => {
            this.handleGlobalKeydown(e);
        });

        // Tab navigation
        this.setupTabKeyboardNavigation();
        
        // Modal keyboard navigation
        this.setupModalKeyboardNavigation();
        
        // Custom keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    handleGlobalKeydown(e) {
        // Global keyboard shortcuts
        if (e.altKey) {
            switch (e.key) {
                case '1':
                    e.preventDefault();
                    this.switchToTab('single');
                    this.announceToScreenReader('Switched to Single Place tab');
                    break;
                case '2':
                    e.preventDefault();
                    this.switchToTab('adventure');
                    this.announceToScreenReader('Switched to Adventure Builder tab');
                    break;
                case '3':
                    e.preventDefault();
                    this.switchToTab('history');
                    this.announceToScreenReader('Switched to My Adventures tab');
                    break;
                case 'r':
                    e.preventDefault();
                    const surpriseBtn = document.getElementById('surprise-me');
                    if (surpriseBtn && !surpriseBtn.disabled) {
                        surpriseBtn.click();
                        this.announceToScreenReader('Finding random place');
                    }
                    break;
            }
        }

        // Escape key handling
        if (e.key === 'Escape') {
            this.handleEscape();
        }
    }

    setupTabKeyboardNavigation() {
        const tabsContainer = document.querySelector('.tabs');
        if (!tabsContainer) return;

        tabsContainer.setAttribute('role', 'tablist');

        document.querySelectorAll('.tab-btn').forEach((tab, index) => {
            tab.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    const tabs = Array.from(document.querySelectorAll('.tab-btn'));
                    const currentIndex = tabs.indexOf(e.target);
                    let newIndex;

                    if (e.key === 'ArrowLeft') {
                        newIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
                    } else {
                        newIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
                    }

                    tabs[newIndex].focus();
                    tabs[newIndex].click();
                }
            });
        });
    }

    setupModalKeyboardNavigation() {
        // Handle modals and popups
        document.addEventListener('focusin', (e) => {
            const modal = e.target.closest('.share-modal, .install-prompt');
            if (modal && !this.focusTrap) {
                this.trapFocus(modal);
            }
        });
    }

    setupKeyboardShortcuts() {
        // Add keyboard shortcut help
        this.createKeyboardShortcutHelp();
        
        // Show help with ?
        document.addEventListener('keydown', (e) => {
            if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const activeElement = document.activeElement;
                if (activeElement.tagName !== 'INPUT' && activeElement.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    this.showKeyboardShortcuts();
                }
            }
        });
    }

    createLiveRegion() {
        // Create ARIA live region for announcements
        const liveRegion = document.createElement('div');
        liveRegion.id = 'aria-live-region';
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.setAttribute('aria-atomic', 'true');
        liveRegion.style.cssText = `
            position: absolute;
            left: -10000px;
            width: 1px;
            height: 1px;
            overflow: hidden;
        `;
        document.body.appendChild(liveRegion);

        // Create urgent live region
        const urgentRegion = document.createElement('div');
        urgentRegion.id = 'aria-live-urgent';
        urgentRegion.setAttribute('aria-live', 'assertive');
        urgentRegion.setAttribute('aria-atomic', 'true');
        urgentRegion.style.cssText = liveRegion.style.cssText;
        document.body.appendChild(urgentRegion);
    }

    announceToScreenReader(message, urgent = false) {
        const regionId = urgent ? 'aria-live-urgent' : 'aria-live-region';
        const region = document.getElementById(regionId);
        
        if (region) {
            // Clear previous message
            region.textContent = '';
            
            // Set new message after a brief delay to ensure it's announced
            setTimeout(() => {
                region.textContent = message;
                
                // Clear after announcement
                setTimeout(() => {
                    region.textContent = '';
                }, 1000);
            }, 100);
        }

        // Store announcement for history
        this.announcements.push({
            message,
            urgent,
            timestamp: new Date().toISOString()
        });

        // Keep only last 50 announcements
        if (this.announcements.length > 50) {
            this.announcements = this.announcements.slice(-50);
        }
    }

    addFocusManagement() {
        // Enhanced focus management
        this.setupFocusIndicators();
        this.manageFocusOnTabSwitch();
        this.manageFocusOnContentChange();
    }

    setupFocusIndicators() {
        // Add visible focus indicators
        const focusStyle = document.createElement('style');
        focusStyle.textContent = `
            .focus-visible,
            *:focus-visible {
                outline: 3px solid #667eea !important;
                outline-offset: 2px !important;
                border-radius: 4px;
            }

            .high-contrast .focus-visible,
            .high-contrast *:focus-visible {
                outline: 4px solid #ffff00 !important;
                outline-offset: 3px !important;
            }

            /* Skip link styles */
            .skip-link {
                position: absolute;
                top: -40px;
                left: 6px;
                background: #667eea;
                color: white;
                padding: 8px;
                border-radius: 0 0 4px 4px;
                text-decoration: none;
                font-weight: 600;
                z-index: 10001;
                transition: top 0.3s ease;
            }

            .skip-link:focus {
                top: 0;
            }
        `;
        document.head.appendChild(focusStyle);
    }

    manageFocusOnTabSwitch() {
        // Focus management when switching tabs
        document.addEventListener('tabSwitched', (e) => {
            const newTabPanel = document.getElementById(`${e.detail.tabName}-mode`);
            if (newTabPanel) {
                // Focus first interactive element in new tab
                const firstFocusable = newTabPanel.querySelector(
                    'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if (firstFocusable) {
                    setTimeout(() => firstFocusable.focus(), 100);
                }
            }
        });
    }

    manageFocusOnContentChange() {
        // Focus management when content changes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Focus on new important content
                        if (node.classList?.contains('place-card')) {
                            this.announceToScreenReader('New place found');
                            setTimeout(() => {
                                const placeTitle = node.querySelector('h2');
                                if (placeTitle) {
                                    placeTitle.focus();
                                }
                            }, 500);
                        } else if (node.classList?.contains('adventure-plan')) {
                            this.announceToScreenReader('Adventure plan ready');
                        }
                    }
                });
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    setupHighContrastMode() {
        // High contrast mode toggle
        const highContrastToggle = document.createElement('button');
        highContrastToggle.id = 'high-contrast-toggle';
        highContrastToggle.className = 'accessibility-toggle';
        highContrastToggle.innerHTML = '🎨';
        highContrastToggle.title = 'Toggle high contrast mode';
        highContrastToggle.setAttribute('aria-label', 'Toggle high contrast mode');
        
        highContrastToggle.addEventListener('click', () => {
            this.toggleHighContrast();
        });

        // Add to header
        const statsBar = document.querySelector('.stats-bar');
        if (statsBar) {
            statsBar.appendChild(highContrastToggle);
        }

        // Check for system preference
        if (window.matchMedia('(prefers-contrast: high)').matches) {
            this.enableHighContrast();
        }
    }

    toggleHighContrast() {
        this.isHighContrast = !this.isHighContrast;
        
        if (this.isHighContrast) {
            this.enableHighContrast();
        } else {
            this.disableHighContrast();
        }
    }

    enableHighContrast() {
        document.documentElement.classList.add('high-contrast');
        localStorage.setItem('highContrast', 'true');
        this.isHighContrast = true;
        this.announceToScreenReader('High contrast mode enabled');
    }

    disableHighContrast() {
        document.documentElement.classList.remove('high-contrast');
        localStorage.setItem('highContrast', 'false');
        this.isHighContrast = false;
        this.announceToScreenReader('High contrast mode disabled');
    }

    addSkipLinks() {
        // Add skip navigation links
        const skipLinks = document.createElement('nav');
        skipLinks.className = 'skip-navigation';
        skipLinks.innerHTML = `
            <a href="#main-content" class="skip-link">Skip to main content</a>
            <a href="#navigation" class="skip-link">Skip to navigation</a>
            <a href="#search" class="skip-link">Skip to search</a>
        `;
        
        document.body.insertBefore(skipLinks, document.body.firstChild);

        // Add IDs to target elements
        const mainContent = document.querySelector('.controls');
        if (mainContent) {
            mainContent.id = 'main-content';
            mainContent.setAttribute('role', 'main');
        }

        const navigation = document.querySelector('.tabs');
        if (navigation) {
            navigation.id = 'navigation';
        }

        const search = document.querySelector('#location');
        if (search) {
            search.id = 'search';
        }
    }

    improveFormAccessibility() {
        // Improve form accessibility
        document.querySelectorAll('label').forEach(label => {
            const labelText = label.textContent.trim();
            if (labelText) {
                label.setAttribute('aria-label', labelText);
            }
        });

        // Add required field indicators
        document.querySelectorAll('input[required], select[required]').forEach(field => {
            field.setAttribute('aria-required', 'true');
            
            // Add visual indicator
            const label = document.querySelector(`label[for="${field.id}"]`);
            if (label && !label.querySelector('.required-indicator')) {
                const indicator = document.createElement('span');
                indicator.className = 'required-indicator';
                indicator.textContent = ' *';
                indicator.setAttribute('aria-label', 'required');
                label.appendChild(indicator);
            }
        });

        // Improve error handling
        this.setupFormErrorHandling();
    }

    setupFormErrorHandling() {
        // Better error announcements
        document.addEventListener('invalid', (e) => {
            const field = e.target;
            const errorMessage = field.validationMessage;
            this.announceToScreenReader(`Error in ${field.name || field.id}: ${errorMessage}`, true);
        });
    }

    addLandmarks() {
        // Add ARIA landmarks for better navigation
        const header = document.querySelector('header');
        if (header) {
            header.setAttribute('role', 'banner');
        }

        const tabs = document.querySelector('.tabs');
        if (tabs) {
            tabs.setAttribute('role', 'navigation');
            tabs.setAttribute('aria-label', 'Main navigation');
        }

        const controls = document.querySelector('.controls');
        if (controls) {
            controls.setAttribute('role', 'main');
            controls.setAttribute('aria-label', 'Main content');
        }
    }

    setupReducedMotion() {
        // Respect prefers-reduced-motion
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            document.documentElement.classList.add('reduced-motion');
        }

        // Listen for changes
        window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
            if (e.matches) {
                document.documentElement.classList.add('reduced-motion');
                this.announceToScreenReader('Animations reduced for accessibility');
            } else {
                document.documentElement.classList.remove('reduced-motion');
            }
        });
    }

    createKeyboardShortcutHelp() {
        const shortcuts = [
            { keys: 'Alt + 1', action: 'Switch to Single Place tab' },
            { keys: 'Alt + 2', action: 'Switch to Adventure Builder tab' },
            { keys: 'Alt + 3', action: 'Switch to My Adventures tab' },
            { keys: 'Alt + R', action: 'Find random place' },
            { keys: 'Ctrl/Cmd + Shift + D', action: 'Toggle dark mode' },
            { keys: 'Escape', action: 'Close modals or cancel actions' },
            { keys: '?', action: 'Show this help' },
            { keys: 'Tab', action: 'Navigate between elements' },
            { keys: 'Enter/Space', action: 'Activate buttons and links' },
            { keys: 'Arrow keys', action: 'Navigate tabs and lists' }
        ];

        this.keyboardShortcuts = shortcuts;
    }

    showKeyboardShortcuts() {
        const modal = document.createElement('div');
        modal.className = 'shortcuts-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-labelledby', 'shortcuts-title');
        modal.setAttribute('aria-modal', 'true');
        
        modal.innerHTML = `
            <div class="shortcuts-modal-content">
                <div class="shortcuts-modal-header">
                    <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
                    <button class="shortcuts-modal-close" aria-label="Close shortcuts help">×</button>
                </div>
                <div class="shortcuts-modal-body">
                    <table class="shortcuts-table">
                        <thead>
                            <tr>
                                <th>Keys</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.keyboardShortcuts.map(shortcut => `
                                <tr>
                                    <td><kbd>${shortcut.keys}</kbd></td>
                                    <td>${shortcut.action}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Focus management
        const closeBtn = modal.querySelector('.shortcuts-modal-close');
        closeBtn.focus();

        // Event listeners
        closeBtn.addEventListener('click', () => {
            this.closeModal(modal);
        });

        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal(modal);
            }
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeModal(modal);
            }
        });

        this.trapFocus(modal);
        this.announceToScreenReader('Keyboard shortcuts help opened');
    }

    closeModal(modal) {
        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
            this.releaseFocusTrap();
            this.announceToScreenReader('Modal closed');
        }
    }

    trapFocus(container) {
        const focusableElements = container.querySelectorAll(
            'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
        );
        
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        this.focusTrap = (e) => {
            if (e.key === 'Tab') {
                if (e.shiftKey) {
                    if (document.activeElement === firstElement) {
                        e.preventDefault();
                        lastElement.focus();
                    }
                } else {
                    if (document.activeElement === lastElement) {
                        e.preventDefault();
                        firstElement.focus();
                    }
                }
            }
        };

        document.addEventListener('keydown', this.focusTrap);
    }

    releaseFocusTrap() {
        if (this.focusTrap) {
            document.removeEventListener('keydown', this.focusTrap);
            this.focusTrap = null;
        }
    }

    handleEscape() {
        // Close any open modals or overlays
        const modals = document.querySelectorAll('.share-modal, .shortcuts-modal, .install-prompt');
        modals.forEach(modal => {
            if (modal.style.display !== 'none' && !modal.classList.contains('hidden')) {
                this.closeModal(modal);
            }
        });
    }

    switchToTab(tabName) {
        if (window.adventurePlanner) {
            window.adventurePlanner.switchTab(tabName);
            document.dispatchEvent(new CustomEvent('tabSwitched', {
                detail: { tabName }
            }));
        }
    }

    // Public API
    getAccessibilityStatus() {
        return {
            highContrast: this.isHighContrast,
            reducedMotion: document.documentElement.classList.contains('reduced-motion'),
            screenReaderDetected: this.detectScreenReader(),
            keyboardNavigation: true
        };
    }

    detectScreenReader() {
        // Basic screen reader detection
        return window.speechSynthesis !== undefined ||
               window.navigator.userAgent.includes('NVDA') ||
               window.navigator.userAgent.includes('JAWS') ||
               window.navigator.userAgent.includes('VoiceOver');
    }
}

// Add accessibility styles
const accessibilityStyles = document.createElement('style');
accessibilityStyles.textContent = `
    .high-contrast {
        --bg-primary: linear-gradient(135deg, #000000 0%, #1a1a1a 100%) !important;
        --bg-secondary: #000000 !important;
        --bg-card: #1a1a1a !important;
        --text-primary: #ffffff !important;
        --text-secondary: #ffff00 !important;
        --text-light: #cccccc !important;
        --border-color: #ffff00 !important;
    }

    .high-contrast .primary-btn {
        background: #ffff00 !important;
        color: #000000 !important;
        border: 2px solid #ffffff !important;
    }

    .high-contrast .secondary-btn {
        background: #000000 !important;
        color: #ffff00 !important;
        border: 2px solid #ffff00 !important;
    }

    .reduced-motion *,
    .reduced-motion *::before,
    .reduced-motion *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }

    .accessibility-toggle {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        padding: 8px 12px;
        border-radius: 20px;
        cursor: pointer;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
        margin-left: 10px;
        color: inherit;
    }

    .accessibility-toggle:hover {
        background: rgba(255, 255, 255, 0.3);
    }

    .shortcuts-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
    }

    .shortcuts-modal-content {
        background: var(--bg-card);
        border-radius: 15px;
        width: 90%;
        max-width: 600px;
        max-height: 80vh;
        overflow-y: auto;
    }

    .shortcuts-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid var(--border-color);
    }

    .shortcuts-modal-header h2 {
        margin: 0;
        color: var(--text-primary);
    }

    .shortcuts-modal-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: var(--text-secondary);
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
    }

    .shortcuts-modal-close:hover {
        background: var(--border-color);
    }

    .shortcuts-modal-body {
        padding: 20px;
    }

    .shortcuts-table {
        width: 100%;
        border-collapse: collapse;
    }

    .shortcuts-table th,
    .shortcuts-table td {
        padding: 12px;
        text-align: left;
        border-bottom: 1px solid var(--border-color);
        color: var(--text-primary);
    }

    .shortcuts-table th {
        background: var(--bg-secondary);
        font-weight: 600;
    }

    .shortcuts-table kbd {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        padding: 4px 8px;
        font-family: monospace;
        font-size: 0.9em;
    }

    .required-indicator {
        color: #dc3545;
        font-weight: bold;
    }

    @media (max-width: 768px) {
        .shortcuts-modal-content {
            width: 95%;
            margin: 10px;
        }
        
        .shortcuts-table {
            font-size: 14px;
        }
        
        .shortcuts-table th,
        .shortcuts-table td {
            padding: 8px;
        }
    }
`;
document.head.appendChild(accessibilityStyles);

// Initialize accessibility manager
document.addEventListener('DOMContentLoaded', () => {
    window.accessibilityManager = new AccessibilityManager();
    
    // Load stored preferences
    if (localStorage.getItem('highContrast') === 'true') {
        window.accessibilityManager.enableHighContrast();
    }
});