class RecommendationsEngine {
    constructor() {
        this.userProfile = this.loadUserProfile();
        this.recommendations = [];
        this.learningData = this.loadLearningData();
        this.analysisInterval = null;
        this.init();
    }

    init() {
        this.analyzeUserBehavior();
        this.setupRecommendationDisplay();
        this.startLearning();
    }

    loadUserProfile() {
        const stored = localStorage.getItem('userProfile');
        return stored ? JSON.parse(stored) : {
            preferences: {
                favoriteTypes: {},
                preferredDistances: [],
                timePreferences: {},
                weatherPreferences: {},
                themeUsage: {}
            },
            behavior: {
                searchHistory: [],
                visitHistory: [],
                adventureHistory: [],
                interactionPatterns: {}
            },
            demographics: {
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                language: navigator.language,
                platform: navigator.platform
            }
        };
    }

    loadLearningData() {
        const stored = localStorage.getItem('learningData');
        return stored ? JSON.parse(stored) : {
            placeRatings: {},
            typePreferences: {},
            timePatterns: {},
            weatherCorrelations: {},
            socialSharing: {},
            sessionData: []
        };
    }

    saveUserProfile() {
        try {
            localStorage.setItem('userProfile', JSON.stringify(this.userProfile));
        } catch (error) {
            console.warn('Failed to save user profile:', error);
        }
    }

    saveLearningData() {
        try {
            localStorage.setItem('learningData', JSON.stringify(this.learningData));
        } catch (error) {
            console.warn('Failed to save learning data:', error);
        }
    }

    analyzeUserBehavior() {
        // Analyze stored data to understand user preferences
        this.analyzePlaceTypes();
        this.analyzeTimePatterns();
        this.analyzeDistancePreferences();
        this.analyzeWeatherBehavior();
        this.generatePersonalityProfile();
    }

    analyzePlaceTypes() {
        const visitedPlaces = window.storageManager?.getVisitedPlaces() || [];
        const typeFrequency = {};

        visitedPlaces.forEach(place => {
            const type = place.type || 'unknown';
            typeFrequency[type] = (typeFrequency[type] || 0) + 1;
        });

        this.userProfile.preferences.favoriteTypes = typeFrequency;
        this.calculateTypeAffinityScores();
    }

    calculateTypeAffinityScores() {
        const types = this.userProfile.preferences.favoriteTypes;
        const totalVisits = Object.values(types).reduce((sum, count) => sum + count, 0);
        
        this.userProfile.affinityScores = {};
        
        Object.entries(types).forEach(([type, count]) => {
            const score = count / totalVisits;
            this.userProfile.affinityScores[type] = score;
            
            // Also boost similar types
            this.boostSimilarTypes(type, score * 0.3);
        });
    }

    boostSimilarTypes(baseType, boostAmount) {
        const similarTypes = {
            'restaurant': ['cafe', 'bar', 'fast_food'],
            'cafe': ['restaurant', 'bar'],
            'park': ['viewpoint', 'nature_reserve'],
            'museum': ['gallery', 'historic', 'theatre'],
            'bar': ['restaurant', 'cafe'],
            'viewpoint': ['park', 'tourist_attraction']
        };

        const similar = similarTypes[baseType] || [];
        similar.forEach(type => {
            this.userProfile.affinityScores[type] = 
                (this.userProfile.affinityScores[type] || 0) + boostAmount;
        });
    }

    analyzeTimePatterns() {
        const adventures = window.storageManager?.getSavedAdventures() || [];
        const timePatterns = {};

        adventures.forEach(adventure => {
            if (adventure.created) {
                const date = new Date(adventure.created);
                const hour = date.getHours();
                const dayOfWeek = date.getDay();
                
                const timeSlot = this.getTimeSlot(hour);
                timePatterns[timeSlot] = (timePatterns[timeSlot] || 0) + 1;
                
                this.userProfile.behavior.timePreferences[dayOfWeek] = 
                    (this.userProfile.behavior.timePreferences[dayOfWeek] || 0) + 1;
            }
        });

        this.userProfile.preferences.timePreferences = timePatterns;
    }

    getTimeSlot(hour) {
        if (hour >= 6 && hour < 12) return 'morning';
        if (hour >= 12 && hour < 17) return 'afternoon';
        if (hour >= 17 && hour < 21) return 'evening';
        return 'night';
    }

    analyzeDistancePreferences() {
        const visitedPlaces = window.storageManager?.getVisitedPlaces() || [];
        const distances = visitedPlaces
            .map(place => parseFloat(place.distance))
            .filter(d => !isNaN(d));

        if (distances.length > 0) {
            const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
            const maxDistance = Math.max(...distances);
            
            this.userProfile.preferences.averageDistance = avgDistance;
            this.userProfile.preferences.maxDistance = maxDistance;
            this.userProfile.preferences.preferredDistances = distances;
        }
    }

    analyzeWeatherBehavior() {
        // Correlate past adventures with weather conditions
        const adventures = window.storageManager?.getSavedAdventures() || [];
        const weatherCorrelations = {};

        // This would be enhanced with actual weather data
        adventures.forEach(adventure => {
            // Mock weather correlation for demonstration
            const season = this.getSeason(new Date(adventure.created));
            weatherCorrelations[season] = (weatherCorrelations[season] || 0) + 1;
        });

        this.userProfile.preferences.weatherPreferences = weatherCorrelations;
    }

    getSeason(date) {
        const month = date.getMonth();
        if (month >= 2 && month <= 4) return 'spring';
        if (month >= 5 && month <= 7) return 'summer';
        if (month >= 8 && month <= 10) return 'fall';
        return 'winter';
    }

    generatePersonalityProfile() {
        // Create a personality profile based on behavior
        const profile = {
            explorer: 0,
            social: 0,
            comfort: 0,
            adventurous: 0,
            local: 0
        };

        // Analyze adventure patterns
        const adventures = window.storageManager?.getSavedAdventures() || [];
        const avgAdventureLength = adventures.reduce((sum, adv) => sum + (adv.places?.length || 0), 0) / adventures.length;

        if (avgAdventureLength > 3) profile.explorer += 0.3;
        if (avgAdventureLength > 5) profile.adventurous += 0.4;

        // Analyze sharing behavior
        const shareEvents = JSON.parse(localStorage.getItem('shareEvents') || '[]');
        if (shareEvents.length > 0) {
            profile.social = Math.min(shareEvents.length / 10, 1);
        }

        // Analyze distance preferences
        const avgDistance = this.userProfile.preferences.averageDistance || 0;
        if (avgDistance < 2) profile.local += 0.5;
        if (avgDistance > 10) profile.adventurous += 0.3;

        // Analyze place types for comfort vs adventure
        const favoriteTypes = this.userProfile.preferences.favoriteTypes;
        const comfortTypes = ['cafe', 'restaurant', 'museum'];
        const adventureTypes = ['viewpoint', 'park', 'historic'];

        let comfortScore = 0;
        let adventureScore = 0;

        Object.entries(favoriteTypes).forEach(([type, count]) => {
            if (comfortTypes.includes(type)) comfortScore += count;
            if (adventureTypes.includes(type)) adventureScore += count;
        });

        const total = comfortScore + adventureScore;
        if (total > 0) {
            profile.comfort = comfortScore / total;
            profile.adventurous += adventureScore / total;
        }

        this.userProfile.personality = profile;
        this.saveUserProfile();
    }

    generateRecommendations(location, options = {}) {
        if (!location) return [];

        const recommendations = [];
        
        // Generate different types of recommendations
        recommendations.push(...this.getPersonalizedPlaceRecommendations(location, options));
        recommendations.push(...this.getAdventureRecommendations(location, options));
        recommendations.push(...this.getTimeBasedRecommendations(location, options));
        recommendations.push(...this.getWeatherBasedRecommendations(location, options));
        recommendations.push(...this.getSocialRecommendations(location, options));

        // Score and sort recommendations
        const scoredRecommendations = recommendations
            .map(rec => ({
                ...rec,
                confidence: this.calculateConfidence(rec),
                personalizedScore: this.calculatePersonalizedScore(rec)
            }))
            .sort((a, b) => b.personalizedScore - a.personalizedScore)
            .slice(0, 10); // Top 10 recommendations

        this.recommendations = scoredRecommendations;
        return scoredRecommendations;
    }

    getPersonalizedPlaceRecommendations(location, options) {
        const recommendations = [];
        const affinityScores = this.userProfile.affinityScores || {};
        
        // Recommend places based on type affinity
        Object.entries(affinityScores)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3)
            .forEach(([type, score]) => {
                recommendations.push({
                    type: 'place',
                    subtype: type,
                    title: `Discover ${this.formatTypeName(type)}`,
                    description: `Based on your love for ${this.formatTypeName(type)} places`,
                    confidence: score,
                    reason: 'personal_preference',
                    action: () => this.findPlaceByType(type, location)
                });
            });

        return recommendations;
    }

    getAdventureRecommendations(location, options) {
        const recommendations = [];
        const personality = this.userProfile.personality || {};
        
        if (personality.explorer > 0.5) {
            recommendations.push({
                type: 'adventure',
                subtype: 'exploration',
                title: 'Urban Explorer Adventure',
                description: 'Discover hidden gems across the city',
                confidence: personality.explorer,
                reason: 'personality_match',
                action: () => this.generateExplorerAdventure(location)
            });
        }

        if (personality.social > 0.4) {
            recommendations.push({
                type: 'adventure',
                subtype: 'social',
                title: 'Social Hotspots Tour',
                description: 'Visit the most popular and shareable spots',
                confidence: personality.social,
                reason: 'social_behavior',
                action: () => this.generateSocialAdventure(location)
            });
        }

        if (personality.local > 0.6) {
            recommendations.push({
                type: 'adventure',
                subtype: 'local',
                title: 'Neighborhood Deep Dive',
                description: 'Explore your local area like never before',
                confidence: personality.local,
                reason: 'local_preference',
                action: () => this.generateLocalAdventure(location)
            });
        }

        return recommendations;
    }

    getTimeBasedRecommendations(location, options) {
        const recommendations = [];
        const now = new Date();
        const hour = now.getHours();
        const timeSlot = this.getTimeSlot(hour);
        
        const timePreferences = this.userProfile.preferences.timePreferences || {};
        const currentTimeScore = timePreferences[timeSlot] || 0;

        if (currentTimeScore > 0) {
            recommendations.push({
                type: 'time_based',
                subtype: timeSlot,
                title: `Perfect ${timeSlot} Spot`,
                description: `You often explore during ${timeSlot} - here's something special`,
                confidence: currentTimeScore / 10,
                reason: 'time_pattern',
                action: () => this.findTimeAppropriatePlaces(timeSlot, location)
            });
        }

        // Special time-based recommendations
        if (hour >= 11 && hour <= 14) {
            recommendations.push({
                type: 'time_based',
                subtype: 'lunch',
                title: 'Lunch Adventure',
                description: 'Perfect timing for a lunch discovery',
                confidence: 0.8,
                reason: 'current_time',
                action: () => this.findLunchSpots(location)
            });
        }

        return recommendations;
    }

    getWeatherBasedRecommendations(location, options) {
        const recommendations = [];
        
        // This would use actual weather data
        const currentWeather = options.weather || { isGoodForOutdoor: Math.random() > 0.5 };
        
        if (currentWeather.isGoodForOutdoor) {
            recommendations.push({
                type: 'weather_based',
                subtype: 'outdoor',
                title: 'Perfect Weather Adventure',
                description: 'Great weather for outdoor exploration!',
                confidence: 0.9,
                reason: 'weather_optimal',
                action: () => this.findOutdoorPlaces(location)
            });
        } else {
            recommendations.push({
                type: 'weather_based',
                subtype: 'indoor',
                title: 'Cozy Indoor Discoveries',
                description: 'Weather suggests indoor adventures',
                confidence: 0.8,
                reason: 'weather_shelter',
                action: () => this.findIndoorPlaces(location)
            });
        }

        return recommendations;
    }

    getSocialRecommendations(location, options) {
        const recommendations = [];
        const shareEvents = JSON.parse(localStorage.getItem('shareEvents') || '[]');
        
        if (shareEvents.length > 0) {
            recommendations.push({
                type: 'social',
                subtype: 'shareable',
                title: 'Instagram-Worthy Spots',
                description: 'Perfect for sharing with friends',
                confidence: Math.min(shareEvents.length / 20, 1),
                reason: 'sharing_behavior',
                action: () => this.findShareableSpots(location)
            });
        }

        return recommendations;
    }

    calculateConfidence(recommendation) {
        // Base confidence from the recommendation
        let confidence = recommendation.confidence || 0.5;
        
        // Boost based on data quality
        const dataQuality = this.getDataQuality();
        confidence *= (0.5 + dataQuality * 0.5);
        
        // Boost based on recency of similar actions
        const recentActivity = this.getRecentActivityBoost(recommendation);
        confidence *= (0.8 + recentActivity * 0.4);
        
        return Math.min(confidence, 1);
    }

    calculatePersonalizedScore(recommendation) {
        let score = recommendation.confidence || 0.5;
        
        // Personality alignment
        const personalityBoost = this.getPersonalityAlignment(recommendation);
        score += personalityBoost * 0.3;
        
        // Behavioral patterns
        const behaviorBoost = this.getBehaviorAlignment(recommendation);
        score += behaviorBoost * 0.2;
        
        // Time relevance
        const timeBoost = this.getTimeRelevance(recommendation);
        score += timeBoost * 0.1;
        
        return Math.min(score, 1);
    }

    getDataQuality() {
        const visitedPlaces = window.storageManager?.getVisitedPlaces() || [];
        const adventures = window.storageManager?.getSavedAdventures() || [];
        
        const totalDataPoints = visitedPlaces.length + adventures.length;
        return Math.min(totalDataPoints / 20, 1); // Full quality at 20+ data points
    }

    getRecentActivityBoost(recommendation) {
        const recentActivity = this.learningData.sessionData
            .filter(session => Date.now() - new Date(session.timestamp).getTime() < 7 * 24 * 60 * 60 * 1000)
            .length;
        
        return Math.min(recentActivity / 10, 0.5);
    }

    getPersonalityAlignment(recommendation) {
        const personality = this.userProfile.personality || {};
        const type = recommendation.subtype;
        
        let alignment = 0;
        
        switch (type) {
            case 'exploration':
                alignment = personality.explorer || 0;
                break;
            case 'social':
                alignment = personality.social || 0;
                break;
            case 'local':
                alignment = personality.local || 0;
                break;
            case 'outdoor':
                alignment = personality.adventurous || 0;
                break;
            case 'indoor':
                alignment = personality.comfort || 0;
                break;
        }
        
        return alignment;
    }

    getBehaviorAlignment(recommendation) {
        // Check how well this aligns with past behavior
        const favoriteTypes = this.userProfile.preferences.favoriteTypes || {};
        const total = Object.values(favoriteTypes).reduce((sum, count) => sum + count, 0);
        
        if (total === 0) return 0;
        
        const relevantCount = favoriteTypes[recommendation.subtype] || 0;
        return relevantCount / total;
    }

    getTimeRelevance(recommendation) {
        const now = new Date();
        const timeSlot = this.getTimeSlot(now.getHours());
        const timePreferences = this.userProfile.preferences.timePreferences || {};
        
        return (timePreferences[timeSlot] || 0) / 10;
    }

    setupRecommendationDisplay() {
        // Add recommendations section to the UI
        this.createRecommendationsWidget();
        this.updateRecommendationsDisplay();
    }

    createRecommendationsWidget() {
        const widget = document.createElement('div');
        widget.id = 'recommendations-widget';
        widget.className = 'recommendations-widget hidden';
        widget.innerHTML = `
            <div class="recommendations-header">
                <h3>🎯 Recommended for You</h3>
                <button id="refresh-recommendations" class="small-btn" title="Refresh recommendations">🔄</button>
            </div>
            <div id="recommendations-list" class="recommendations-list"></div>
        `;

        // Add to the single-mode tab
        const singleMode = document.getElementById('single-mode');
        if (singleMode) {
            singleMode.appendChild(widget);
        }

        // Add event listeners
        document.getElementById('refresh-recommendations')?.addEventListener('click', () => {
            this.refreshRecommendations();
        });
    }

    updateRecommendationsDisplay() {
        const widget = document.getElementById('recommendations-widget');
        const list = document.getElementById('recommendations-list');
        
        if (!widget || !list || this.recommendations.length === 0) {
            if (widget) widget.classList.add('hidden');
            return;
        }

        widget.classList.remove('hidden');
        
        list.innerHTML = this.recommendations
            .slice(0, 3) // Show top 3
            .map((rec, index) => `
                <div class="recommendation-item" data-index="${index}">
                    <div class="recommendation-content">
                        <h4>${rec.title}</h4>
                        <p>${rec.description}</p>
                        <div class="recommendation-meta">
                            <span class="confidence-badge">
                                ${Math.round(rec.confidence * 100)}% match
                            </span>
                            <span class="reason-badge">
                                ${this.formatReason(rec.reason)}
                            </span>
                        </div>
                    </div>
                    <button class="recommendation-action" onclick="window.recommendationsEngine.executeRecommendation(${index})">
                        Try It
                    </button>
                </div>
            `).join('');
    }

    formatReason(reason) {
        const reasons = {
            'personal_preference': 'Your favorite',
            'personality_match': 'Fits your style',
            'social_behavior': 'Popular choice',
            'time_pattern': 'Perfect timing',
            'weather_optimal': 'Great weather',
            'sharing_behavior': 'Share-worthy'
        };
        
        return reasons[reason] || 'Recommended';
    }

    formatTypeName(type) {
        return type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    executeRecommendation(index) {
        const recommendation = this.recommendations[index];
        if (recommendation && recommendation.action) {
            recommendation.action();
            
            // Track execution
            this.trackRecommendationExecution(recommendation);
        }
    }

    trackRecommendationExecution(recommendation) {
        this.learningData.sessionData.push({
            type: 'recommendation_executed',
            recommendation: recommendation,
            timestamp: new Date().toISOString()
        });
        
        this.saveLearningData();
    }

    refreshRecommendations() {
        const location = window.randomPlacesFinder?.currentLocation;
        const weather = window.weatherManager?.fallbackWeather;
        
        if (location) {
            this.generateRecommendations(location, { weather });
            this.updateRecommendationsDisplay();
            
            if (window.pwaManager) {
                window.pwaManager.showToast('🎯 Recommendations updated!', 'success');
            }
        }
    }

    startLearning() {
        // Set up learning from user interactions
        this.trackInteractions();
        this.periodicAnalysis();
    }

    trackInteractions() {
        // Track various user interactions
        document.addEventListener('click', (e) => {
            this.trackClick(e);
        });

        document.addEventListener('placeDisplayed', (e) => {
            this.trackPlaceViewed(e.detail.place);
        });

        // Track tab switches
        document.addEventListener('tabSwitched', (e) => {
            this.trackTabSwitch(e.detail.tabName);
        });
    }

    trackClick(event) {
        const target = event.target;
        const clickData = {
            type: 'click',
            element: target.tagName,
            className: target.className,
            id: target.id,
            timestamp: new Date().toISOString()
        };

        this.learningData.sessionData.push(clickData);
        
        // Keep only last 1000 interactions
        if (this.learningData.sessionData.length > 1000) {
            this.learningData.sessionData = this.learningData.sessionData.slice(-1000);
        }
    }

    trackPlaceViewed(place) {
        this.learningData.sessionData.push({
            type: 'place_viewed',
            place: {
                name: place.name,
                type: place.type,
                rating: place.rating,
                distance: place.distance
            },
            timestamp: new Date().toISOString()
        });
    }

    trackTabSwitch(tabName) {
        this.learningData.sessionData.push({
            type: 'tab_switch',
            tab: tabName,
            timestamp: new Date().toISOString()
        });
    }

    periodicAnalysis() {
        // Clear existing interval
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
        }
        
        // Re-analyze user behavior periodically
        this.analysisInterval = setInterval(() => {
            this.analyzeUserBehavior();
            this.saveLearningData();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    // Placeholder action methods
    findPlaceByType(type, location) {
        if (window.randomPlacesFinder) {
            window.randomPlacesFinder.findRandomPlace(type === 'tourist_attraction' ? 'tourist_attraction' : 'restaurant');
        }
    }

    generateExplorerAdventure(location) {
        if (window.adventurePlanner) {
            // Switch to adventure tab and trigger build
            window.adventurePlanner.switchTab('adventure');
            setTimeout(() => {
                document.getElementById('build-adventure')?.click();
            }, 500);
        }
    }

    generateSocialAdventure(location) {
        // Similar to explorer but focus on shareable places
        this.generateExplorerAdventure(location);
    }

    generateLocalAdventure(location) {
        // Generate adventure with smaller radius
        this.generateExplorerAdventure(location);
    }

    findTimeAppropriatePlaces(timeSlot, location) {
        const type = timeSlot === 'evening' ? 'restaurant' : 'tourist_attraction';
        this.findPlaceByType(type, location);
    }

    findLunchSpots(location) {
        this.findPlaceByType('restaurant', location);
    }

    findOutdoorPlaces(location) {
        this.findPlaceByType('park', location);
    }

    findIndoorPlaces(location) {
        this.findPlaceByType('museum', location);
    }

    findShareableSpots(location) {
        this.findPlaceByType('tourist_attraction', location);
    }
}

// Add recommendations styles
const recommendationsStyles = document.createElement('style');
recommendationsStyles.textContent = `
    .recommendations-widget {
        background: var(--bg-card);
        border-radius: 15px;
        padding: 20px;
        margin-top: 20px;
        border: 1px solid var(--border-color);
        transition: all 0.3s ease;
    }

    .recommendations-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
    }

    .recommendations-header h3 {
        margin: 0;
        color: var(--text-primary);
        font-size: 1.2rem;
    }

    .recommendations-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .recommendation-item {
        display: flex;
        align-items: center;
        gap: 15px;
        padding: 15px;
        background: var(--bg-secondary);
        border-radius: 10px;
        border-left: 4px solid #667eea;
        transition: all 0.3s ease;
    }

    .recommendation-item:hover {
        transform: translateX(4px);
        box-shadow: 0 4px 8px var(--shadow);
    }

    .recommendation-content {
        flex: 1;
    }

    .recommendation-content h4 {
        margin: 0 0 5px 0;
        color: var(--text-primary);
        font-size: 1rem;
    }

    .recommendation-content p {
        margin: 0 0 8px 0;
        color: var(--text-secondary);
        font-size: 0.9rem;
        line-height: 1.4;
    }

    .recommendation-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .confidence-badge,
    .reason-badge {
        font-size: 0.75rem;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;
    }

    .confidence-badge {
        background: rgba(102, 126, 234, 0.1);
        color: #667eea;
    }

    .reason-badge {
        background: rgba(16, 185, 129, 0.1);
        color: #10b981;
    }

    .recommendation-action {
        padding: 8px 16px;
        background: #667eea;
        color: white;
        border: none;
        border-radius: 6px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        white-space: nowrap;
    }

    .recommendation-action:hover {
        background: #5a67d8;
        transform: translateY(-1px);
    }

    @media (max-width: 768px) {
        .recommendation-item {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
        }
        
        .recommendation-action {
            align-self: center;
            width: fit-content;
        }
        
        .recommendation-meta {
            justify-content: center;
        }
    }
`;
document.head.appendChild(recommendationsStyles);

// Initialize recommendations engine
document.addEventListener('DOMContentLoaded', () => {
    window.recommendationsEngine = new RecommendationsEngine();
    
    // Generate initial recommendations when location is available
    setTimeout(() => {
        if (window.randomPlacesFinder?.currentLocation) {
            const location = window.randomPlacesFinder.currentLocation;
            const weather = window.weatherManager?.fallbackWeather;
            window.recommendationsEngine.generateRecommendations(location, { weather });
            window.recommendationsEngine.updateRecommendationsDisplay();
        }
    }, 2000);
});

// Add cleanup method to RecommendationsEngine prototype
RecommendationsEngine.prototype.destroy = function() {
    if (this.analysisInterval) {
        clearInterval(this.analysisInterval);
        this.analysisInterval = null;
    }
};