class AnimationsManager {
    constructor() {
        this.isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.animations = new Map();
        this.observers = new Map();
        this.init();
    }

    init() {
        this.setupIntersectionObserver();
        this.addMicroInteractions();
        this.addLoadingAnimations();
        this.addSuccessAnimations();
        this.addTransitionEffects();
        this.addParticleEffects();
        this.setupMotionPreferences();
    }

    setupMotionPreferences() {
        // Listen for motion preference changes
        window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
            this.isReducedMotion = e.matches;
            this.updateAnimationStyles();
        });
    }

    updateAnimationStyles() {
        if (this.isReducedMotion) {
            document.documentElement.classList.add('reduced-motion');
        } else {
            document.documentElement.classList.remove('reduced-motion');
        }
    }

    setupIntersectionObserver() {
        // Animate elements as they come into view
        this.intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.animateIn(entry.target);
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '50px'
        });

        // Observe elements that should animate in
        this.observeAnimatableElements();
    }

    observeAnimatableElements() {
        // Add animation classes to elements that should animate in
        const animatableSelectors = [
            '.place-card',
            '.adventure-stop',
            '.history-item',
            '.recommendation-item',
            '.stat-item'
        ];

        animatableSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(element => {
                element.classList.add('animate-on-scroll');
                this.intersectionObserver.observe(element);
            });
        });

        // Re-observe new elements
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        animatableSelectors.forEach(selector => {
                            if (node.matches && node.matches(selector)) {
                                node.classList.add('animate-on-scroll');
                                this.intersectionObserver.observe(node);
                            }
                            node.querySelectorAll?.(selector).forEach(child => {
                                child.classList.add('animate-on-scroll');
                                this.intersectionObserver.observe(child);
                            });
                        });
                    }
                });
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    animateIn(element) {
        if (this.isReducedMotion) {
            element.style.opacity = '1';
            return;
        }

        element.classList.add('animate-in');
        
        // Add stagger delay for multiple elements
        const siblings = Array.from(element.parentNode.children).filter(el => 
            el.classList.contains('animate-on-scroll')
        );
        const index = siblings.indexOf(element);
        
        if (index > 0) {
            element.style.animationDelay = `${index * 0.1}s`;
        }
    }

    addMicroInteractions() {
        this.addButtonHoverEffects();
        this.addClickFeedback();
        this.addFocusEffects();
        this.addLoadingStates();
    }

    addButtonHoverEffects() {
        // Skip hover effects on coarse pointers (touch devices)
        const isCoarse = window.matchMedia('(pointer: coarse)').matches;
        if (isCoarse) return;
        document.addEventListener('mouseover', (e) => {
            if (e.target.matches('button, .btn, .primary-btn, .secondary-btn')) {
                this.animateButtonHover(e.target, true);
            }
        });

        document.addEventListener('mouseout', (e) => {
            if (e.target.matches('button, .btn, .primary-btn, .secondary-btn')) {
                this.animateButtonHover(e.target, false);
            }
        });
    }

    animateButtonHover(button, isHover) {
        if (this.isReducedMotion) return;

        if (isHover) {
            button.style.transform = 'translateY(-2px) scale(1.02)';
            button.style.boxShadow = '0 8px 25px rgba(102, 126, 234, 0.3)';
            this.addRippleEffect(button);
        } else {
            button.style.transform = '';
            button.style.boxShadow = '';
        }
    }

    addRippleEffect(element) {
        // Avoid ripple on small/compact controls to prevent layout glitches
        if (element.matches('.chip-btn, .filter-btn, .tab-btn, .dark-mode-toggle, .accessibility-toggle')) return;
        const ripple = document.createElement('span');
        ripple.className = 'ripple-effect';
        
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        
        ripple.style.cssText = `
            position: absolute;
            width: ${size}px;
            height: ${size}px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.3);
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0);
            animation: ripple 0.6s ease-out;
            pointer-events: none;
        `;

        element.style.position = 'relative';
        element.style.overflow = 'hidden';
        element.appendChild(ripple);

        setTimeout(() => {
            if (ripple.parentNode) {
                ripple.parentNode.removeChild(ripple);
            }
        }, 600);
    }

    addClickFeedback() {
        document.addEventListener('click', (e) => {
            if (e.target.matches('button, .clickable, .tab-btn')) {
                this.animateClick(e.target);
            }
        });
    }

    animateClick(element) {
        if (this.isReducedMotion) return;
        // Avoid scale bounce on compact buttons
        if (element.matches('.chip-btn, .filter-btn, .tab-btn, .dark-mode-toggle, .accessibility-toggle')) return;

        element.style.transform = 'scale(0.95)';
        
        setTimeout(() => {
            element.style.transform = '';
        }, 150);

        // Add success pulse for certain actions
        if (element.id === 'mark-visited' || element.classList.contains('success-action')) {
            this.addSuccessPulse(element);
        }
    }

    addSuccessPulse(element) {
        const pulse = document.createElement('div');
        pulse.className = 'success-pulse';
        pulse.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            width: 100%;
            height: 100%;
            border: 2px solid #10b981;
            border-radius: inherit;
            transform: translate(-50%, -50%) scale(1);
            animation: successPulse 0.8s ease-out;
            pointer-events: none;
        `;

        element.style.position = 'relative';
        element.appendChild(pulse);

        setTimeout(() => {
            if (pulse.parentNode) {
                pulse.parentNode.removeChild(pulse);
            }
        }, 800);
    }

    addFocusEffects() {
        document.addEventListener('focusin', (e) => {
            if (e.target.matches('input, select, textarea, button')) {
                this.animateFocus(e.target, true);
            }
        });

        document.addEventListener('focusout', (e) => {
            if (e.target.matches('input, select, textarea, button')) {
                this.animateFocus(e.target, false);
            }
        });
    }

    animateFocus(element, isFocused) {
        if (this.isReducedMotion) return;

        if (isFocused) {
            element.style.transform = 'scale(1.02)';
            element.style.transition = 'all 0.2s ease';
        } else {
            element.style.transform = '';
        }
    }

    addLoadingStates() {
        // Enhance loading animations
        document.addEventListener('loadingStart', (e) => {
            this.showLoadingAnimation(e.detail.element);
        });

        document.addEventListener('loadingEnd', (e) => {
            this.hideLoadingAnimation(e.detail.element);
        });
    }

    showLoadingAnimation(element) {
        if (!element) return;

        const loader = document.createElement('div');
        loader.className = 'loading-overlay';
        loader.innerHTML = `
            <div class="loading-spinner">
                <div class="loading-dot"></div>
                <div class="loading-dot"></div>
                <div class="loading-dot"></div>
            </div>
        `;

        element.style.position = 'relative';
        element.appendChild(loader);
    }

    hideLoadingAnimation(element) {
        if (!element) return;

        const loader = element.querySelector('.loading-overlay');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => {
                if (loader.parentNode) {
                    loader.parentNode.removeChild(loader);
                }
            }, 300);
        }
    }

    addLoadingAnimations() {
        // Custom loading animations for different states
        this.addSkeletonLoaders();
        this.addProgressAnimations();
    }

    addSkeletonLoaders() {
        // Add skeleton loaders for content that's loading
        const createSkeleton = (width = '100%', height = '20px') => {
            const skeleton = document.createElement('div');
            skeleton.className = 'skeleton-loader';
            skeleton.style.cssText = `
                width: ${width};
                height: ${height};
                background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
                background-size: 200% 100%;
                animation: skeleton-loading 1.5s infinite;
                border-radius: 4px;
            `;
            return skeleton;
        };

        // Use skeletons when content is loading
        this.createSkeleton = createSkeleton;
    }

    addProgressAnimations() {
        // Animated progress indicators
        this.createProgressRing = (progress) => {
            const ring = document.createElement('div');
            ring.className = 'progress-ring';
            ring.innerHTML = `
                <svg width="40" height="40">
                    <circle cx="20" cy="20" r="15" fill="transparent" 
                            stroke="#e0e0e0" stroke-width="2"/>
                    <circle cx="20" cy="20" r="15" fill="transparent" 
                            stroke="#667eea" stroke-width="2"
                            stroke-dasharray="${2 * Math.PI * 15}"
                            stroke-dashoffset="${2 * Math.PI * 15 * (1 - progress)}"
                            transform="rotate(-90 20 20)"
                            style="transition: stroke-dashoffset 0.5s ease;"/>
                </svg>
                <span class="progress-text">${Math.round(progress * 100)}%</span>
            `;
            return ring;
        };
    }

    addSuccessAnimations() {
        // Success checkmark animation
        this.showSuccessCheckmark = (element) => {
            const checkmark = document.createElement('div');
            checkmark.className = 'success-checkmark';
            checkmark.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24">
                    <path d="M9 12l2 2 4-4" stroke="#10b981" stroke-width="2" 
                          fill="none" stroke-linecap="round" stroke-linejoin="round"
                          stroke-dasharray="6" stroke-dashoffset="6"
                          style="animation: checkmark 0.6s ease-in-out forwards;"/>
                </svg>
            `;

            element.appendChild(checkmark);

            setTimeout(() => {
                if (checkmark.parentNode) {
                    checkmark.style.opacity = '0';
                    setTimeout(() => {
                        if (checkmark.parentNode) {
                            checkmark.parentNode.removeChild(checkmark);
                        }
                    }, 300);
                }
            }, 2000);
        };

        // Confetti animation for major achievements
        this.showConfetti = () => {
            if (this.isReducedMotion) return;

            for (let i = 0; i < 50; i++) {
                setTimeout(() => {
                    this.createConfettiPiece();
                }, i * 20);
            }
        };
    }

    createConfettiPiece() {
        const confetti = document.createElement('div');
        confetti.className = 'confetti-piece';
        
        const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        confetti.style.cssText = `
            position: fixed;
            width: 8px;
            height: 8px;
            background: ${color};
            top: -10px;
            left: ${Math.random() * 100}vw;
            z-index: 10000;
            animation: confetti-fall ${2 + Math.random() * 3}s linear forwards;
            transform: rotate(${Math.random() * 360}deg);
            pointer-events: none;
        `;

        document.body.appendChild(confetti);

        setTimeout(() => {
            if (confetti.parentNode) {
                confetti.parentNode.removeChild(confetti);
            }
        }, 5000);
    }

    addTransitionEffects() {
        // Page transition effects
        this.addPageTransitions();
        this.addModalTransitions();
        this.addTabTransitions();
    }

    addPageTransitions() {
        // Smooth page transitions
        document.addEventListener('beforeunload', () => {
            document.body.style.opacity = '0';
        });

        window.addEventListener('pageshow', () => {
            document.body.style.opacity = '1';
        });
    }

    addModalTransitions() {
        // Enhanced modal animations
        const originalCreateElement = document.createElement;
        
        // Override createElement to add animations to modals
        document.createElement = function(tagName) {
            const element = originalCreateElement.call(this, tagName);
            
            if (tagName === 'div' && element.className?.includes('modal')) {
                element.style.opacity = '0';
                element.style.transform = 'scale(0.9) translateY(-20px)';
                
                setTimeout(() => {
                    element.style.transition = 'all 0.3s ease';
                    element.style.opacity = '1';
                    element.style.transform = 'scale(1) translateY(0)';
                }, 10);
            }
            
            return element;
        };
    }

    addTabTransitions() {
        // Smooth tab transitions
        document.addEventListener('tabSwitched', (e) => {
            this.animateTabSwitch(e.detail.tabName);
        });
    }

    animateTabSwitch(tabName) {
        if (this.isReducedMotion) return;

        const newPanel = document.getElementById(`${tabName}-mode`);
        if (newPanel) {
            newPanel.style.opacity = '0';
            newPanel.style.transform = 'translateX(20px)';
            
            setTimeout(() => {
                newPanel.style.transition = 'all 0.3s ease';
                newPanel.style.opacity = '1';
                newPanel.style.transform = 'translateX(0)';
            }, 50);
        }
    }

    addParticleEffects() {
        // Background particle effects for special moments
        this.createParticleSystem = () => {
            if (this.isReducedMotion) return;

            const canvas = document.createElement('canvas');
            canvas.id = 'particle-canvas';
            canvas.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: -1;
                opacity: 0.3;
            `;

            document.body.appendChild(canvas);
            
            const ctx = canvas.getContext('2d');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            const particles = [];
            
            for (let i = 0; i < 50; i++) {
                particles.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    vx: (Math.random() - 0.5) * 0.5,
                    vy: (Math.random() - 0.5) * 0.5,
                    size: Math.random() * 2 + 1,
                    opacity: Math.random() * 0.5 + 0.1
                });
            }

            const animate = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                particles.forEach(particle => {
                    particle.x += particle.vx;
                    particle.y += particle.vy;
                    
                    if (particle.x < 0) particle.x = canvas.width;
                    if (particle.x > canvas.width) particle.x = 0;
                    if (particle.y < 0) particle.y = canvas.height;
                    if (particle.y > canvas.height) particle.y = 0;
                    
                    ctx.globalAlpha = particle.opacity;
                    ctx.fillStyle = '#667eea';
                    ctx.beginPath();
                    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
                    ctx.fill();
                });
                
                requestAnimationFrame(animate);
            };
            
            animate();
        };
    }

    // Public API methods
    animateElement(element, animation, duration = 300) {
        if (this.isReducedMotion) return Promise.resolve();

        return new Promise((resolve) => {
            element.style.animation = `${animation} ${duration}ms ease`;
            
            const handleAnimationEnd = () => {
                element.style.animation = '';
                element.removeEventListener('animationend', handleAnimationEnd);
                resolve();
            };
            
            element.addEventListener('animationend', handleAnimationEnd);
        });
    }

    slideIn(element, direction = 'left') {
        if (this.isReducedMotion) {
            element.style.opacity = '1';
            return Promise.resolve();
        }

        const directions = {
            left: 'translateX(-100%)',
            right: 'translateX(100%)',
            up: 'translateY(-100%)',
            down: 'translateY(100%)'
        };

        element.style.transform = directions[direction];
        element.style.opacity = '0';
        element.style.transition = 'all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';

        return new Promise((resolve) => {
            requestAnimationFrame(() => {
                element.style.transform = 'translate(0, 0)';
                element.style.opacity = '1';
                
                setTimeout(resolve, 400);
            });
        });
    }

    bounceIn(element) {
        return this.animateElement(element, 'bounceIn', 600);
    }

    fadeIn(element, duration = 300) {
        if (this.isReducedMotion) {
            element.style.opacity = '1';
            return Promise.resolve();
        }

        element.style.opacity = '0';
        element.style.transition = `opacity ${duration}ms ease`;
        
        return new Promise((resolve) => {
            requestAnimationFrame(() => {
                element.style.opacity = '1';
                setTimeout(resolve, duration);
            });
        });
    }

    pulse(element, intensity = 1.1) {
        if (this.isReducedMotion) return Promise.resolve();

        return new Promise((resolve) => {
            element.style.transition = 'transform 0.15s ease';
            element.style.transform = `scale(${intensity})`;
            
            setTimeout(() => {
                element.style.transform = 'scale(1)';
                setTimeout(resolve, 150);
            }, 150);
        });
    }

    shake(element) {
        return this.animateElement(element, 'shake', 600);
    }

    // Cleanup method
    destroy() {
        this.intersectionObserver?.disconnect();
        this.observers.forEach(observer => observer.disconnect());
        this.animations.forEach(animation => animation.cancel?.());
    }
}

// Add comprehensive animation styles
const animationStyles = document.createElement('style');
animationStyles.textContent = `
    /* Base animation classes */
    .animate-on-scroll {
        opacity: 0;
        transform: translateY(20px);
        transition: all 0.6s ease;
    }

    .animate-in {
        opacity: 1 !important;
        transform: translateY(0) !important;
    }

    /* Keyframe animations */
    @keyframes ripple {
        to {
            transform: translate(-50%, -50%) scale(2);
            opacity: 0;
        }
    }

    @keyframes successPulse {
        0% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
        }
        100% {
            transform: translate(-50%, -50%) scale(1.5);
            opacity: 0;
        }
    }

    @keyframes skeleton-loading {
        0% {
            background-position: -200% 0;
        }
        100% {
            background-position: 200% 0;
        }
    }

    @keyframes checkmark {
        to {
            stroke-dashoffset: 0;
        }
    }

    @keyframes confetti-fall {
        to {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
        }
    }

    @keyframes bounceIn {
        0% {
            opacity: 0;
            transform: scale(0.3);
        }
        50% {
            opacity: 1;
            transform: scale(1.05);
        }
        70% {
            transform: scale(0.9);
        }
        100% {
            opacity: 1;
            transform: scale(1);
        }
    }

    @keyframes shake {
        0%, 100% {
            transform: translateX(0);
        }
        10%, 30%, 50%, 70%, 90% {
            transform: translateX(-5px);
        }
        20%, 40%, 60%, 80% {
            transform: translateX(5px);
        }
    }

    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(30px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes slideInLeft {
        from {
            transform: translateX(-100%);
        }
        to {
            transform: translateX(0);
        }
    }

    @keyframes slideInRight {
        from {
            transform: translateX(100%);
        }
        to {
            transform: translateX(0);
        }
    }

    @keyframes zoomIn {
        from {
            opacity: 0;
            transform: scale(0.5);
        }
        to {
            opacity: 1;
            transform: scale(1);
        }
    }

    @keyframes float {
        0%, 100% {
            transform: translateY(0);
        }
        50% {
            transform: translateY(-10px);
        }
    }

    /* Loading animations */
    .loading-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(255, 255, 255, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        transition: opacity 0.3s ease;
    }

    .loading-spinner {
        display: flex;
        gap: 4px;
    }

    .loading-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #667eea;
        animation: loading-bounce 1.4s ease-in-out infinite both;
    }

    .loading-dot:nth-child(1) { animation-delay: -0.32s; }
    .loading-dot:nth-child(2) { animation-delay: -0.16s; }

    @keyframes loading-bounce {
        0%, 80%, 100% {
            transform: scale(0);
        }
        40% {
            transform: scale(1);
        }
    }

    /* Success animations */
    .success-checkmark {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border-radius: 50%;
        padding: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        transition: opacity 0.3s ease;
    }

    /* Progress ring */
    .progress-ring {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .progress-text {
        position: absolute;
        font-size: 10px;
        font-weight: 600;
        color: #667eea;
    }

    /* Confetti */
    .confetti-piece {
        border-radius: 2px;
    }

    /* Enhanced transitions */
    .smooth-transition {
        transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    .bounce-transition {
        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    }

    /* Hover effects */
    .hover-lift {
        transition: transform 0.3s ease, box-shadow 0.3s ease;
    }

    .hover-lift:hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 25px rgba(0,0,0,0.15);
    }

    .hover-glow {
        transition: box-shadow 0.3s ease;
    }

    .hover-glow:hover {
        box-shadow: 0 0 20px rgba(102, 126, 234, 0.4);
    }

    /* Stagger animations */
    .stagger-animation > * {
        animation-delay: calc(var(--stagger-delay, 0.1s) * var(--stagger-index, 0));
    }

    /* Reduced motion overrides */
    .reduced-motion * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }

    .reduced-motion .animate-on-scroll {
        opacity: 1;
        transform: none;
    }

    /* Dark mode animation adjustments */
    [data-theme="dark"] .loading-overlay {
        background: rgba(37, 37, 56, 0.9);
    }

    [data-theme="dark"] .success-checkmark {
        background: #252538;
    }

    /* Mobile optimizations */
    @media (max-width: 768px) {
        .animate-on-scroll {
            transform: translateY(10px);
        }
        
        .loading-spinner {
            scale: 0.8;
        }
        
        .confetti-piece {
            width: 6px;
            height: 6px;
        }
    }

    /* High contrast mode */
    .high-contrast .loading-dot {
        background: #ffff00;
    }

    .high-contrast .progress-text {
        color: #ffff00;
    }
`;
document.head.appendChild(animationStyles);

// Initialize animations manager
document.addEventListener('DOMContentLoaded', () => {
    window.animationsManager = new AnimationsManager();
    
    // Add floating animation to weather widget
    setTimeout(() => {
        const weatherWidget = document.getElementById('weather-widget');
        if (weatherWidget && !window.animationsManager.isReducedMotion) {
            weatherWidget.style.animation = 'float 3s ease-in-out infinite';
        }
    }, 2000);
    
    // Add entrance animation to the whole app
    document.body.style.opacity = '0';
    setTimeout(() => {
        window.animationsManager.fadeIn(document.body, 500);
    }, 100);
});