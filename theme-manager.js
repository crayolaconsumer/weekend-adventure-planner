class ThemeManager {
    constructor() {
        this.currentTheme = this.getStoredTheme();
        this.themeInterval = null;
        this.init();
    }

    init() {
        // Apply stored theme
        this.applyTheme(this.currentTheme);
        
        // Setup toggle button
        this.setupToggleButton();
        
        // Listen for system theme changes
        this.listenForSystemThemeChanges();
        
        // Update theme icon
        this.updateThemeIcon();
    }

    getStoredTheme() {
        // Check localStorage first
        const stored = localStorage.getItem('theme');
        if (stored) {
            return stored;
        }
        
        // Fall back to system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        
        return 'light';
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        this.currentTheme = theme;
        
        // Update meta theme-color for mobile browsers
        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
            themeColorMeta.content = theme === 'dark' ? '#1a1a2e' : '#667eea';
        }
        
        // Store preference
        localStorage.setItem('theme', theme);
        
        // Trigger custom event for other components
        window.dispatchEvent(new CustomEvent('themechange', { 
            detail: { theme } 
        }));
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
        this.updateThemeIcon();
        
        // Subtle transition only (no overlay ripple)
        this.addTransitionEffect();
        
        // Show feedback toast
        this.showThemeToast(newTheme);
    }

    setupToggleButton() {
        const toggleCheckbox = document.getElementById('dark-mode-toggle');
        if (toggleCheckbox) {
            // Set initial state
            toggleCheckbox.checked = this.currentTheme === 'dark';
            
            toggleCheckbox.addEventListener('change', () => {
                this.toggleTheme();
            });
        }
    }

    updateThemeIcon() {
        const toggleCheckbox = document.getElementById('dark-mode-toggle');
        if (toggleCheckbox) {
            toggleCheckbox.checked = this.currentTheme === 'dark';
        }
    }

    listenForSystemThemeChanges() {
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            mediaQuery.addEventListener('change', (e) => {
                // Only auto-switch if user hasn't manually set a preference
                if (!localStorage.getItem('theme')) {
                    const newTheme = e.matches ? 'dark' : 'light';
                    this.applyTheme(newTheme);
                    this.updateThemeIcon();
                }
            });
        }
    }

    addTransitionEffect() {
        // Respect reduced motion and avoid any overlays
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        // Apply a short, global color transition; no extra DOM elements
        const root = document.documentElement;
        const previous = root.style.transition;
        root.style.transition = 'background-color 200ms ease, color 200ms ease';
        // Revert after transition ends
        setTimeout(() => { root.style.transition = previous || ''; }, 220);
    }

    showThemeToast(theme) {
        if (window.pwaManager) {
            const message = theme === 'dark' ? '🌙 Dark mode activated' : '☀️ Light mode activated';
            window.pwaManager.showToast(message, 'info');
        }
    }

    // Advanced theme features
    scheduleAutoTheme() {
        // Auto-switch based on time of day
        const now = new Date();
        const hour = now.getHours();
        
        // Switch to dark mode in the evening (7 PM to 7 AM)
        const shouldBeDark = hour >= 19 || hour <= 7;
        const preferredTheme = shouldBeDark ? 'dark' : 'light';
        
        if (this.currentTheme !== preferredTheme) {
            this.applyTheme(preferredTheme);
            this.updateThemeIcon();
            
            const timeMessage = shouldBeDark ? 'Evening mode activated' : 'Morning mode activated';
            if (window.pwaManager) {
                window.pwaManager.showToast(`🕐 ${timeMessage}`, 'info');
            }
        }
    }

    enableAutoThemeScheduling() {
        // Clear existing interval
        if (this.themeInterval) {
            clearInterval(this.themeInterval);
        }
        
        // Check every hour for auto theme switching
        this.themeInterval = setInterval(() => {
            this.scheduleAutoTheme();
        }, 60 * 60 * 1000); // 1 hour
        
        // Check immediately
        this.scheduleAutoTheme();
    }

    getThemeColor(colorName) {
        // Get CSS custom property value for current theme
        const computedStyle = getComputedStyle(document.documentElement);
        return computedStyle.getPropertyValue(`--${colorName}`).trim();
    }

    // Theme-specific configurations
    getMapStyle() {
        // Return different map styles based on theme
        return this.currentTheme === 'dark' ? {
            filter: 'invert(1) hue-rotate(180deg)',
            brightness: '0.8'
        } : {
            filter: 'none',
            brightness: '1'
        };
    }

    adaptImageBrightness(img) {
        // Adjust image brightness for dark mode
        if (this.currentTheme === 'dark') {
            img.style.filter = 'brightness(0.8) contrast(1.1)';
        } else {
            img.style.filter = 'none';
        }
    }

    // Export theme preferences
    exportThemeSettings() {
        return {
            theme: this.currentTheme,
            autoSchedule: localStorage.getItem('autoThemeSchedule') === 'true',
            lastChanged: localStorage.getItem('themeLastChanged')
        };
    }

    importThemeSettings(settings) {
        if (settings.theme) {
            this.applyTheme(settings.theme);
            this.updateThemeIcon();
        }
        
        if (settings.autoSchedule) {
            localStorage.setItem('autoThemeSchedule', 'true');
            this.enableAutoThemeScheduling();
        }
    }
}

// Add theme-aware utilities
window.getThemeAwareColor = function(lightColor, darkColor) {
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'dark' ? darkColor : lightColor;
};

window.isThemeDark = function() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
};

// Initialize theme manager
document.addEventListener('DOMContentLoaded', () => {
    window.themeManager = new ThemeManager();
    
    // Add keyboard shortcut for theme toggle (Ctrl/Cmd + Shift + D)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            window.themeManager.toggleTheme();
        }
    });
    
    // Listen for theme changes to update other components
    window.addEventListener('themechange', (e) => {
        // Update any theme-dependent images
        document.querySelectorAll('img').forEach(img => {
            window.themeManager.adaptImageBrightness(img);
        });
        
        // Update charts or visualizations if any exist
        if (window.updateChartsForTheme) {
            window.updateChartsForTheme(e.detail.theme);
        }
    });
});

// Add cleanup method to ThemeManager prototype
ThemeManager.prototype.destroy = function() {
    if (this.themeInterval) {
        clearInterval(this.themeInterval);
        this.themeInterval = null;
    }
};