class RandomPlacesFinder {
    constructor() {
        this.currentLocation = null;
        this.lastSearchType = null;
        this.lastRange = null;
        this.currentPlace = null;
        this.isSearching = false;
        this.activeChips = []; // Initialize active chips array
        this.units = localStorage.getItem('units') || 'metric'; // Initialize units
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        document.getElementById('use-current-location').addEventListener('click', () => {
            this.getCurrentLocation();
        });

        document.getElementById('find-attraction').addEventListener('click', () => {
            this.findRandomPlace('tourist_attraction');
        });

        document.getElementById('find-restaurant').addEventListener('click', () => {
            this.findRandomPlace('restaurant');
        });

        document.getElementById('get-directions').addEventListener('click', () => {
            this.getDirections();
        });

        document.getElementById('find-another').addEventListener('click', () => {
            if (this.lastSearchType && this.lastRange) {
                this.findRandomPlace(this.lastSearchType);
            }
        });

        // Analytics for actions
        const a = (name) => { try { if (typeof window.va === 'function' && window.__vaReady && document.hasStoredUserActivation) window.va('event', { type: name }); } catch(e) {} };
        document.getElementById('get-directions').addEventListener('click', () => a('get_directions'));
        document.getElementById('add-to-adventure').addEventListener('click', () => {
            const btn = document.getElementById('add-to-adventure');
            if (btn?.dataset.added === 'true') {
                window.adventurePlanner?.toggleCurrentPlaceInAdventure();
            } else {
                window.adventurePlanner?.addPlaceToAdventure();
                a('add_to_adventure');
            }
        });
        document.getElementById('mark-visited').addEventListener('click', () => a('mark_visited'));

        // Check if adventure planner elements exist before adding listeners
        const surpriseBtn = document.getElementById('surprise-me');
        if (surpriseBtn) {
            surpriseBtn.addEventListener('click', () => {
                this.surpriseMe();
            });
        }

        document.getElementById('try-again').addEventListener('click', () => {
            this.hideError();
        });

        // Range slider live label
        const range = document.getElementById('range');
        const rangeValue = document.getElementById('range-value');
        if (range && rangeValue) {
            const updateLabel = () => {
                const meters = parseInt(range.value, 10) || 0;
                const km = meters / 1000;
                const units = this.units || localStorage.getItem('units') || 'metric';
                if (units === 'imperial') {
                    const miles = (km * 0.621371).toFixed(1);
                    rangeValue.textContent = `${miles} mi`;
                } else {
                    rangeValue.textContent = `${km.toFixed(1)} km`;
                }
            };
            range.addEventListener('input', updateLabel);
            updateLabel();
        }

        // Location input field - convert coordinates to addresses
        const locationInput = document.getElementById('location');
        if (locationInput) {
            locationInput.addEventListener('blur', async () => {
                const inputValue = locationInput.value.trim();
                if (inputValue) {
                    // Check if it's coordinates and convert to address
                    const coordResult = await this.convertCoordinatesToAddress(inputValue);
                    if (coordResult) {
                        // Show loading while converting
                        this.showLoading('Converting coordinates to address...');
                        
                        // Update the input with the readable address
                        locationInput.value = coordResult.address;
                        // Set the current location
                        this.currentLocation = { lat: coordResult.lat, lng: coordResult.lng };
                        
                        this.hideLoading();
                        this.showSuccess(`Location set to: ${coordResult.address}`);
                        
                        // Update location info with coordinates
                        this.updateLocationInfo(coordResult.lat, coordResult.lng);
                        
                        // Notify other components about location update
                        document.dispatchEvent(new CustomEvent('locationUpdated', {
                            detail: { location: this.currentLocation }
                        }));
                    }
                }
            });
        }

        // Quick filter chips (multi-select + clear)
        const chipButtons = Array.from(document.querySelectorAll('.chip-btn'));
        const restoreActive = new Set((localStorage.getItem('activeChips') || '').split(',').filter(Boolean));
        
        console.log('Found chip buttons:', chipButtons.length);
        console.log('Restored active chips:', restoreActive);
        
        // Initialize chip buttons with proper event listeners
        chipButtons.forEach(btn => {
            if (btn.dataset.clear === 'true') return;
            
            // Restore active state from localStorage
            if (restoreActive.has(btn.textContent)) {
                btn.classList.add('active');
            }
            
            // Add single event listener for each chip button
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                console.log('Chip button clicked:', btn.textContent, btn.dataset);
                
                // Toggle active state
                btn.classList.toggle('active');
                const isActive = btn.classList.contains('active');
                console.log('Chip button active state:', isActive);
                
                // Update localStorage
                const activeLabels = chipButtons
                    .filter(b => b.dataset.clear !== 'true' && b.classList.contains('active'))
                    .map(b => b.textContent);
                
                console.log('Active chips:', activeLabels);
                
                try { 
                    localStorage.setItem('activeChips', activeLabels.join(',')); 
                    console.log('Saved to localStorage:', activeLabels.join(','));
                } catch (e) {
                    console.warn('Failed to save chip selection to localStorage');
                }
                
                // Update search summary
                this.updateSearchSummary();
                
                // Run search if we have active chips
                if (activeLabels.length > 0) {
                    console.log('Running chip search with:', activeLabels);
                    await this.runChipsSearch();
                } else {
                    console.log('No active chips, skipping search');
                }
            });
            
            // Add touchstart as fallback for mobile
            btn.addEventListener('touchstart', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                console.log('Chip button touched:', btn.textContent, btn.dataset);
                
                // Toggle active state
                btn.classList.toggle('active');
                const isActive = btn.classList.contains('active');
                console.log('Chip button active state (touch):', isActive);
                
                // Update localStorage
                const activeLabels = chipButtons
                    .filter(b => b.dataset.clear !== 'true' && b.classList.contains('active'))
                    .map(b => b.textContent);
                
                console.log('Active chips (touch):', activeLabels);
                
                try { 
                    localStorage.setItem('activeChips', activeLabels.join(',')); 
                    console.log('Saved to localStorage (touch):', activeLabels.join(','));
                } catch (e) {
                    console.warn('Failed to save chip selection to localStorage');
                }
                
                // Update search summary
                this.updateSearchSummary();
                
                // Run search if we have active chips
                if (activeLabels.length > 0) {
                    console.log('Running chip search with (touch):', activeLabels);
                    await this.runChipsSearch();
                } else {
                    console.log('No active chips, skipping search (touch)');
                }
            });
        });

        // Update search summary when theme changes
        const themeSelect = document.getElementById('adventure-theme');
        if (themeSelect) {
            themeSelect.addEventListener('change', () => {
                this.updateSearchSummary();
            });
        }

        // Prevent double-tap zoom on chip area (mobile safari)
        const chipRow = document.querySelector('.quick-filters');
        if (chipRow) {
            chipRow.addEventListener('touchend', (e) => {
                if (e.target.closest('.chip-btn')) {
                    e.preventDefault(); // avoid double-tap zoom/layout shift
                }
            }, { passive: false });
        }

        // Clear chip resets selections
        const clearChip = document.querySelector('.chip-btn.clear-chip');
        if (clearChip) {
            clearChip.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Remove active class from all chips
                chipButtons.forEach(b => b.classList.remove('active'));
                
                // Clear localStorage
                localStorage.removeItem('activeChips');
                
                // Reset activeChips property
                this.activeChips = [];
                
                // Update search summary
                this.updateSearchSummary();
                
                // Show feedback
                this.showSuccess('Filters cleared!');
                
                // If we have a location, find a random place
                if (this.currentLocation) {
                    await this.findRandomPlace('tourist_attraction');
                }
            });
        }

        // Auto-run if we already have location and chips
        try {
            if (this.currentLocation && (localStorage.getItem('activeChips') || '').length) {
                setTimeout(() => this.runChipsSearch(), 300);
            }
        } catch (e) {}
        
        // Initialize search summary
        this.updateSearchSummary();

        // Settings panel toggle
        const settingsBtn = document.getElementById('settings-toggle');
        const settingsPanel = document.getElementById('settings-panel');
        const settingsClose = document.getElementById('settings-close');
        const settingsBackdrop = document.getElementById('settings-backdrop');
        
        const openSettings = () => {
            settingsPanel?.classList.add('show');
            settingsBackdrop?.classList.add('show');
            document.body.style.overflow = 'hidden';
            
            // Premium haptic feedback
            try { 
                if (navigator.vibrate && document.hasStoredUserActivation) {
                    navigator.vibrate([5, 10, 5]); // Subtle double tap
                }
            } catch(e) {}
        };
        
        const closeSettings = () => {
            settingsPanel?.classList.remove('show');
            settingsBackdrop?.classList.remove('show');
            document.body.style.overflow = '';
            
            // Subtle close feedback
            try { 
                if (navigator.vibrate && document.hasStoredUserActivation) {
                    navigator.vibrate(3); // Single gentle tap
                }
            } catch(e) {}
        };
        
        if (settingsBtn && settingsPanel) {
            let settingsClickCount = 0;
            let settingsClickTimer = null;
            
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsClickCount++;
                
                // Easter egg: Triple click for premium animation
                if (settingsClickCount === 3) {
                    settingsBtn.style.animation = 'pulseGlow 1s ease-in-out';
                    setTimeout(() => {
                        settingsBtn.style.animation = '';
                    }, 1000);
                    settingsClickCount = 0;
                }
                
                clearTimeout(settingsClickTimer);
                settingsClickTimer = setTimeout(() => {
                    settingsClickCount = 0;
                }, 1000);
                
                if (settingsPanel.classList.contains('show')) {
                    closeSettings();
                } else {
                    openSettings();
                }
            });
            
            if (settingsClose) {
                settingsClose.addEventListener('click', closeSettings);
            }
            
            if (settingsBackdrop) {
                settingsBackdrop.addEventListener('click', closeSettings);
            }
            
            // Close settings when pressing Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && settingsPanel.classList.contains('show')) {
                    closeSettings();
                }
            });
        }

        // Units toggle (metric/imperial)
        const unitsBtn = document.getElementById('units-toggle');
        if (unitsBtn) {
            const storedUnits = localStorage.getItem('units') || 'metric';
            this.setUnits(storedUnits);
            unitsBtn.textContent = this.units === 'imperial' ? 'mi' : 'km';
            unitsBtn.addEventListener('click', () => {
                this.setUnits(this.units === 'imperial' ? 'metric' : 'imperial');
                unitsBtn.textContent = this.units === 'imperial' ? 'mi' : 'km';
                // Re-render current place and stats with new units
                if (this.currentPlace) this.displayPlace(this.currentPlace);
                if (window.adventurePlanner?.updateStats) window.adventurePlanner.updateStats();
                // Update range label units
                const range = document.getElementById('range');
                range?.dispatchEvent(new Event('input'));
            });
        }

        // Adventure style pills (visual + functional feedback)
        const styleButtons = Array.from(document.querySelectorAll('.adventure-type .filter-btn'));
        if (styleButtons.length) {
            const mapStyleToTheme = {
                'mixed': 'any',
                'food-focused': 'foodie',
                'sightseeing': 'photo',
                'active': 'nature'
            };
            const themeSelect = document.getElementById('adventure-theme');
            const setActiveStyle = (btn) => {
                styleButtons.forEach(b => {
                    const isActive = b === btn;
                    b.classList.toggle('active', isActive);
                    b.setAttribute('aria-pressed', String(isActive));
                });
                const style = btn.getAttribute('data-style');
                try { localStorage.setItem('adventure_style', style); } catch (e) {}
                if (themeSelect && mapStyleToTheme[style]) {
                    themeSelect.value = mapStyleToTheme[style];
                }
                // Subtle haptic feedback (only after user interaction)
                try { 
                    if (navigator.vibrate && document.hasStoredUserActivation) {
                        navigator.vibrate(10); 
                    }
                } catch(e) {}
                try { window.pwaManager?.showToast(`Style set: ${btn.textContent.trim()}`, 'info'); } catch(e) {}
            };
            // Restore saved style or default
            const savedStyle = (localStorage.getItem('adventure_style') || 'mixed');
            const initialBtn = styleButtons.find(b => b.getAttribute('data-style') === savedStyle) || styleButtons[0];
            if (initialBtn) setActiveStyle(initialBtn);
            styleButtons.forEach(b => b.addEventListener('click', () => setActiveStyle(b)));
        }
    }

    updateSearchSummary() {
        const themeElement = document.getElementById('current-theme');
        const filtersElement = document.getElementById('current-filters');
        
        if (themeElement) {
            const themeSelect = document.getElementById('adventure-theme');
            const theme = themeSelect ? themeSelect.value : 'any';
            const themeLabels = {
                'any': '🎲 Any',
                'foodie': '🍕 Foodie Tour',
                'historic': '🏛️ Historic Journey',
                'nature': '🌲 Nature Escape',
                'culture': '🎭 Culture Quest',
                'hidden': '💎 Hidden Gems',
                'photo': '📸 Photo Safari'
            };
            themeElement.textContent = themeLabels[theme] || '🎲 Any';
        }
        
        if (filtersElement) {
            const activeChips = Array.from(document.querySelectorAll('.chip-btn.active'));
            if (activeChips.length === 0) {
                filtersElement.textContent = 'None selected';
            } else {
                const chipLabels = activeChips.map(c => c.textContent).join(', ');
                filtersElement.textContent = chipLabels;
            }
        }
    }

    async runChipsSearch() {
        try {
            // Aggregate selected chips to choose category/type
            const activeChips = Array.from(document.querySelectorAll('.chip-btn.active'));
            
            if (activeChips.length === 0) {
                this.showError('Please select at least one filter category first.');
                return;
            }
            
            // Store active chips for use in search
            this.activeChips = activeChips;
            
            // Show which filters are active
            const activeLabels = activeChips.map(c => c.textContent).join(', ');
            this.showSuccess(`Searching with filters: ${activeLabels}`);
            
            // If any restaurant chip active, run restaurant search; otherwise attraction
            const isRestaurant = activeChips.some(c => c.getAttribute('data-category') === 'restaurant');
            const searchType = isRestaurant ? 'restaurant' : 'tourist_attraction';
            
            // Run the search
            await this.findRandomPlace(searchType);
            
        } catch (error) {
            console.error('Error in runChipsSearch:', error);
            this.showError('Failed to run chip search. Please try again.');
        }
    }

    setUnits(units) {
        this.units = units;
        localStorage.setItem('units', units);
    }

    formatDistanceKm(km) {
        const units = this.units || localStorage.getItem('units') || 'metric';
        if (units === 'imperial') {
            const miles = (parseFloat(km) * 0.621371).toFixed(1);
            return { text: `${miles} mi`, value: miles };
        }
        return { text: `${parseFloat(km).toFixed(1)} km`, value: parseFloat(km).toFixed(1) };
    }

    surpriseMe() {
        // Apply random theme first
        const themeSelect = document.getElementById('adventure-theme');
        if (themeSelect) {
            const themes = ['any', 'foodie', 'historic', 'nature', 'culture', 'hidden', 'photo'];
            const randomTheme = themes[Math.floor(Math.random() * themes.length)];
            themeSelect.value = randomTheme;
            
            // Show what theme was selected
            const themeLabels = {
                'any': '🎲 Any theme',
                'foodie': '🍕 Foodie theme',
                'historic': '🏛️ Historic theme',
                'nature': '🌲 Nature theme',
                'culture': '🎭 Culture theme',
                'hidden': '💎 Hidden gems theme',
                'photo': '📸 Photo theme'
            };
            this.showSuccess(`Surprise theme selected: ${themeLabels[randomTheme]}`);
        }
        
        // Randomly choose between restaurant and attraction
        const types = ['restaurant', 'tourist_attraction'];
        const randomType = types[Math.floor(Math.random() * types.length)];
        
        // Clear any active chips for a true surprise
        if (this.activeChips) {
            this.activeChips.forEach(chip => chip.classList.remove('active'));
            this.activeChips = [];
        }
        
        this.showSuccess('🎁 Surprise mode activated! Finding a random place...');
        this.findRandomPlace(randomType);
    }

    updateLocationInfo(lat, lng) {
        const locationInfo = document.getElementById('location-info');
        if (locationInfo && lat && lng) {
            // Store coordinates but don't display them by default
            locationInfo.textContent = `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            locationInfo.className = 'location-info coordinates';
            // Don't show by default - coordinates are stored but hidden
            
            // Log for developers (can be removed in production)
            console.log(`Coordinates stored: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
            console.log('To show coordinates: window.randomPlacesFinder.showCoordinates()');
        }
    }

    // Utility function to show coordinates if needed (for debugging)
    showCoordinates() {
        const locationInfo = document.getElementById('location-info');
        if (locationInfo && locationInfo.classList.contains('coordinates')) {
            locationInfo.classList.add('show-coordinates');
        }
    }

    // Utility function to hide coordinates
    hideCoordinates() {
        const locationInfo = document.getElementById('location-info');
        if (locationInfo) {
            locationInfo.classList.remove('show-coordinates');
        }
    }

    getCurrentLocation() {
        this.showLoading('Getting your location...');

        if (!navigator.geolocation) {
            this.showError('Geolocation is not supported by this browser.');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                this.currentLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                
                // Try to get a human-readable address from coordinates
                let readableAddress = null;
                try {
                    readableAddress = await this.getAddressFromCoordinates(
                        this.currentLocation.lat, 
                        this.currentLocation.lng
                    );
                } catch (error) {
                    console.warn('Could not get address from coordinates:', error);
                }
                
                // Update the location input with readable address or coordinates as fallback
                const locationInput = document.getElementById('location');
                if (locationInput) {
                    if (readableAddress) {
                        locationInput.value = readableAddress;
                        this.showSuccess(`Location found: ${readableAddress}`);
                    } else {
                        // Fallback to coordinates if address lookup fails
                        locationInput.value = `${this.currentLocation.lat.toFixed(6)}, ${this.currentLocation.lng.toFixed(6)}`;
                        this.showSuccess('Location found! You can now search for places.');
                    }
                }
                
                // Update location info with coordinates
                this.updateLocationInfo(this.currentLocation.lat, this.currentLocation.lng);
                
                // Notify other components about location update
                document.dispatchEvent(new CustomEvent('locationUpdated', {
                    detail: { location: this.currentLocation }
                }));
                
                this.hideLoading();
            },
            (error) => {
                this.hideLoading();
                let errorMessage = 'Unable to get your location. ';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage += 'Please allow location access.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage += 'Location information unavailable.';
                        break;
                    case error.TIMEOUT:
                        errorMessage += 'Location request timed out.';
                        break;
                    default:
                        errorMessage += 'An unknown error occurred.';
                        break;
                }
                this.showError(errorMessage);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 300000
            }
        );
    }

    async getAddressFromCoordinates(lat, lng) {
        try {
            // Using Nominatim reverse geocoding to get address from coordinates
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`);
            
            if (!response.ok) {
                throw new Error('Reverse geocoding failed');
            }
            
            const data = await response.json();
            
            if (data && data.display_name) {
                // Extract the most relevant parts of the address
                const addressParts = data.display_name.split(', ');
                
                // Try to get a concise address (city, state, country)
                let readableAddress = '';
                
                if (data.address) {
                    // Build a readable address from components
                    const components = data.address;
                    
                    if (components.city) {
                        readableAddress = components.city;
                    } else if (components.town) {
                        readableAddress = components.town;
                    } else if (components.village) {
                        readableAddress = components.village;
                    } else if (components.suburb) {
                        readableAddress = components.suburb;
                    }
                    
                    if (components.state && readableAddress) {
                        readableAddress += `, ${components.state}`;
                    } else if (components.state) {
                        readableAddress = components.state;
                    }
                    
                    if (components.country && readableAddress) {
                        readableAddress += `, ${components.country}`;
                    } else if (components.country) {
                        readableAddress = components.country;
                    }
                }
                
                // Fallback to a shortened version of the full address if components are missing
                if (!readableAddress) {
                    const shortParts = addressParts.slice(-3); // Last 3 parts usually give city, state, country
                    readableAddress = shortParts.join(', ');
                }
                
                return readableAddress;
            } else {
                throw new Error('No address data available');
            }
        } catch (error) {
            console.error('Reverse geocoding error:', error);
            return null;
        }
    }

    async getLocationFromAddress(address) {
        try {
            // Using Nominatim (OpenStreetMap) for free geocoding
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
            
            if (!response.ok) {
                throw new Error('Geocoding failed');
            }
            
            const data = await response.json();
            
            if (data && data.length > 0) {
                const result = data[0];
                const location = {
                    lat: parseFloat(result.lat),
                    lng: parseFloat(result.lon)
                };
                
                // Update location info with coordinates
                this.updateLocationInfo(location.lat, location.lng);
                
                return location;
            } else {
                throw new Error('Location not found');
            }
        } catch (error) {
            console.error('Geocoding error:', error);
            return null;
        }
    }

    async findRandomPlace(type) {
        if (this.isSearching) {
            console.log('Search already in progress...');
            return;
        }
        
        this.isSearching = true;
        this.lastSearchType = type;
        this.lastRange = document.getElementById('range')?.value || 5000;

        let location = this.currentLocation;
        const locationInput = document.getElementById('location')?.value?.trim() || '';

        if (!location && locationInput) {
            this.showLoading('Finding location...');
            location = await this.getLocationFromAddress(locationInput);
            if (!location) {
                this.showError('Could not find the specified location. Please try a different address or use your current location.');
                this.isSearching = false;
                return;
            }
            this.currentLocation = location;
            // Notify other components about location update
            document.dispatchEvent(new CustomEvent('locationUpdated', {
                detail: { location: this.currentLocation }
            }));
        }

        if (!location) {
            this.showError('Please provide a location or use your current location.');
            this.isSearching = false;
            return;
        }

        // Apply theme filtering
        const theme = document.getElementById('adventure-theme')?.value || 'any';
        const filteredType = this.applyThemeFilter(type, theme);

        // Show what we're searching for
        let searchDescription = `Finding random ${type === 'restaurant' ? 'restaurant' : 'attraction'}`;
        if (theme !== 'any') {
            searchDescription += ` with ${theme} theme`;
        }
        if (this.activeChips && this.activeChips.length > 0) {
            const chipLabels = this.activeChips.map(c => c.textContent).join(', ');
            searchDescription += ` (${chipLabels})`;
        }
        this.showLoading(searchDescription + '...');

        try {
            const places = await this.searchNearbyPlaces(location, filteredType, this.lastRange);
            
            if (places && places.length > 0) {
                let filteredPlaces = this.filterPlacesByTheme(places, theme);
                
                if (filteredPlaces.length === 0) {
                    filteredPlaces = places; // Fallback to all places
                }
                
                const randomPlace = filteredPlaces[Math.floor(Math.random() * filteredPlaces.length)];
                this.displayPlace(randomPlace);
                this.isSearching = false;
            } else {
                this.showError(`No ${type === 'restaurant' ? 'restaurants' : 'attractions'} found in the specified range. Try increasing the search range.`);
                this.isSearching = false;
            }
        } catch (error) {
            console.error('Search error:', error);
            this.showError('Failed to search for places. Please try again.');
            this.isSearching = false;
        }
    }

    async searchNearbyPlaces(location, type, radius) {
        try {
            // Build Overpass query based on active chips and type
            let overpassQuery;
            
            if (type === 'restaurant') {
                // Use active chips to determine restaurant types
                const restaurantTypes = this.activeChips ? 
                    this.activeChips
                        .filter(c => c.getAttribute('data-category') === 'restaurant')
                        .map(c => c.getAttribute('data-types'))
                        .flatMap(types => types.split(','))
                        .filter(Boolean) : 
                    ['restaurant', 'cafe', 'bar'];
                
                const uniqueTypes = [...new Set(restaurantTypes)];
                const typeQueries = uniqueTypes.map(t => `node["amenity"="${t}"](around:${radius},${location.lat},${location.lng});`).join('\n');
                
                overpassQuery = `
                    [out:json][timeout:60];
                    (
                        ${typeQueries}
                    );
                    out geom;
                `;
            } else {
                // Use active chips to determine attraction types
                const attractionTypes = this.activeChips ? 
                    this.activeChips
                        .filter(c => c.getAttribute('data-category') === 'attraction')
                        .map(c => c.getAttribute('data-types'))
                        .flatMap(types => types.split(','))
                        .filter(Boolean) : 
                    ['tourist_attraction', 'museum', 'park', 'historic', 'theatre', 'viewpoint'];
                
                const uniqueTypes = [...new Set(attractionTypes)];
                const typeQueries = uniqueTypes.map(t => {
                    if (t === 'park') return `node["leisure"="park"](around:${radius},${location.lat},${location.lng});`;
                    if (t === 'museum') return `node["tourism"="museum"](around:${radius},${location.lat},${location.lng});`;
                    if (t === 'historic') return `node["historic"](around:${radius},${location.lat},${location.lng});`;
                    if (t === 'theatre') return `node["amenity"="theatre"](around:${radius},${location.lat},${location.lng});`;
                    if (t === 'viewpoint') return `node["tourism"="viewpoint"](around:${radius},${location.lat},${location.lng});`;
                    return `node["tourism"="${t}"](around:${radius},${location.lat},${location.lng});`;
                }).join('\n');
                
                overpassQuery = `
                    [out:json][timeout:60];
                    (
                        ${typeQueries}
                    );
                    out geom;
                `;
            }

            // Try cache first
            const cacheKey = `overpass:${type}:${radius}:${location.lat.toFixed(3)},${location.lng.toFixed(3)}`;
            let data = await window.cacheManager?.get(cacheKey);
            if (!data) {
                data = await this.fetchOverpassWithFailover(overpassQuery);
                if (data) window.cacheManager?.set(cacheKey, data, 1000 * 60 * 30); // 30 min TTL
            }

            if (!data || !data.elements || data.elements.length === 0) {
                // Try Wikipedia geosearch for attractions if Overpass returned empty
                if (type !== 'restaurant') {
                    const wikiPlaces = await this.searchWikipediaAttractions(location, radius);
                    return wikiPlaces;
                }
                return [];
            }

            const places = data.elements
                .filter(element => element.tags && element.tags.name)
                .map(element => {
                    const distance = this.calculateDistance(
                        location.lat, location.lng,
                        element.lat, element.lon
                    );
                    return {
                        name: element.tags.name || 'Unknown Place',
                        address: this.formatAddress(element.tags),
                        lat: element.lat,
                        lng: element.lon,
                        distance: distance.toFixed(1),
                        rating: this.generateRandomRating(),
                        type: element.tags.amenity || element.tags.tourism || element.tags.leisure || element.tags.historic || 'place',
                        photos: [`https://picsum.photos/300/200?random=${element.id || Math.floor(Math.random() * 1000)}`],
                        wikipedia: element.tags.wikipedia || null,
                        wikidata: element.tags.wikidata || null,
                        imageTag: element.tags.image || null,
                        commons: element.tags['wikimedia_commons'] || null,
                        osmElementId: element.id
                    };
                })
                .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

            // Enrich with OSM tags (opening_hours, wheelchair, fee, website, phone)
            const enriched = places.map(p => {
                const el = (data.elements || []).find(e => e.id === p.osmElementId) || {};
                const t = el.tags || {};
                return {
                    ...p,
                    opening_hours: t.opening_hours || null,
                    wheelchair: t.wheelchair || null,
                    fee: t.fee || null,
                    website: t.website || t['contact:website'] || null,
                    phone: t.phone || t['contact:phone'] || null
                };
            });

            return enriched;

        } catch (error) {
            console.error('Error fetching places:', error);
            // Only use mock data if explicitly enabled by user
            const allowMock = localStorage.getItem('enableMockPlaces') === 'true';
            if (allowMock) {
                console.log('Falling back to mock data (explicitly enabled)...');
            return this.generateMockPlaces(type, radius);
            }
            return [];
        }
    }

    async fetchOverpassWithFailover(overpassQuery) {
        const endpoints = [
            'https://overpass.kumi.systems/api/interpreter',
            'https://overpass-api.de/api/interpreter',
            'https://lz4.overpass-api.de/api/interpreter',
            'https://z.overpass-api.de/api/interpreter',
            'https://overpass.openstreetmap.fr/api/interpreter'
        ];
        const perEndpointTimeoutMs = 15000; // 15s per endpoint

        for (const endpoint of endpoints) {
            let controller;
            let timeoutId;
            try {
                controller = new AbortController();
                timeoutId = setTimeout(() => controller.abort(), perEndpointTimeoutMs);
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'data=' + encodeURIComponent(overpassQuery),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (response.ok) {
                    return await response.json();
                } else {
                    console.warn('Overpass endpoint responded non-OK:', endpoint, response.status);
                }
            } catch (e) {
                console.warn('Overpass endpoint failed:', endpoint, e?.name || e);
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
            }
        }
        throw new Error('All Overpass endpoints failed');
    }

    async searchWikipediaAttractions(location, radius) {
        try {
            // radius in meters; Wikipedia expects meters and caps at 10000
            const cappedRadius = Math.min(parseInt(radius, 10) || 5000, 10000);
            const url = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${location.lat}%7C${location.lng}&gsradius=${cappedRadius}&gslimit=20&format=json&origin=*`;
            const response = await fetch(url);
            if (!response.ok) return [];
            const data = await response.json();
            const results = data?.query?.geosearch || [];
            return results.map(item => ({
                name: item.title,
                address: 'Wikipedia POI',
                lat: item.lat,
                lng: item.lon,
                distance: (item.dist / 1000).toFixed(1),
                rating: this.generateRandomRating(),
                type: 'tourist_attraction',
                photos: [`https://picsum.photos/300/200?random=${item.pageid}`],
                pageid: item.pageid,
                wikipediaLang: 'en'
            }));
        } catch (e) {
            return [];
        }
    }

    // ===== Real photo helpers (Wikidata/Wikipedia/Commons) =====
    async loadRealPhotoForPlace(place) {
        try {
            // 1) Direct image tag in OSM
            if (place.imageTag) {
                const direct = this.normalizeImageTag(place.imageTag);
                if (direct) return direct;
            }
            // 2) Wikidata P18
            if (place.wikidata) {
                const url = await this.fetchWikidataImage(place.wikidata);
                if (url) return url;
            }
            // 3) Wikipedia page image (by lang:title)
            if (place.wikipedia) {
                const wp = this.parseWikipediaTag(place.wikipedia);
                const url = await this.fetchWikipediaThumbnail(wp.lang, wp.title);
                if (url) return url;
            }
            // 4) Wikipedia geosearch pageid
            if (place.pageid) {
                const url = await this.fetchWikipediaThumbnail(place.wikipediaLang || 'en', null, place.pageid);
                if (url) return url;
            }
            // 5) Commons tag
            if (place.commons) {
                const url = await this.fetchCommonsFileThumbnail(place.commons);
                if (url) return url;
            }
        } catch (e) {}
        return null;
    }

    async loadRealPhotoGalleryForPlace(place) {
        const gallery = [];
        // 1) From OSM direct image
        if (place.imageTag) {
            const direct = this.normalizeImageTag(place.imageTag);
            if (direct) gallery.push(direct);
        }
        // 2) From Wikipedia page (by wikipedia tag or pageid)
        if (place.wikipedia) {
            const wp = this.parseWikipediaTag(place.wikipedia);
            const pageImgs = await this.fetchWikipediaGallery(wp.lang, wp.title);
            gallery.push(...pageImgs);
        } else if (place.pageid) {
            const pageImgs = await this.fetchWikipediaGallery('en', null, place.pageid);
            gallery.push(...pageImgs);
        }
        // 3) From Wikidata P18
        if (place.wikidata) {
            const p18 = await this.fetchWikidataImage(place.wikidata);
            if (p18) gallery.push(p18);
        }
        // Deduplicate
        return Array.from(new Set(gallery)).slice(0, 6);
    }

    async fetchWikipediaGallery(lang = 'en', title = null, pageid = null) {
        try {
            const cacheKey = `wp:gal:${lang}:${title || pageid}`;
            const cached = await window.cacheManager?.get(cacheKey);
            if (cached) return cached;
            const base = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages|images&pithumbsize=600`;
            const url = title ? `${base}&titles=${encodeURIComponent(title)}` : `${base}&pageids=${encodeURIComponent(pageid)}`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json();
            const pages = data?.query?.pages || {};
            const first = Object.values(pages)[0];
            const thumbs = [];
            if (first?.thumbnail?.source) thumbs.push(first.thumbnail.source);
            const images = first?.images || [];
            for (let i = 0; i < Math.min(images.length, 6); i++) {
                const fileTitle = images[i]?.title;
                if (fileTitle && /^File:/i.test(fileTitle)) {
                    thumbs.push(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileTitle)}?width=800`);
                }
            }
            const unique = Array.from(new Set(thumbs));
            window.cacheManager?.set(cacheKey, unique, 1000 * 60 * 60); // 1h TTL
            return unique;
        } catch (e) { return []; }
    }

    isPlaceholderUrl(url) {
        return /picsum\.photos|placekitten|placehold\.it/i.test(url);
    }

    normalizeImageTag(tag) {
        if (!tag) return null;
        if (/^https?:\/\//i.test(tag)) return tag;
        if (/^File:/i.test(tag)) {
            return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(tag)}?width=600`;
        }
        return null;
    }

    parseWikipediaTag(tag) {
        const parts = String(tag).split(':');
        if (parts.length >= 2) {
            const lang = parts[0];
            const title = parts.slice(1).join(':');
            return { lang, title };
        }
        return { lang: 'en', title: tag };
    }

    async fetchWikidataImage(qid) {
        try {
            const cacheKey = `wd:P18:${qid}`;
            const cached = await window.cacheManager?.get(cacheKey);
            if (cached) return cached;
            const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&origin=*&entity=${encodeURIComponent(qid)}&property=P18`;
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = await res.json();
            const file = data?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
            if (!file) return null;
            const out = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent('File:' + file)}?width=800`;
            window.cacheManager?.set(cacheKey, out, 1000 * 60 * 60);
            return out;
        } catch (e) { return null; }
    }

    async fetchWikipediaThumbnail(lang = 'en', title = null, pageid = null) {
        try {
            const base = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages&piprop=thumbnail|original&pithumbsize=600`;
            const url = title ? `${base}&titles=${encodeURIComponent(title)}` : `${base}&pageids=${encodeURIComponent(pageid)}`;
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = await res.json();
            const pages = data?.query?.pages || {};
            const first = Object.values(pages)[0];
            const thumb = first?.thumbnail?.source || first?.original?.source;
            return thumb || null;
        } catch (e) { return null; }
    }

    async fetchCommonsFileThumbnail(fileOrCategory) {
        try {
            let file = fileOrCategory;
            if (/^Category:/i.test(file)) return null;
            if (!/^File:/i.test(file)) file = 'File:' + file;
            return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=600`;
        } catch (e) { return null; }
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radius of the Earth in kilometers
        const dLat = this.deg2rad(lat2 - lat1);
        const dLon = this.deg2rad(lon2 - lon1);
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const d = R * c; // Distance in km
        return d;
    }

    deg2rad(deg) {
        return deg * (Math.PI/180);
    }

    isSamePlace(a, b) {
        if (!a || !b) return false;
        if (a.osmElementId && b.osmElementId && a.osmElementId === b.osmElementId) return true;
        const sameName = a.name && b.name && a.name === b.name;
        const sameCoords = typeof a.lat === 'number' && typeof b.lat === 'number' &&
                           Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
        return sameName || sameCoords;
    }

    formatAddress(tags) {
        const parts = [];
        if (tags['addr:housenumber']) parts.push(tags['addr:housenumber']);
        if (tags['addr:street']) parts.push(tags['addr:street']);
        if (tags['addr:city']) parts.push(tags['addr:city']);
        if (parts.length === 0 && tags['addr:full']) parts.push(tags['addr:full']);
        return parts.length > 0 ? parts.join(' ') : 'Address not available';
    }

    formatOpeningHours(oh) {
        // Very lightweight humanization: show raw or short open status
        try {
            if (/24\/7/.test(oh)) return 'Open 24/7';
            // If contains day ranges, show as-is trimmed
            return String(oh).replace(/;\s*/g, ' · ');
        } catch(e) { return oh; }
    }

    generateRandomRating() {
        return (Math.random() * 2 + 3).toFixed(1); // Random rating between 3.0 and 5.0
    }

    generateMockPlaces(type, radius) {
        const attractions = [
            { name: 'Historic Downtown District', rating: 4.2, address: '123 Main St' },
            { name: 'City Art Museum', rating: 4.5, address: '456 Culture Ave' },
            { name: 'Riverside Park', rating: 4.3, address: '789 River Rd' },
            { name: 'Old Town Square', rating: 4.1, address: '321 Heritage St' },
            { name: 'Scenic Overlook', rating: 4.4, address: '654 Hilltop Dr' },
            { name: 'Local History Center', rating: 4.0, address: '987 Memory Ln' },
            { name: 'Botanical Gardens', rating: 4.6, address: '147 Garden Way' },
            { name: 'Waterfront Promenade', rating: 4.2, address: '258 Dock St' }
        ];

        const restaurants = [
            { name: 'The Corner Bistro', rating: 4.3, address: '111 Food St' },
            { name: 'Mama\'s Kitchen', rating: 4.5, address: '222 Comfort Ave' },
            { name: 'Urban Grill', rating: 4.2, address: '333 Modern Blvd' },
            { name: 'Seaside Seafood', rating: 4.4, address: '444 Ocean Dr' },
            { name: 'Mountain View Cafe', rating: 4.1, address: '555 Peak Rd' },
            { name: 'The Local Pub', rating: 4.0, address: '666 Community St' },
            { name: 'Artisan Pizza Co.', rating: 4.6, address: '777 Craft Ln' },
            { name: 'Garden Restaurant', rating: 4.3, address: '888 Fresh Way' }
        ];

        const selectedPlaces = type === 'restaurant' ? restaurants : attractions;
        
        return selectedPlaces.map(place => ({
            ...place,
            distance: (Math.random() * (parseInt(radius) / 1000)).toFixed(1),
            photos: [`https://picsum.photos/300/200?random=${Math.floor(Math.random() * 1000)}`]
        }));
    }

    displayPlace(place) {
        this.hideLoading();
        this.hideError();

        this.currentPlace = place;

        // Display place info
        document.getElementById('place-name').textContent = place.name;
        document.getElementById('place-address').textContent = place.address;
        document.getElementById('place-rating').textContent = `⭐ ${place.rating}/5`;
        const dist = this.formatDistanceKm(place.distance);
        document.getElementById('place-distance').textContent = `📍 ${dist.text} away`;
        document.getElementById('place-type').textContent = this.formatPlaceType(place.type);

        // Add place badge based on type/theme
        const badge = this.getPlaceBadge(place);
        const badgeElement = document.getElementById('place-badge');
        if (badge) {
            badgeElement.textContent = badge;
            badgeElement.style.display = 'inline-block';
        } else {
            badgeElement.style.display = 'none';
        }

        // Amenities chips (opening hours / accessibility / fee / site / phone)
        try {
            const nameEl = document.getElementById('place-address');
            const row = document.createElement('div');
            row.className = 'amenities';
            const add = (html, cls) => { const chip = document.createElement('span'); chip.className = 'amenity' + (cls ? ' ' + cls : ''); chip.innerHTML = html; row.appendChild(chip); };
            if (place.opening_hours) {
                const oh = this.formatOpeningHours(place.opening_hours);
                const isOpen = /24\/7|open\b/i.test(oh) && !/off|closed/i.test(oh);
                add(`⏰ ${oh}`, isOpen ? 'open' : undefined);
            }
            if (place.wheelchair && /yes|designated/i.test(place.wheelchair)) add('♿ Accessible');
            if (place.fee && /yes/i.test(place.fee)) add('💳 Entry fee');
            if (place.website) add(`<a href="${place.website}" target="_blank" rel="noopener">🔗 Website</a>`);
            if (place.phone) add(`📞 ${place.phone}`);
            if (row.children.length) nameEl?.insertAdjacentElement('afterend', row);
        } catch(e) {}

        // Handle photos (skeletons)
        const photosContainer = document.getElementById('place-photos');
        photosContainer.innerHTML = '';
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton skeleton-rect';
        photosContainer.appendChild(skeleton);
        const renderGallery = (urls) => {
            photosContainer.innerHTML = '';
            if (!urls || urls.length === 0) return;
            const gallery = document.createElement('div');
            gallery.className = 'place-gallery';
            const main = document.createElement('img');
            main.className = 'gallery-main';
            let currentIndex = 0;
            const tryLoad = (url, onFail) => new Promise((resolve) => {
                const test = new Image();
                test.onload = () => resolve(url);
                test.onerror = () => resolve(onFail ? onFail() : null);
                test.src = url;
            });
            // Progressive load: try current, else next
            const pickUrl = async (i) => {
                if (i >= urls.length) return null;
                return await tryLoad(urls[i], () => pickUrl(i+1));
            };
            (async () => {
                const firstOk = await pickUrl(0);
                if (firstOk) main.src = firstOk;
            })();
            main.alt = place.name;
            const thumbs = document.createElement('div');
            thumbs.className = 'gallery-thumbs';
            urls.slice(0, 5).forEach((u) => {
                const t = document.createElement('img');
                // Lazy thumbnails with error fallback
                t.loading = 'lazy';
                t.src = u;
                t.alt = place.name;
                t.addEventListener('click', () => {
                    currentIndex = urls.indexOf(u);
                    if (currentIndex < 0) currentIndex = 0;
                    main.src = urls[currentIndex];
                    updateDots();
                });
                t.onerror = () => { t.remove(); };
                thumbs.appendChild(t);
            });
            const dots = document.createElement('div');
            dots.className = 'gallery-dots';
            const updateDots = () => {
                dots.innerHTML = '';
                urls.slice(0, 5).forEach((_, i) => {
                    const d = document.createElement('span');
                    d.className = 'gallery-dot' + (i === currentIndex ? ' active' : '');
                    dots.appendChild(d);
                });
            };
            updateDots();
            gallery.appendChild(main);
            gallery.appendChild(thumbs);
            gallery.appendChild(dots);
            photosContainer.appendChild(gallery);

            // Swipe support for main image
            let touchStartX = null;
            main.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
            main.addEventListener('touchend', (e) => {
                if (touchStartX == null) return;
                const dx = e.changedTouches[0].clientX - touchStartX;
                const threshold = 30;
                if (Math.abs(dx) > threshold) {
                    if (dx < 0) currentIndex = (currentIndex + 1) % urls.length; else currentIndex = (currentIndex - 1 + urls.length) % urls.length;
                    main.src = urls[currentIndex];
                    updateDots();
                }
                touchStartX = null;
            }, { passive: true });

            // Zoom via double-tap toggle + fade transition
            let zoomed = false;
            const toggleZoom = () => {
                zoomed = !zoomed;
                main.style.transition = 'transform 150ms ease';
                main.style.transform = zoomed ? 'scale(1.6)' : 'scale(1)';
            };
            main.addEventListener('dblclick', toggleZoom);
            let lastTap = 0; let lastX = 0; let lastY = 0;
            main.addEventListener('touchend', (ev) => {
                const t = ev.changedTouches && ev.changedTouches[0];
                const now = Date.now();
                const dt = now - lastTap;
                const dist = t ? Math.hypot(t.clientX - lastX, t.clientY - lastY) : 0;
                if (dt > 0 && dt < 280 && dist < 12) {
                    toggleZoom();
                    lastTap = 0; lastX = 0; lastY = 0;
                } else {
                    lastTap = now; lastX = t ? t.clientX : 0; lastY = t ? t.clientY : 0;
                }
            }, { passive: true });
        };

        const attemptRealPhoto = async () => {
            const urls = await this.loadRealPhotoGalleryForPlace(place);
            const filtered = (urls || []).filter(u => !this.isPlaceholderUrl(u));
            if (filtered.length > 0) {
                renderGallery(filtered);
                return;
            }
            // Graceful fallback: static map image or minimal no-photo banner
            if (place.lat && place.lng) {
                const zoom = 14; const width = 320; const height = 200;
                const fallback = `https://maps.wikimedia.org/img/osm-intl,${zoom},${place.lat},${place.lng},${width}x${height}.png`;
                renderGallery([fallback]);
            } else {
                const svg = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><rect width='100%' height='100%' fill='#e5e7eb'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#6b7280' font-family='system-ui' font-size='16'>No photo available</text></svg>`);
                renderGallery([`data:image/svg+xml;utf8,${svg}`]);
            }
        };

        // Try to load a real photo asynchronously
        attemptRealPhoto();

        // Render map preview only if no photos are available
        const mapDiv = document.getElementById('place-map');
        if (mapDiv) {
            mapDiv.classList.add('hidden');
            mapDiv.innerHTML = '';
            
            // Only show map if we have coordinates
            if (place.lat && place.lng) {
                const zoom = 14;
                const width = 320;
                const height = 200;
                const marker = `${place.lat},${place.lng}`;
                const osmUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${place.lat},${place.lng}&zoom=${zoom}&size=${width}x${height}&maptype=mapnik&markers=${marker},red-pushpin`;
                const wikUrl = `https://maps.wikimedia.org/img/osm-intl,${zoom},${place.lat},${place.lng},${width}x${height}.png`;
                const img = new Image();
                img.alt = `Map of ${place.name}`;
                img.loading = 'lazy';
                const setIframeFallback = () => {
                    const delta = 0.01;
                    const bbox = `${place.lng - delta},${place.lat - delta},${place.lng + delta},${place.lat + delta}`;
                    const iframe = document.createElement('iframe');
                    iframe.src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(place.lat + ',' + place.lng)}`;
                    iframe.loading = 'lazy';
                    iframe.style.width = width + 'px';
                    iframe.style.height = height + 'px';
                    iframe.style.border = '0';
                    mapDiv.classList.remove('hidden');
                    mapDiv.innerHTML = '';
                    mapDiv.appendChild(iframe);
                };
                img.onload = () => { mapDiv.classList.remove('hidden'); mapDiv.innerHTML = ''; mapDiv.appendChild(img); };
                img.onerror = () => {
                    if (img.src === wikUrl) {
                        img.src = osmUrl;
                    } else {
                        setIframeFallback();
                    }
                };
                // Prefer Wikimedia first to avoid DNS issues with staticmap.openstreetmap.de
                img.src = wikUrl;
            } else {
                mapDiv.classList.add('hidden');
            }
            // Mobile: allow opening map in full screen (iframe)
            const openBtn = document.getElementById('open-map');
            if (openBtn) {
                openBtn.classList.remove('hidden');
                openBtn.onclick = () => {
                    if (!(place.lat && place.lng)) return;
                    const delta = 0.01; const bbox = `${place.lng - delta},${place.lat - delta},${place.lng + delta},${place.lat + delta}`;
                    const overlay = document.createElement('div'); overlay.className = 'map-overlay';
                    const sheet = document.createElement('div'); sheet.className = 'map-sheet';
                    const header = document.createElement('div'); header.className = 'map-header';
                    header.innerHTML = `<span class="map-title">Map · ${place.name}</span>`;
                    const close = document.createElement('button'); close.className = 'map-close'; close.setAttribute('aria-label','Close map'); close.textContent = '✕';
                    close.onclick = () => overlay.remove();
                    const body = document.createElement('div'); body.className = 'map-body';
                    const frame = document.createElement('iframe');
                    frame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(place.lat + ',' + place.lng)}`;
                    body.appendChild(frame);
                    header.appendChild(close); sheet.appendChild(header); sheet.appendChild(body); overlay.appendChild(sheet);
                    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
                    document.body.appendChild(overlay);
                };
            }
        }

        // Reset button states
        const addBtn = document.getElementById('add-to-adventure');
        addBtn.disabled = false;
        // Reflect current membership in pending list
        const already = (window.adventurePlanner?.adventurePlaces || []).some(p => this.isSamePlace(p, place));
        if (already) {
            addBtn.textContent = '❌ Remove from Adventure';
            addBtn.dataset.added = 'true';
        } else {
            addBtn.textContent = '➕ Add to Adventure';
            addBtn.dataset.added = 'false';
        }
        
        const visited = window.storageManager?.getVisitedPlaces?.() || [];
        const isVisited = visited.some(v => v.name === place.name);
        
        const visitButton = document.getElementById('mark-visited');
        if (isVisited) {
            visitButton.textContent = '✅ Already Visited';
            visitButton.disabled = true;
        } else {
            visitButton.textContent = '✅ Mark Visited';
            visitButton.disabled = false;
        }

        // Hide notes initially
        document.querySelector('.place-notes').classList.add('hidden');

        document.getElementById('result').classList.remove('hidden');

        // Sticky actions removed per UX choice
        
        // Trigger event for sharing functionality
        document.dispatchEvent(new CustomEvent('placeDisplayed', {
            detail: { place: place }
        }));

        // Analytics event (free Vercel analytics)
        try { if (typeof window.va === 'function' && window.__vaReady && document.hasStoredUserActivation) window.va('event', { type: 'place_displayed', name: place.name, kind: place.type }); } catch (e) {}
    }

    updateStickyActions() { /* intentionally removed */ }

    getDirections() {
        if (!this.currentPlace) return;

        let destination;
        if (this.currentPlace.lat && this.currentPlace.lng) {
            // Use coordinates if available
            destination = `${this.currentPlace.lat},${this.currentPlace.lng}`;
        } else {
            // Fallback to address
            destination = encodeURIComponent(this.currentPlace.address);
        }
        
        const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
        window.open(url, '_blank');
    }

    showLoading(message = 'Loading...') {
        const loadingElement = document.getElementById('loading');
        loadingElement.querySelector('p').textContent = message;
        loadingElement.classList.remove('hidden');
        document.getElementById('result').classList.add('hidden');
        document.getElementById('error').classList.add('hidden');
        const sticky = document.getElementById('sticky-actions');
        if (sticky) sticky.classList.add('hidden');
    }

    hideLoading() {
        document.getElementById('loading').classList.add('hidden');
    }

    showError(message) {
        this.hideLoading();
        document.getElementById('error-message').textContent = message;
        document.getElementById('error').classList.remove('hidden');
        document.getElementById('result').classList.add('hidden');
        const sticky = document.getElementById('sticky-actions');
        if (sticky) sticky.classList.add('hidden');
    }

    hideError() {
        document.getElementById('error').classList.add('hidden');
    }

    showSuccess(message) {
        this.hideLoading();
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = message;
        successDiv.style.cssText = `
            background: #d4edda;
            color: #155724;
            padding: 10px 15px;
            border-radius: 5px;
            margin: 10px 0;
            border: 1px solid #c3e6cb;
        `;
        
        const container = document.querySelector('.controls');
        container.appendChild(successDiv);
        
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.parentNode.removeChild(successDiv);
            }
        }, 3000);
    }

    async convertCoordinatesToAddress(inputValue) {
        // Check if input looks like coordinates (e.g., "40.7128, -74.0060")
        const coordPattern = /^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/;
        const match = inputValue.match(coordPattern);
        
        if (match) {
            const lat = parseFloat(match[1]);
            const lng = parseFloat(match[2]);
            
            // Validate coordinate ranges
            if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                try {
                    const address = await this.getAddressFromCoordinates(lat, lng);
                    if (address) {
                        return { lat, lng, address };
                    }
                } catch (error) {
                    console.warn('Failed to convert coordinates to address:', error);
                }
            }
        }
        
        return null;
    }
}

// Add theme filtering methods
RandomPlacesFinder.prototype.applyThemeFilter = function(type, theme) {
    if (theme === 'any') return type;
    
    const themeMapping = {
        foodie: 'restaurant',
        historic: 'museum',
        nature: 'park',
        culture: 'museum',
        hidden: type, // Keep original type for hidden gems
        photo: 'tourist_attraction'
    };
    
    return themeMapping[theme] || type;
};

RandomPlacesFinder.prototype.filterPlacesByTheme = function(places, theme) {
    if (theme === 'any') return places;
    
    switch (theme) {
        case 'hidden':
            // Filter for places with lower ratings or fewer reviews (simulated)
            return places.filter(place => parseFloat(place.rating) < 4.2);
        case 'photo':
            // Prefer viewpoints and attractions
            return places.filter(place => 
                place.type === 'viewpoint' || 
                place.type === 'tourist_attraction' ||
                place.name.toLowerCase().includes('view') ||
                place.name.toLowerCase().includes('scenic')
            );
        case 'nature':
            return places.filter(place => 
                place.type === 'park' || 
                place.type === 'nature_reserve' ||
                place.name.toLowerCase().includes('park') ||
                place.name.toLowerCase().includes('garden')
            );
        default:
            return places;
    }
};

RandomPlacesFinder.prototype.formatPlaceType = function(type) {
    const typeMapping = {
        restaurant: '🍽️ Restaurant',
        cafe: '☕ Cafe',
        bar: '🍺 Bar',
        fast_food: '🍔 Fast Food',
        tourist_attraction: '🎯 Attraction',
        museum: '🏛️ Museum',
        park: '🌳 Park',
        viewpoint: '👁️ Viewpoint',
        historic: '🏛️ Historic Site',
        theatre: '🎭 Theatre'
    };
    
    return typeMapping[type] || '📍 Place';
};

RandomPlacesFinder.prototype.getPlaceBadge = function(place) {
    if (!place.rating) return null;
    
    const rating = parseFloat(place.rating);
    if (rating >= 4.5) return '🌟 Highly Rated';
    if (rating <= 3.5) return '💎 Hidden Gem';
    if (place.distance && parseFloat(place.distance) > 15) return '🚗 Road Trip';
    if (place.distance && parseFloat(place.distance) < 1) return '🚶 Walking Distance';
    
    return null;
};

// Initialization moved to init.js
// Expose class on global for init check
window.RandomPlacesFinder = window.RandomPlacesFinder || RandomPlacesFinder;