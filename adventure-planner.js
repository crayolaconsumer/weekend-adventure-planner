class AdventurePlanner {
    constructor() {
        this.currentAdventure = null;
        this.adventurePlaces = [];
        this.themes = {
            foodie: {
                name: 'Foodie Tour',
                types: ['restaurant', 'cafe', 'bar', 'fast_food'],
                icon: '🍕',
                description: 'Explore local cuisine and hidden food gems'
            },
            historic: {
                name: 'Historic Journey',
                types: ['historic', 'museum', 'monument'],
                icon: '🏛️',
                description: 'Discover the past through historic sites'
            },
            nature: {
                name: 'Nature Escape',
                types: ['park', 'viewpoint', 'nature_reserve'],
                icon: '🌲',
                description: 'Connect with nature and scenic spots'
            },
            culture: {
                name: 'Culture Quest',
                types: ['museum', 'theatre', 'gallery', 'library'],
                icon: '🎭',
                description: 'Immerse yourself in arts and culture'
            },
            hidden: {
                name: 'Hidden Gems',
                types: ['any'],
                icon: '💎',
                description: 'Find off-the-beaten-path treasures'
            },
            photo: {
                name: 'Photo Safari',
                types: ['viewpoint', 'attraction', 'park'],
                icon: '📸',
                description: 'Capture Instagram-worthy moments'
            }
        };
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchTab(e.target.id.replace('-tab', ''));
            });
        });

        // Adventure builder events
        document.getElementById('build-adventure')?.addEventListener('click', () => {
            this.buildAdventure();
        });

        document.getElementById('mystery-adventure')?.addEventListener('click', () => {
            this.buildMysteryAdventure();
        });

        // Note: surprise-me button is handled by app.js to avoid duplicate listeners

        // Adventure management
        document.getElementById('start-adventure')?.addEventListener('click', () => {
            this.startAdventure();
        });

        document.getElementById('save-adventure')?.addEventListener('click', () => {
            this.saveAdventure();
        });

        document.getElementById('export-ics')?.addEventListener('click', () => {
            this.exportICS();
        });

        document.getElementById('new-adventure')?.addEventListener('click', () => {
            this.resetAdventureBuilder();
        });

        document.getElementById('end-adventure')?.addEventListener('click', () => {
            this.endAdventure();
        });

        // Place actions
        document.getElementById('add-to-adventure')?.addEventListener('click', () => {
            this.addPlaceToAdventure();
        });

        document.getElementById('mark-visited')?.addEventListener('click', () => {
            this.markPlaceVisited();
        });

        document.getElementById('save-note')?.addEventListener('click', () => {
            this.savePlaceNote();
        });

        // Adventure style filters
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            });
        });
    }

    exportICS() {
        if (!this.currentAdventure) return;
        const pad = (n) => String(n).padStart(2, '0');
        const toICSDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
        const start = new Date(this.currentAdventure.startTime || Date.now());
        const end = new Date(start.getTime() + (this.currentAdventure.totalTime || 1) * 60 * 60 * 1000);
        const summary = `Weekend Adventure (${this.currentAdventure.places.length} stops)`;
        const desc = this.currentAdventure.places.map((p,i)=>`${i+1}. ${p.name} ${p.address?'- '+p.address:''}`).join('\n');
        const loc = this.currentAdventure.places[0]?.name || 'Adventure';
        const ics = [
            'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Roam//EN','BEGIN:VEVENT',
            `UID:${Date.now()}@weekend-adventure`,`DTSTAMP:${toICSDate(new Date())}`,
            `DTSTART:${toICSDate(start)}`,`DTEND:${toICSDate(end)}`,
            `SUMMARY:${summary}`,`LOCATION:${loc}`,`DESCRIPTION:${desc.replace(/\n/g,'\\n')}`,'END:VEVENT','END:VCALENDAR'
        ].join('\r\n');
        const blob = new Blob([ics], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'adventure.ics'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-selected', 'false');
            btn.setAttribute('tabindex', '-1');
        });
        const activeBtn = document.getElementById(`${tabName}-tab`);
        if (activeBtn) {
            activeBtn.classList.add('active');
            activeBtn.setAttribute('aria-selected', 'true');
            activeBtn.setAttribute('tabindex', '0');
        }

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
        document.getElementById(`${tabName}-mode`).classList.remove('hidden');

        // Load history if switching to history tab
        if (tabName === 'history') {
            this.loadAdventureHistory();
        }

        // Notify other components
        document.dispatchEvent(new CustomEvent('tabSwitched', { detail: { tabName } }));
    }

    async buildAdventure() {
        const time = parseInt(document.getElementById('available-time').value);
        const style = document.querySelector('.filter-btn.active').dataset.style;
        const location = window.randomPlacesFinder.currentLocation;

        if (!location) {
            window.randomPlacesFinder.showError('Please set your location first in the Single Place tab.');
            return;
        }

        window.randomPlacesFinder.showLoading('Building your perfect adventure...');

        try {
            const adventure = await this.generateAdventure(location, time, style);
            this.displayAdventurePlan(adventure);
        } catch (error) {
            console.error('Adventure building error:', error);
            window.randomPlacesFinder.showError('Failed to build adventure. Please try again.');
        }
    }

    async buildMysteryAdventure() {
        const time = parseInt(document.getElementById('available-time').value);
        const styles = ['mixed', 'food-focused', 'sightseeing', 'active'];
        const randomStyle = styles[Math.floor(Math.random() * styles.length)];
        const location = window.randomPlacesFinder.currentLocation;

        if (!location) {
            window.randomPlacesFinder.showError('Please set your location first in the Single Place tab.');
            return;
        }

        window.randomPlacesFinder.showLoading('Creating mysterious adventure...');

        try {
            const adventure = await this.generateAdventure(location, time, randomStyle, true);
            this.displayAdventurePlan(adventure, true);
        } catch (error) {
            console.error('Mystery adventure error:', error);
            window.randomPlacesFinder.showError('Failed to create mystery adventure. Please try again.');
        }
    }

    async surpriseMe() {
        const themes = Object.keys(this.themes);
        const randomTheme = themes[Math.floor(Math.random() * themes.length)];
        const themeSelect = document.getElementById('adventure-theme');
        if (themeSelect) {
            themeSelect.value = randomTheme;
        }

        const types = ['restaurant', 'tourist_attraction'];
        const randomType = types[Math.floor(Math.random() * types.length)];

        if (window.randomPlacesFinder) {
            await window.randomPlacesFinder.findRandomPlace(randomType);
        }
    }

    async generateAdventure(location, timeHours, style, isMystery = false) {
        const range = document.getElementById('range').value;
        const stopsCount = Math.min(Math.floor(timeHours / 1.5) + 1, 5); // 1.5 hours per stop max
        
        let places = [];
        const attempts = Math.max(stopsCount * 3, 10); // Try to get more options

        // Determine types based on style
        let searchTypes;
        switch (style) {
            case 'food-focused':
                searchTypes = ['restaurant', 'restaurant', 'cafe'];
                break;
            case 'sightseeing':
                searchTypes = ['tourist_attraction', 'tourist_attraction', 'museum'];
                break;
            case 'active':
                searchTypes = ['park', 'tourist_attraction', 'viewpoint'];
                break;
            default:
                searchTypes = ['restaurant', 'tourist_attraction'];
        }

        // Fetch places of different types
        for (let i = 0; i < attempts && places.length < stopsCount * 2; i++) {
            const type = searchTypes[i % searchTypes.length];
            try {
                if (window.randomPlacesFinder && window.randomPlacesFinder.searchNearbyPlaces) {
                    const newPlaces = await window.randomPlacesFinder.searchNearbyPlaces(location, type, range);
                    if (newPlaces && newPlaces.length > 0) {
                        places = places.concat(newPlaces);
                    }
                }
            } catch (error) {
                console.error('Error fetching places for adventure:', error);
            }
        }

        if (places.length === 0) {
            throw new Error('No places found for adventure');
        }

        // Remove duplicates and select diverse places
        const uniquePlaces = this.removeDuplicates(places);
        const selectedPlaces = this.selectDiversePlaces(uniquePlaces, stopsCount);

        // Optimize route
        const optimizedRoute = this.optimizeRoute(location, selectedPlaces);

        // Calculate timing
        const timing = this.calculateTiming(optimizedRoute, timeHours);

        return {
            id: Date.now(),
            places: optimizedRoute,
            timing: timing,
            style: style,
            totalTime: timeHours,
            isMystery: isMystery,
            created: new Date().toISOString()
        };
    }

    removeDuplicates(places) {
        const seen = new Set();
        return places.filter(place => {
            const key = `${place.name}-${place.address}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    selectDiversePlaces(places, count) {
        if (places.length <= count) return places;

        // Sort by distance and rating
        places.sort((a, b) => {
            const distanceWeight = parseFloat(a.distance) - parseFloat(b.distance);
            const ratingWeight = (parseFloat(b.rating) - parseFloat(a.rating)) * 2;
            return distanceWeight + ratingWeight;
        });

        // Select diverse places (avoid too many of same type)
        const selected = [];
        const typeCount = {};

        for (const place of places) {
            if (selected.length >= count) break;
            
            const type = place.type || 'unknown';
            typeCount[type] = (typeCount[type] || 0);
            
            // Limit same type to max 2 places
            if (typeCount[type] < 2) {
                selected.push(place);
                typeCount[type]++;
            }
        }

        // Fill remaining slots if needed
        while (selected.length < count && selected.length < places.length) {
            for (const place of places) {
                if (selected.length >= count) break;
                if (!selected.includes(place)) {
                    selected.push(place);
                }
            }
        }

        return selected;
    }

    optimizeRoute(startLocation, places) {
        if (places.length <= 2) return places;

        // Simple nearest neighbor optimization
        const optimized = [];
        let currentLocation = startLocation;
        const remaining = [...places];

        while (remaining.length > 0) {
            let nearest = remaining[0];
            let nearestIndex = 0;
            let minDistance = this.calculateDistanceToPlace(currentLocation, nearest);

            for (let i = 1; i < remaining.length; i++) {
                const distance = this.calculateDistanceToPlace(currentLocation, remaining[i]);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearest = remaining[i];
                    nearestIndex = i;
                }
            }

            optimized.push(nearest);
            currentLocation = { lat: nearest.lat, lng: nearest.lng };
            remaining.splice(nearestIndex, 1);
        }

        return optimized;
    }

    calculateDistanceToPlace(location, place) {
        if (window.randomPlacesFinder && window.randomPlacesFinder.calculateDistance) {
            return window.randomPlacesFinder.calculateDistance(
                location.lat, location.lng,
                place.lat || location.lat, place.lng || location.lng
            );
        }
        // Fallback distance calculation
        const lat1 = location.lat;
        const lon1 = location.lng;
        const lat2 = place.lat || location.lat;
        const lon2 = place.lng || location.lng;
        
        const R = 6371; // Radius of the Earth in kilometers
        const dLat = (lat2 - lat1) * (Math.PI/180);
        const dLon = (lon2 - lon1) * (Math.PI/180);
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    calculateTiming(places, totalHours) {
        const timePerPlace = Math.floor((totalHours * 60) / places.length); // minutes per place
        const driveTime = 15; // estimated drive time between places
        const stayTime = Math.max(timePerPlace - driveTime, 30); // minimum 30 min stay

        return {
            timePerPlace: timePerPlace,
            stayTime: stayTime,
            driveTime: driveTime,
            totalPlaces: places.length
        };
    }

    displayAdventurePlan(adventure, isMystery = false) {
        window.randomPlacesFinder.hideLoading();
        this.currentAdventure = adventure;

        const planContainer = document.getElementById('adventure-plan');
        const stopsContainer = document.getElementById('adventure-stops');
        
        planContainer.classList.remove('hidden');

        const totalMinutes = (adventure.totalTime || 1) * 60;
        const perStop = Math.max(20, Math.floor(totalMinutes / Math.max(1, adventure.places.length)) - 15);

        let html = `
            <div class="adventure-summary">
                <div class="summary-item">
                    <span class="summary-icon">🎯</span>
                    <span>${adventure.places.length} stops</span>
                </div>
                <div class="summary-item">
                    <span class="summary-icon">⏱️</span>
                    <span>${adventure.totalTime} hours</span>
                </div>
                <div class="summary-item">
                    <span class="summary-icon">📍</span>
                    <span>${perStop} min per stop</span>
                </div>
            </div>
        `;

        adventure.places.forEach((place, index) => {
            html += `
                <div class="adventure-stop" data-index="${index}">
                    <div class="stop-number">${index + 1}</div>
                    <div class="stop-content">
                        <h4>${isMystery ? '🎭 Mystery Stop ' + (index + 1) : place.name}</h4>
                        <p class="stop-address">${isMystery ? 'Address revealed when you start!' : place.address}</p>
                        <div class="stop-meta">
                            <span>📍 ${place.distance} km</span>
                            <span>⏱️ ${perStop} min visit</span>
                        </div>
                    </div>
                    <div class="stop-actions">
                        ${!isMystery ? `<button class="small-btn" onclick="window.adventurePlanner.getStopDirections(${index})">🗺️</button>` : ''}
                        <button class="small-btn" onclick="window.adventurePlanner.removeStop(${index})" aria-label="Remove stop ${index + 1}">❌</button>
                    </div>
                </div>
            `;
        });

        stopsContainer.innerHTML = html;
    }

    startAdventure() {
        if (!this.currentAdventure) return;

        document.getElementById('adventure-tracker').classList.remove('hidden');
        this.updateAdventureProgress();
        
        // Save adventure start
        const storage = window.storageManager;
        storage.startAdventure(this.currentAdventure);

        // Hide adventure builder
        document.getElementById('adventure-plan').classList.add('hidden');
        
        this.showSuccess('🚀 Adventure started! Safe travels!');
    }

    updateAdventureProgress() {
        if (!this.currentAdventure) return;

        const progressContainer = document.getElementById('adventure-progress');
        const visited = window.storageManager.getVisitedPlaces();
        
        let html = '<div class="progress-stops">';
        
        this.currentAdventure.places.forEach((place, index) => {
            const isVisited = visited.some(v => v.name === place.name);
            html += `
                <div class="progress-stop ${isVisited ? 'visited' : ''}">
                    <span class="stop-indicator">${isVisited ? '✅' : index + 1}</span>
                    <span class="stop-name">${place.name}</span>
                </div>
            `;
        });
        
        html += '</div>';
        progressContainer.innerHTML = html;
    }

    endAdventure() {
        if (!this.currentAdventure) return;

        const visited = window.storageManager.getVisitedPlaces();
        const adventurePlaces = this.currentAdventure.places.filter(place => 
            visited.some(v => v.name === place.name)
        );

        // Calculate score
        const score = adventurePlaces.length * 10 + Math.floor(Math.random() * 20);
        
        // Save completed adventure
        window.storageManager.completeAdventure(this.currentAdventure, adventurePlaces, score);

        // Update stats
        this.updateStats();

        // Hide tracker
        document.getElementById('adventure-tracker').classList.add('hidden');
        
        // Show completion message
        this.showSuccess(`🎉 Adventure completed! You visited ${adventurePlaces.length}/${this.currentAdventure.places.length} places and earned ${score} points!`);
        // Subtle confetti celebration
        try { window.animationsManager?.showConfetti(); } catch (e) {}
        
        this.currentAdventure = null;
    }

    addPlaceToAdventure() {
        const currentPlace = window.randomPlacesFinder.currentPlace;
        if (!currentPlace) return;
        // Avoid duplicates
        const exists = this.adventurePlaces.some(p => window.randomPlacesFinder.isSamePlace(p, currentPlace));
        if (!exists) {
            this.adventurePlaces.push(currentPlace);
            this.showSuccess('📍 Place added to your adventure list!');
        }
        // Update button state to allow remove
        const addBtn = document.getElementById('add-to-adventure');
        if (addBtn) {
            addBtn.textContent = exists ? '✅ Added' : '✅ Added';
            addBtn.disabled = false;
            addBtn.dataset.added = 'true';
            addBtn.title = 'Tap to remove from adventure';
        }
    }

    toggleCurrentPlaceInAdventure() {
        const currentPlace = window.randomPlacesFinder.currentPlace;
        if (!currentPlace) return;
        const idx = this.adventurePlaces.findIndex(p => window.randomPlacesFinder.isSamePlace(p, currentPlace));
        const addBtn = document.getElementById('add-to-adventure');
        if (idx >= 0) {
            this.adventurePlaces.splice(idx, 1);
            this.showSuccess('❌ Removed from adventure');
            if (addBtn) { addBtn.textContent = '➕ Add to Adventure'; addBtn.dataset.added = 'false'; addBtn.title = 'Add this place to current adventure'; }
        } else {
            this.addPlaceToAdventure();
        }
    }

    removeStop(index) {
        if (this.currentAdventure) {
            this.currentAdventure.places.splice(index, 1);
            this.displayAdventurePlan(this.currentAdventure, this.currentAdventure.isMystery);
            return;
        }
        // If no current plan, allow removing from pending list
        if (index >= 0 && index < this.adventurePlaces.length) {
            this.adventurePlaces.splice(index, 1);
            this.showSuccess('❌ Removed from adventure');
        }
    }

    markPlaceVisited() {
        const currentPlace = window.randomPlacesFinder.currentPlace;
        if (!currentPlace) return;

        window.storageManager.addVisitedPlace(currentPlace);
        this.updateStats();
        this.updateAdventureProgress();
        
        // Show note option
        document.querySelector('.place-notes').classList.remove('hidden');
        
        // Update button
        document.getElementById('mark-visited').textContent = '✅ Visited';
        document.getElementById('mark-visited').disabled = true;
        
        this.showSuccess('🎉 Place marked as visited! +10 points');
    }

    savePlaceNote() {
        const currentPlace = window.randomPlacesFinder.currentPlace;
        const note = document.getElementById('place-note').value.trim();
        
        if (!currentPlace || !note) return;

        window.storageManager.addPlaceNote(currentPlace, note);
        document.getElementById('place-note').value = '';
        document.querySelector('.place-notes').classList.add('hidden');
        
        this.showSuccess('📝 Note saved!');
    }

    getStopDirections(index) {
        if (!this.currentAdventure || !this.currentAdventure.places[index]) return;
        
        const place = this.currentAdventure.places[index];
        let destination;
        
        if (place.lat && place.lng) {
            destination = `${place.lat},${place.lng}`;
        } else {
            destination = encodeURIComponent(place.address);
        }
        
        const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
        window.open(url, '_blank');
    }

    // Repeat a previously saved adventure by id
    repeatAdventure(adventureId) {
        try {
            const list = window.storageManager.getSavedAdventures();
            const adv = list.find(a => String(a.id) === String(adventureId));
            if (!adv) return;
            this.currentAdventure = adv;
            // Ensure we are on the adventure tab and show plan
            this.switchTab('adventure');
            this.displayAdventurePlan(adv, !!adv.isMystery);
            this.showSuccess('🔁 Adventure loaded');
        } catch (e) {
            console.error('Failed to repeat adventure:', e);
        }
    }

    // Local success helper for consistent feedback
    showSuccess(message) {
        if (window.pwaManager && typeof window.pwaManager.showToast === 'function') {
            window.pwaManager.showToast(message, 'success');
            return;
        }
        const div = document.createElement('div');
        div.textContent = message;
        div.style.cssText = 'position:fixed;top:16px;right:16px;background:#10b981;color:#fff;padding:8px 12px;border-radius:8px;z-index:9999;font-size:14px;';
        document.body.appendChild(div);
        setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 2000);
    }

    saveAdventure() {
        if (!this.currentAdventure) return;
        
        window.storageManager.saveAdventure(this.currentAdventure);
        this.showSuccess('💾 Adventure saved!');
    }

    resetAdventureBuilder() {
        this.currentAdventure = null;
        document.getElementById('adventure-plan').classList.add('hidden');
    }

    updateStats() {
        try {
            const stats = window.storageManager.getStats();
            console.log('Updating stats with:', stats);
            
            const placesElement = document.getElementById('places-visited');
            const scoreElement = document.getElementById('adventure-score');
            const streakElement = document.getElementById('current-streak');
            
            console.log('Found elements:', { placesElement, scoreElement, streakElement });
            
            if (placesElement) {
                placesElement.textContent = stats.placesVisited;
                console.log('Set places to:', stats.placesVisited);
            }
            if (scoreElement) {
                scoreElement.textContent = stats.totalScore;
                console.log('Set score to:', stats.totalScore);
            }
            if (streakElement) {
                streakElement.textContent = stats.currentStreak;
                console.log('Set streak to:', stats.currentStreak);
            }
            
            // Get units for distance calculations
            const units = localStorage.getItem('units') || 'metric';
            
            // Only update distance if the element exists
            const distanceElement = document.getElementById('total-distance');
            if (distanceElement) {
                const distVal = units === 'imperial' ? (stats.totalDistance * 0.621371).toFixed(1) : stats.totalDistance.toFixed(1);
                distanceElement.textContent = distVal;
            }
            
            const unitLabel = document.getElementById('distance-unit-label');
            if (unitLabel) unitLabel.textContent = units === 'imperial' ? 'mi Traveled' : 'km Traveled';
        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }

    loadAdventureHistory() {
        try {
            const adventures = window.storageManager.getSavedAdventures();
            const stats = window.storageManager.getStats();
            
            // Get units for distance calculations
            const units = localStorage.getItem('units') || 'metric';
            
            // Update stats
            const totalAdventuresElement = document.getElementById('total-adventures');
            if (totalAdventuresElement) {
                totalAdventuresElement.textContent = stats.totalAdventures;
            }
            
            const distanceElement = document.getElementById('total-distance');
            if (distanceElement) {
                const distVal = units === 'imperial' ? (stats.totalDistance * 0.621371).toFixed(1) : stats.totalDistance.toFixed(1);
                distanceElement.textContent = distVal;
            }
            
            const unitLabel = document.getElementById('distance-unit-label');
            if (unitLabel) unitLabel.textContent = units === 'imperial' ? 'mi Traveled' : 'km Traveled';
            
            const favoriteTypeElement = document.getElementById('favorite-type');
            if (favoriteTypeElement) {
                favoriteTypeElement.textContent = stats.favoriteType || '-';
            }
            
            // Load adventure list
            const listContainer = document.getElementById('adventure-list');
            if (!listContainer) return;
            
            if (adventures.length === 0) {
                listContainer.innerHTML = '<p class="empty-state">🎯 Start your first adventure to see your history!</p>';
                return;
            }
            
            let html = '';
            adventures.slice(-10).reverse().forEach(adventure => { // Show last 10
                const date = new Date(adventure.created).toLocaleDateString();
                html += `
                    <div class="history-item">
                        <div class="history-content">
                            <h4>🗺️ ${adventure.places.length}-stop adventure</h4>
                            <p>📅 ${date} • ⭐ ${adventure.score || 0} points</p>
                        </div>
                        <button class="small-btn" onclick="window.adventurePlanner.repeatAdventure('${adventure.id}')">🔄</button>
                    </div>
                `;
            });
            
            listContainer.innerHTML = html;
        } catch (error) {
            console.error('Error loading adventure history:', error);
        }
    }
}

// Initialization moved to init.js
// Expose class on global for init check
window.AdventurePlanner = window.AdventurePlanner || AdventurePlanner;