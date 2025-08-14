class GestureManager {
    constructor() {
        this.isEnabled = 'ontouchstart' in window; // Only enable on touch devices
        this.activeTab = 'single';
        this.tabs = ['single', 'adventure', 'history'];
        this.swipeThreshold = 80; // Minimum distance for swipe (less sensitive)
        this.swipeTimeout = 280; // Maximum time for swipe
        this.touchStart = null;
        this.touchEnd = null;
        this.init();
    }

    init() {
        if (!this.isEnabled) return;
        
        this.setupSwipeNavigation();
        this.setupPullToRefresh();
        this.setupDoubleTapActions();
        this.setupLongPressActions();
        this.addGestureIndicators();
    }

    setupSwipeNavigation() {
        const tabsContainer = document.querySelector('.tabs');
        const contentContainer = document.querySelector('.controls');
        
        if (!tabsContainer || !contentContainer) return;

        // Add swipe listeners to content area
        contentContainer.addEventListener('touchstart', (e) => {
            // Ignore gestures that start inside horizontally scrollable or form controls
            const ignore = e.target.closest('.quick-filters, select, input, textarea');
            if (ignore) return;
            this.handleSwipeStart(e);
        }, { passive: true });

        contentContainer.addEventListener('touchmove', (e) => {
            const ignore = e.target.closest('.quick-filters, select, input, textarea');
            if (ignore) return;
            this.handleSwipeMove(e);
        }, { passive: true });

        contentContainer.addEventListener('touchend', (e) => {
            const ignore = e.target.closest('.quick-filters, select, input, textarea');
            if (ignore) return;
            this.handleSwipeEnd(e);
        }, { passive: true });

        // Add visual feedback for swipes (reuse existing element if present)
        this.createSwipeIndicator();

        // Keep active tab in sync when tabs change elsewhere
        document.addEventListener('tabSwitched', (e) => {
            if (e.detail?.tabName) {
                this.activeTab = e.detail.tabName;
            }
        });
    }

    handleSwipeStart(e) {
        this.touchStart = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            time: Date.now()
        };
        this.hideSwipeIndicator();
    }

    handleSwipeMove(e) {
        if (!this.touchStart) return;

        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const diffX = this.touchStart.x - currentX;
        const diffY = this.touchStart.y - currentY;

        // Only handle horizontal swipes (ignore vertical scrolling)
        // Require stronger horizontal intent to avoid vertical scroll collisions
        if (Math.abs(diffX) > Math.abs(diffY) * 1.5 && Math.abs(diffX) > 30) {
            this.showSwipeIndicator(diffX > 0 ? 'left' : 'right');
        }
    }

    handleSwipeEnd(e) {
        if (!this.touchStart) return;

        this.touchEnd = {
            x: e.changedTouches[0].clientX,
            y: e.changedTouches[0].clientY,
            time: Date.now()
        };

        const swipeTime = this.touchEnd.time - this.touchStart.time;
        const swipeDistanceX = this.touchStart.x - this.touchEnd.x;
        const swipeDistanceY = this.touchStart.y - this.touchEnd.y;

        // Check if it's a valid swipe (horizontal, fast enough, long enough)
        if (Math.abs(swipeDistanceX) > this.swipeThreshold &&
            Math.abs(swipeDistanceX) > Math.abs(swipeDistanceY) * 1.5 &&
            swipeTime < this.swipeTimeout) {
            
            if (swipeDistanceX > 0) {
                this.swipeLeft();
            } else {
                this.swipeRight();
            }
        }

        this.hideSwipeIndicator();
        this.touchStart = null;
        this.touchEnd = null;
    }

    swipeLeft() {
        // Swipe left = next tab
        const currentIndex = this.tabs.indexOf(this.activeTab);
        if (currentIndex < this.tabs.length - 1) {
            const nextTab = this.tabs[currentIndex + 1];
            this.switchToTab(nextTab);
            this.showSwipeToast('➡️');
        }
    }

    swipeRight() {
        // Swipe right = previous tab
        const currentIndex = this.tabs.indexOf(this.activeTab);
        if (currentIndex > 0) {
            const prevTab = this.tabs[currentIndex - 1];
            this.switchToTab(prevTab);
            this.showSwipeToast('⬅️');
        }
    }

    switchToTab(tabName) {
        this.activeTab = tabName;
        if (window.adventurePlanner) {
            window.adventurePlanner.switchTab(tabName);
        }
    }

    createSwipeIndicator() {
        // Reuse pre-rendered indicator in HTML if available
        if (document.getElementById('swipe-indicator')) return;
        const indicator = document.createElement('div');
        indicator.id = 'swipe-indicator';
        indicator.className = 'swipe-indicator hidden';
        indicator.innerHTML = '<div class="swipe-arrow"></div>';
        document.body.appendChild(indicator);
    }

    showSwipeIndicator(direction) {
        const indicator = document.getElementById('swipe-indicator');
        if (!indicator) return;

        indicator.classList.remove('hidden');
        indicator.className = `swipe-indicator swipe-${direction} show`;
        indicator.style.opacity = '0.7';

        const arrow = indicator.querySelector('.swipe-arrow');
        if (arrow) {
            arrow.textContent = direction === 'left' ? '→' : '←';
        } else {
            const text = indicator.querySelector('.swipe-text');
            if (text) {
                text.textContent = direction === 'left' ? 'Swipe left' : 'Swipe right';
            }
        }
    }

    hideSwipeIndicator() {
        const indicator = document.getElementById('swipe-indicator');
        if (indicator) {
            indicator.style.opacity = '0';
            setTimeout(() => {
                indicator.className = 'swipe-indicator hidden';
            }, 200);
        }
    }

    showSwipeToast(arrow) {
        if (window.pwaManager) {
            window.pwaManager.showToast(`${arrow} Switched tabs`, 'info');
        }
    }

    setupPullToRefresh() {
        let pullStart = null;
        let pullDistance = 0;
        const threshold = 100;

        document.addEventListener('touchstart', (e) => {
            if (window.scrollY === 0) {
                pullStart = e.touches[0].clientY;
            }
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (pullStart !== null) {
                pullDistance = e.touches[0].clientY - pullStart;
                
                if (pullDistance > 30) {
                    this.showPullToRefreshIndicator(Math.min(pullDistance / threshold, 1));
                }
            }
        }, { passive: true });

        document.addEventListener('touchend', () => {
            if (pullDistance > threshold) {
                this.performRefresh();
            }
            this.hidePullToRefreshIndicator();
            pullStart = null;
            pullDistance = 0;
        }, { passive: true });
    }

    showPullToRefreshIndicator(progress) {
        const indicator = document.getElementById('pull-refresh-indicator');
        if (!indicator) return;

        // Use existing HTML structure
        if (progress > 0.3) {
            indicator.classList.add('show');
        } else {
            indicator.classList.remove('show');
        }
        
        const spinner = indicator.querySelector('.refresh-spinner');
        if (spinner && progress > 0.3) {
            spinner.style.animation = 'spin 1s linear infinite';
        }
        
        const text = indicator.querySelector('.refresh-text');
        if (text) {
            if (progress >= 1) {
                text.textContent = 'Release to refresh';
            } else {
                text.textContent = 'Pull to refresh';
            }
        }
    }

    hidePullToRefreshIndicator() {
        const indicator = document.getElementById('pull-refresh-indicator');
        if (indicator) {
            indicator.style.transform = 'translateY(-60px)';
            indicator.style.opacity = '0';
        }
    }

    performRefresh() {
        if (window.pwaManager) {
            window.pwaManager.showToast('🔄 Refreshing...', 'info');
        }

        // Refresh current tab content
        if (this.activeTab === 'single' && window.randomPlacesFinder?.currentLocation) {
            window.weatherManager?.updateWeatherForAdventure(window.randomPlacesFinder.currentLocation);
        } else if (this.activeTab === 'history' && window.adventurePlanner) {
            window.adventurePlanner.loadAdventureHistory();
        }

        // Vibrate if supported
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }
    }

    setupDoubleTapActions() {
        let lastTap = 0;
        
        document.addEventListener('touchend', (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;
            
            if (tapLength < 500 && tapLength > 0) {
                // Double tap detected
                this.handleDoubleTap(e);
            }
            lastTap = currentTime;
        });
    }

    handleDoubleTap(e) {
        const target = e.target.closest('.place-card, .adventure-stop, .history-item');
        
        if (target) {
            // Double tap on place card to mark as favorite
            this.doubleTapAction(target);
        } else {
            // Double tap on empty area to find random place
            if (this.activeTab === 'single') {
                const surpriseBtn = document.getElementById('surprise-me');
                if (surpriseBtn) {
                    surpriseBtn.click();
                    this.showGestureToast('🎯 Double tap = Random place!');
                }
            }
        }
    }

    doubleTapAction(element) {
        // Add favorite class with animation
        element.classList.add('double-tap-favorite');
        
        // Vibrate
        if (navigator.vibrate) {
            navigator.vibrate([50, 100, 50]);
        }
        
        this.showGestureToast('❤️ Double tap action!');
        
        // Remove animation class after animation
        setTimeout(() => {
            element.classList.remove('double-tap-favorite');
        }, 600);
    }

    setupLongPressActions() {
        let pressTimer = null;
        let isLongPress = false;

        document.addEventListener('touchstart', (e) => {
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                this.handleLongPress(e);
            }, 800); // 800ms for long press
        });

        document.addEventListener('touchend', () => {
            clearTimeout(pressTimer);
        });

        document.addEventListener('touchmove', () => {
            clearTimeout(pressTimer);
        });
    }

    handleLongPress(e) {
        const target = e.target.closest('.place-card');
        
        if (target) {
            // Long press on place card to share
            this.longPressShare(target);
        } else if (e.target.closest('.dark-mode-toggle')) {
            // Long press on theme toggle for auto-schedule
            this.longPressThemeOptions();
        }
    }

    longPressShare(placeCard) {
        if (navigator.vibrate) {
            navigator.vibrate(100);
        }
        
        // Share current place
        if (window.randomPlacesFinder?.currentPlace && window.pwaManager) {
            const place = window.randomPlacesFinder.currentPlace;
            window.pwaManager.shareAdventure({
                places: [place],
                type: 'single_place'
            });
        }
        
        this.showGestureToast('🔗 Long press = Share!');
    }

    longPressThemeOptions() {
        if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]);
        }
        
        // Toggle auto theme scheduling
        const autoSchedule = localStorage.getItem('autoThemeSchedule') !== 'true';
        localStorage.setItem('autoThemeSchedule', autoSchedule.toString());
        
        if (autoSchedule && window.themeManager) {
            window.themeManager.enableAutoThemeScheduling();
            this.showGestureToast('🕐 Auto theme scheduling enabled!');
        } else {
            this.showGestureToast('🕐 Auto theme scheduling disabled!');
        }
    }

    addGestureIndicators() {
        // Add subtle gesture hints for first-time users
        const firstVisit = !localStorage.getItem('gesturesIntroduced');
        
        if (firstVisit) {
            setTimeout(() => {
                this.showGestureIntro();
                localStorage.setItem('gesturesIntroduced', 'true');
            }, 3000);
        }
    }

    showGestureIntro() {
        if (window.pwaManager) {
            window.pwaManager.showToast('💡 Tip: Swipe left/right to switch tabs!', 'info');
            
            setTimeout(() => {
                window.pwaManager.showToast('💡 Double tap for quick actions!', 'info');
            }, 3000);
        }
    }

    showGestureToast(message) {
        if (window.pwaManager) {
            window.pwaManager.showToast(message, 'info');
        }
    }

    // Public API for other components
    enableGestures() {
        this.isEnabled = true;
        this.init();
    }

    disableGestures() {
        this.isEnabled = false;
        // Remove event listeners would go here
    }

    getCurrentTab() {
        return this.activeTab;
    }

    setActiveTab(tabName) {
        if (this.tabs.includes(tabName)) {
            this.activeTab = tabName;
        }
    }
}

// Add gesture styles
const gestureStyles = document.createElement('style');
gestureStyles.textContent = `
    .swipe-indicator {
        position: fixed;
        top: 50%;
        right: 20px;
        transform: translateY(-50%);
        background: rgba(102, 126, 234, 0.8);
        color: white;
        padding: 10px;
        border-radius: 50%;
        font-size: 20px;
        opacity: 0;
        transition: opacity 0.2s ease;
        z-index: 1000;
        pointer-events: none;
    }

    .swipe-indicator.swipe-left {
        right: 20px;
    }

    .swipe-indicator.swipe-right {
        left: 20px;
        right: auto;
    }

    .pull-refresh-indicator {
        position: fixed;
        top: 0;
        left: 50%;
        transform: translateX(-50%) translateY(-60px);
        background: rgba(102, 126, 234, 0.9);
        color: white;
        padding: 10px 20px;
        border-radius: 0 0 10px 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 14px;
        z-index: 1000;
        opacity: 0;
        transition: all 0.2s ease;
        pointer-events: none;
    }

    .refresh-icon {
        font-size: 16px;
        transition: transform 0.2s ease;
    }

    .double-tap-favorite {
        animation: doubleTapPulse 0.6s ease;
    }

    @keyframes doubleTapPulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.05); box-shadow: 0 0 20px rgba(255, 107, 107, 0.5); }
        100% { transform: scale(1); }
    }

    /* Add touch feedback for interactive elements */
    .tab-btn:active,
    .primary-btn:active,
    .secondary-btn:active {
        transform: scale(0.95);
    }

    .place-card:active {
        transform: scale(0.98);
    }

    /* Disable text selection for gesture areas */
    .controls {
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
    }

    /* Better touch targets */
    .tab-btn,
    .primary-btn,
    .secondary-btn,
    .dark-mode-toggle {
        min-height: 44px;
        min-width: 44px;
    }

    @media (max-width: 768px) {
        .swipe-indicator {
            font-size: 16px;
            padding: 8px;
        }
        
        .pull-refresh-indicator {
            font-size: 12px;
            padding: 8px 16px;
        }
    }
`;
document.head.appendChild(gestureStyles);

// Initialize gesture manager
document.addEventListener('DOMContentLoaded', () => {
    window.gestureManager = new GestureManager();
});