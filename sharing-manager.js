class SharingManager {
    constructor() {
        this.init();
    }

    init() {
        this.handleSharedAdventures();
        this.addShareButtons();
        this.setupSocialSharing();
    }

    handleSharedAdventures() {
        // Check if there's a shared adventure in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const sharedData = urlParams.get('shared') || urlParams.get('adventure');
        
        if (sharedData) {
            try {
                const adventure = this.decodeSharedAdventure(sharedData);
                this.loadSharedAdventure(adventure);
            } catch (error) {
                console.error('Failed to load shared adventure:', error);
                if (window.pwaManager) {
                    window.pwaManager.showToast('❌ Invalid shared adventure link', 'error');
                }
            }
        }
    }

    encodeAdventure(adventure) {
        try {
            // Create a compressed version of the adventure
            const shareableAdventure = {
                id: adventure.id,
                places: adventure.places.map(place => ({
                    name: place.name,
                    address: place.address || '',
                    lat: place.lat,
                    lng: place.lng,
                    rating: place.rating,
                    type: place.type,
                    distance: place.distance
                })),
                style: adventure.style,
                totalTime: adventure.totalTime,
                created: adventure.created,
                shared: true,
                sharedAt: new Date().toISOString()
            };
            
            // Base64 encode with URL-safe characters
            const jsonString = JSON.stringify(shareableAdventure);
            return btoa(unescape(encodeURIComponent(jsonString)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=/g, '');
        } catch (error) {
            console.error('Failed to encode adventure:', error);
            return null;
        }
    }

    decodeSharedAdventure(encodedData) {
        try {
            // Add padding if needed and restore URL-unsafe characters
            let base64 = encodedData.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) {
                base64 += '=';
            }
            
            const jsonString = decodeURIComponent(escape(atob(base64)));
            return JSON.parse(jsonString);
        } catch (error) {
            console.error('Failed to decode adventure:', error);
            throw new Error('Invalid adventure data');
        }
    }

    loadSharedAdventure(adventure) {
        if (!adventure || !adventure.places || adventure.places.length === 0) {
            throw new Error('Invalid adventure structure');
        }

        // Show loading message
        if (window.pwaManager) {
            window.pwaManager.showToast('📥 Loading shared adventure...', 'info');
        }

        // Wait for components to be ready
        setTimeout(() => {
            try {
                // Switch to adventure tab
                if (window.adventurePlanner) {
                    window.adventurePlanner.switchTab('adventure');
                    
                    // Set the shared adventure as current
                    window.adventurePlanner.currentAdventure = adventure;
                    window.adventurePlanner.displayAdventurePlan(adventure);
                    
                    // Show success message
                    const placeCount = adventure.places.length;
                    const sharedBy = adventure.sharedBy || 'someone';
                    if (window.pwaManager) {
                        window.pwaManager.showToast(
                            `🎉 Loaded ${placeCount}-stop adventure shared by ${sharedBy}!`, 
                            'success'
                        );
                    }
                } else {
                    throw new Error('Adventure planner not ready');
                }
            } catch (error) {
                console.error('Failed to load shared adventure:', error);
                if (window.pwaManager) {
                    window.pwaManager.showToast('❌ Failed to load adventure', 'error');
                }
            }
        }, 1000);
    }

    addShareButtons() {
        // Add share button to place cards
        this.addPlaceShareButton();
        
        // Add share button to adventure plans
        this.addAdventureShareButton();
    }

    addPlaceShareButton() {
        // This will be called when a place is displayed
        document.addEventListener('placeDisplayed', (e) => {
            const placeActions = document.querySelector('.place-actions');
            if (placeActions && !placeActions.querySelector('.share-place-btn')) {
                const shareBtn = document.createElement('button');
                shareBtn.className = 'secondary-btn share-place-btn';
                shareBtn.innerHTML = '🔗 Share Place';
                shareBtn.addEventListener('click', () => {
                    this.shareSinglePlace(e.detail.place);
                });
                placeActions.appendChild(shareBtn);
            }
        });
    }

    addAdventureShareButton() {
        // Add to adventure actions if not already present
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const adventureActions = node.querySelector?.('.adventure-actions') || 
                                               (node.classList?.contains('adventure-actions') ? node : null);
                        
                        if (adventureActions && !adventureActions.querySelector('.share-adventure-btn')) {
                            this.insertAdventureShareButton(adventureActions);
                        }
                    }
                });
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    insertAdventureShareButton(actionsContainer) {
        const shareBtn = document.createElement('button');
        shareBtn.className = 'secondary-btn share-adventure-btn';
        shareBtn.innerHTML = '🔗 Share Adventure';
        shareBtn.addEventListener('click', () => {
            if (window.adventurePlanner?.currentAdventure) {
                this.shareAdventure(window.adventurePlanner.currentAdventure);
            }
        });
        actionsContainer.appendChild(shareBtn);
    }

    async shareSinglePlace(place) {
        if (!place) {
            if (window.pwaManager) {
                window.pwaManager.showToast('❌ No place to share', 'error');
            }
            return;
        }

        const shareData = {
            title: `Check out ${place.name}!`,
            text: `I found this interesting place: ${place.name} - ${place.address}`,
            url: this.createPlaceShareURL(place)
        };

        await this.performShare(shareData, 'place');
    }

    async shareAdventure(adventure) {
        if (!adventure || !adventure.places || adventure.places.length === 0) {
            if (window.pwaManager) {
                window.pwaManager.showToast('❌ No adventure to share', 'error');
            }
            return;
        }

        const shareData = {
            title: `My ${adventure.places.length}-Stop Adventure!`,
            text: `Check out my adventure plan: ${adventure.places.length} amazing places to visit!`,
            url: this.createAdventureShareURL(adventure)
        };

        await this.performShare(shareData, 'adventure');
    }

    createPlaceShareURL(place) {
        const baseURL = window.location.origin + window.location.pathname;
        const singlePlaceAdventure = {
            id: Date.now(),
            places: [place],
            style: 'single',
            totalTime: 1,
            created: new Date().toISOString(),
            sharedBy: this.getSharerName()
        };
        
        const encodedData = this.encodeAdventure(singlePlaceAdventure);
        return `${baseURL}?shared=${encodedData}`;
    }

    createAdventureShareURL(adventure) {
        const baseURL = window.location.origin + window.location.pathname;
        const shareableAdventure = {
            ...adventure,
            sharedBy: this.getSharerName()
        };
        
        const encodedData = this.encodeAdventure(shareableAdventure);
        return `${baseURL}?shared=${encodedData}`;
    }

    getSharerName() {
        // Get user's name from localStorage or generate a friendly identifier
        return localStorage.getItem('userName') || 
               localStorage.getItem('userNickname') || 
               'Anonymous Adventurer';
    }

    async performShare(shareData, type) {
        try {
            if (navigator.share && this.canUseNativeShare()) {
                // Use native sharing if available
                await navigator.share(shareData);
                if (window.pwaManager) {
                    window.pwaManager.showToast(`🎉 ${type} shared!`, 'success');
                }
            } else {
                // Fallback to copying link
                await this.copyToClipboard(shareData.url);
                if (window.pwaManager) {
                    window.pwaManager.showToast(`🔗 ${type} link copied to clipboard!`, 'success');
                }
            }
        } catch (error) {
            console.error('Share failed:', error);
            
            // Double fallback: show share modal
            this.showShareModal(shareData, type);
        }
    }

    canUseNativeShare() {
        return navigator.share && 
               /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    }

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (error) {
            // Fallback for older browsers
            this.fallbackCopyToClipboard(text);
        }
    }

    fallbackCopyToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            document.execCommand('copy');
        } catch (error) {
            console.error('Fallback copy failed:', error);
            throw error;
        } finally {
            document.body.removeChild(textArea);
        }
    }

    showShareModal(shareData, type) {
        // Create and show a share modal
        const modal = document.createElement('div');
        modal.className = 'share-modal';
        modal.innerHTML = `
            <div class="share-modal-content">
                <div class="share-modal-header">
                    <h3>Share ${type}</h3>
                    <button class="share-modal-close">×</button>
                </div>
                <div class="share-modal-body">
                    <p>${shareData.text}</p>
                    <div class="share-url">
                        <input type="text" value="${shareData.url}" readonly>
                        <button class="copy-url-btn">Copy</button>
                    </div>
                    <div class="share-social">
                        <a href="${this.createTwitterShareURL(shareData)}" target="_blank" class="social-btn twitter">
                            🐦 Twitter
                        </a>
                        <a href="${this.createWhatsAppShareURL(shareData)}" target="_blank" class="social-btn whatsapp">
                            💬 WhatsApp
                        </a>
                        <a href="${this.createFacebookShareURL(shareData)}" target="_blank" class="social-btn facebook">
                            📘 Facebook
                        </a>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Add event listeners
        modal.querySelector('.share-modal-close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modal.querySelector('.copy-url-btn').addEventListener('click', async () => {
            try {
                await this.copyToClipboard(shareData.url);
                if (window.pwaManager) {
                    window.pwaManager.showToast('🔗 Link copied!', 'success');
                }
            } catch (error) {
                if (window.pwaManager) {
                    window.pwaManager.showToast('❌ Copy failed', 'error');
                }
            }
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    }

    setupSocialSharing() {
        // Pre-generate share URLs for better performance
        this.socialShareTemplates = {
            twitter: 'https://twitter.com/intent/tweet?text={text}&url={url}',
            facebook: 'https://www.facebook.com/sharer/sharer.php?u={url}',
            whatsapp: 'https://wa.me/?text={text} {url}',
            linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url={url}',
            telegram: 'https://t.me/share/url?url={url}&text={text}'
        };
    }

    createTwitterShareURL(shareData) {
        return this.socialShareTemplates.twitter
            .replace('{text}', encodeURIComponent(shareData.text))
            .replace('{url}', encodeURIComponent(shareData.url));
    }

    createFacebookShareURL(shareData) {
        return this.socialShareTemplates.facebook
            .replace('{url}', encodeURIComponent(shareData.url));
    }

    createWhatsAppShareURL(shareData) {
        return this.socialShareTemplates.whatsapp
            .replace('{text}', encodeURIComponent(shareData.text))
            .replace('{url}', encodeURIComponent(shareData.url));
    }

    // Analytics for sharing
    trackShare(type, platform) {
        // Track share events for analytics
        const event = {
            type: 'share',
            contentType: type,
            platform: platform,
            timestamp: new Date().toISOString()
        };

        // Store in localStorage for now (could be sent to analytics service)
        const shares = JSON.parse(localStorage.getItem('shareEvents') || '[]');
        shares.push(event);
        localStorage.setItem('shareEvents', JSON.stringify(shares.slice(-100))); // Keep last 100
    }

    getShareStats() {
        const shares = JSON.parse(localStorage.getItem('shareEvents') || '[]');
        return {
            totalShares: shares.length,
            byType: shares.reduce((acc, share) => {
                acc[share.contentType] = (acc[share.contentType] || 0) + 1;
                return acc;
            }, {}),
            byPlatform: shares.reduce((acc, share) => {
                acc[share.platform] = (acc[share.platform] || 0) + 1;
                return acc;
            }, {})
        };
    }
}

// Add sharing styles
const sharingStyles = document.createElement('style');
sharingStyles.textContent = `
    .share-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.3s ease;
    }

    .share-modal-content {
        background: var(--bg-card);
        border-radius: 15px;
        width: 90%;
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
        animation: slideIn 0.3s ease;
    }

    .share-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid var(--border-color);
    }

    .share-modal-header h3 {
        margin: 0;
        color: var(--text-primary);
    }

    .share-modal-close {
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
        transition: background 0.3s ease;
    }

    .share-modal-close:hover {
        background: var(--border-color);
    }

    .share-modal-body {
        padding: 20px;
    }

    .share-modal-body p {
        margin-bottom: 15px;
        color: var(--text-secondary);
        line-height: 1.5;
    }

    .share-url {
        display: flex;
        gap: 10px;
        margin-bottom: 20px;
    }

    .share-url input {
        flex: 1;
        padding: 10px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 14px;
    }

    .copy-url-btn {
        padding: 10px 15px;
        background: var(--bg-primary);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        transition: opacity 0.3s ease;
    }

    .copy-url-btn:hover {
        opacity: 0.9;
    }

    .share-social {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 10px;
    }

    .social-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
        transition: transform 0.3s ease;
        color: white;
    }

    .social-btn:hover {
        transform: translateY(-2px);
    }

    .social-btn.twitter {
        background: #1da1f2;
    }

    .social-btn.whatsapp {
        background: #25d366;
    }

    .social-btn.facebook {
        background: #1877f2;
    }

    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    @keyframes slideIn {
        from { transform: translateY(-20px) scale(0.9); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
    }

    @media (max-width: 768px) {
        .share-modal-content {
            width: 95%;
            margin: 10px;
        }
        
        .share-social {
            grid-template-columns: 1fr;
        }
    }
`;
document.head.appendChild(sharingStyles);

// Initialize sharing manager
document.addEventListener('DOMContentLoaded', () => {
    window.sharingManager = new SharingManager();
});