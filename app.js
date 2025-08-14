class RandomPlacesFinder {
    constructor() {
        this.currentLocation = null;
        this.lastSearchType = null;
        this.lastRange = null;
        this.currentPlace = null;
        this.isSearching = false;
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

        // Quick filter chips (multi-select + clear)
        const chipButtons = Array.from(document.querySelectorAll('.chip-btn'));
        const restoreActive = new Set((localStorage.getItem('activeChips') || '').split(',').filter(Boolean));
        chipButtons.forEach(btn => {
            if (btn.dataset.clear === 'true') return;
            if (restoreActive.has(btn.textContent)) btn.classList.add('active');
            btn.addEventListener('click', async () => {
                btn.classList.toggle('active');
                const activeLabels = chipButtons.filter(b => b.dataset.clear !== 'true' && b.classList.contains('active')).map(b => b.textContent);
                try { localStorage.setItem('activeChips', activeLabels.join(',')); } catch (e) {}
                await this.runChipsSearch();
            });
        });

        // Clear chip resets selections
        const clearChip = document.querySelector('.chip-btn.clear-chip');
        if (clearChip) {
            clearChip.addEventListener('click', async () => {
                chipButtons.forEach(b => b.classList.remove('active'));
                localStorage.removeItem('activeChips');
                if (this.currentLocation) await this.findRandomPlace('tourist_attraction');
            });
        }

        // Auto-run if we already have location and chips
        try {
            if (this.currentLocation && (localStorage.getItem('activeChips') || '').length) {
                setTimeout(() => this.runChipsSearch(), 300);
            }
        } catch (e) {}

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
                if (this.currentPlace) this.displayPlace(this.currentPlace, this.currentLocation);
                if (window.adventurePlanner?.updateStats) window.adventurePlanner.updateStats();
                // Update range label units
                const range = document.getElementById('range');
                range?.dispatchEvent(new Event('input'));
            });
        }
    }

    async runChipsSearch() {
        // Aggregate selected chips to choose category/type
        const activeChips = Array.from(document.querySelectorAll('.chip-btn.active'));
        if (activeChips.length === 0) return;
        // If any restaurant chip active, run restaurant search; otherwise attraction
        const isRestaurant = activeChips.some(c => c.getAttribute('data-category') === 'restaurant');
        return this.findRandomPlace(isRestaurant ? 'restaurant' : 'tourist_attraction');
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
        }
        
        const types = ['restaurant', 'tourist_attraction'];
        const randomType = types[Math.floor(Math.random() * types.length)];
        this.findRandomPlace(randomType);
    }

    getCurrentLocation() {
        this.showLoading('Getting your location...');

        if (!navigator.geolocation) {
            this.showError('Geolocation is not supported by this browser.');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.currentLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                document.getElementById('location').value = `${this.currentLocation.lat.toFixed(6)}, ${this.currentLocation.lng.toFixed(6)}`;
                // Notify other components about location update
                document.dispatchEvent(new CustomEvent('locationUpdated', {
                    detail: { location: this.currentLocation }
                }));
                this.hideLoading();
                this.showSuccess('Location found! You can now search for places.');
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
                return {
                    lat: parseFloat(result.lat),
                    lng: parseFloat(result.lon)
                };
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
        this.lastRange = document.getElementById('range').value;

        let location = this.currentLocation;
        const locationInput = document.getElementById('location').value.trim();

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

        this.showLoading(`Finding random ${type === 'restaurant' ? 'restaurant' : 'attraction'}...`);

        try {
            const places = await this.searchNearbyPlaces(location, filteredType, this.lastRange);
            
            if (places && places.length > 0) {
                let filteredPlaces = this.filterPlacesByTheme(places, theme);
                
                if (filteredPlaces.length === 0) {
                    filteredPlaces = places; // Fallback to all places
                }
                
                const randomPlace = filteredPlaces[Math.floor(Math.random() * filteredPlaces.length)];
                this.displayPlace(randomPlace, location);
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
            // Build Overpass query (increase timeout for reliability)
            let overpassQuery;
            if (type === 'restaurant') {
                overpassQuery = `
                    [out:json][timeout:60];
                    (
                        node["amenity"="restaurant"](around:${radius},${location.lat},${location.lng});
                        node["amenity"="fast_food"](around:${radius},${location.lat},${location.lng});
                        node["amenity"="cafe"](around:${radius},${location.lat},${location.lng});
                        node["amenity"="bar"](around:${radius},${location.lat},${location.lng});
                    );
                    out geom;
                `;
            } else {
                overpassQuery = `
                    [out:json][timeout:60];
                    (
                        node["tourism"="attraction"](around:${radius},${location.lat},${location.lng});
                        node["tourism"="museum"](around:${radius},${location.lat},${location.lng});
                        node["leisure"="park"](around:${radius},${location.lat},${location.lng});
                        node["historic"](around:${radius},${location.lat},${location.lng});
                        node["amenity"="theatre"](around:${radius},${location.lat},${location.lng});
                        node["tourism"="viewpoint"](around:${radius},${location.lat},${location.lng});
                    );
                    out geom;
                `;
            }

            const data = await this.fetchOverpassWithFailover(overpassQuery);

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

            return places;

        } catch (error) {
            console.error('Error fetching places:', error);
            // Only use mock data if explicitly enabled by user
            const allowMock = localStorage.getItem('enableMockPlaces') === 'true';
            if (allowMock) {
                console.log('Falling back to mock data (explicitly enabled)...');
            return this.generateMockPlaces(location, type, radius);
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
        const controller = new AbortController();
        const perEndpointTimeoutMs = 15000; // 15s per endpoint

        for (const endpoint of endpoints) {
            try {
                const timeoutId = setTimeout(() => controller.abort(), perEndpointTimeoutMs);
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'data=' + encodeURIComponent(overpassQuery),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (response.ok) {
                    return await response.json();
                }
            } catch (e) {
                // Try next endpoint
                controller.abort();
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
            const base = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages|images&pithumbsize=600`;
            const url = title ? `${base}&titles=${encodeURIComponent(title)}` : `${base}&pageids=${encodeURIComponent(pageid)}`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json();
            const pages = data?.query?.pages || {};
            const first = Object.values(pages)[0];
            const thumbs = [];
            if (first?.thumbnail?.source) thumbs.push(first.thumbnail.source);
            // Try to resolve first few images when available
            const images = first?.images || [];
            for (let i = 0; i < Math.min(images.length, 4); i++) {
                const fileTitle = images[i]?.title; // e.g., File:Something.jpg
                if (fileTitle && /^File:/i.test(fileTitle)) {
                    thumbs.push(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileTitle)}?width=600`);
                }
            }
            return thumbs;
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
            const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&origin=*&entity=${encodeURIComponent(qid)}&property=P18`;
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = await res.json();
            const file = data?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
            if (!file) return null;
            return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent('File:' + file)}?width=600`;
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

    formatAddress(tags) {
        const parts = [];
        if (tags['addr:housenumber']) parts.push(tags['addr:housenumber']);
        if (tags['addr:street']) parts.push(tags['addr:street']);
        if (tags['addr:city']) parts.push(tags['addr:city']);
        if (parts.length === 0 && tags['addr:full']) parts.push(tags['addr:full']);
        return parts.length > 0 ? parts.join(' ') : 'Address not available';
    }

    generateRandomRating() {
        return (Math.random() * 2 + 3).toFixed(1); // Random rating between 3.0 and 5.0
    }

    generateMockPlaces(location, type, radius) {
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

    displayPlace(place, userLocation) {
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
            main.src = urls[currentIndex];
            main.alt = place.name;
            const thumbs = document.createElement('div');
            thumbs.className = 'gallery-thumbs';
            urls.slice(0, 5).forEach((u) => {
                const t = document.createElement('img');
                t.src = u;
                t.alt = place.name;
                t.addEventListener('click', () => {
                    currentIndex = urls.indexOf(u);
                    if (currentIndex < 0) currentIndex = 0;
                    main.src = urls[currentIndex];
                    updateDots();
                });
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

            // Pinch-to-zoom via double-tap toggle
            let zoomed = false;
            main.addEventListener('dblclick', () => {
                zoomed = !zoomed;
                main.style.transform = zoomed ? 'scale(1.6)' : 'scale(1)';
            });
            let lastTap = 0;
            main.addEventListener('touchend', () => {
                const now = Date.now();
                if (now - lastTap < 350) {
                    zoomed = !zoomed;
                    main.style.transform = zoomed ? 'scale(1.6)' : 'scale(1)';
                }
                lastTap = now;
            }, { passive: true });
        };

        const attemptRealPhoto = async () => {
            const urls = await this.loadRealPhotoGalleryForPlace(place);
            // Filter out placeholder sources
            const filtered = (urls || []).filter(u => !this.isPlaceholderUrl(u));
            if (filtered.length > 0) {
                renderGallery(filtered);
            }
        };

        // Try to load a real photo asynchronously
        attemptRealPhoto();

        // Render map preview with skeleton
        const mapDiv = document.getElementById('place-map');
        if (mapDiv) {
            mapDiv.innerHTML = '';
            const sk = document.createElement('div');
            sk.className = 'skeleton skeleton-rect';
            mapDiv.appendChild(sk);
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
        }

        // Reset button states
        document.getElementById('add-to-adventure').textContent = '➕ Add to Adventure';
        document.getElementById('add-to-adventure').disabled = false;
        
        const visited = window.storageManager ? window.storageManager.getVisitedPlaces() : [];
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

        // Sync sticky actions (mobile)
        this.updateStickyActions();
        
        // Trigger event for sharing functionality
        document.dispatchEvent(new CustomEvent('placeDisplayed', {
            detail: { place: place }
        }));
    }

    updateStickyActions() {
        const bar = document.getElementById('sticky-actions');
        if (!bar) return;
        if (!this.currentPlace) { bar.classList.add('hidden'); return; }
        const bind = (selector, handler) => {
            const btn = bar.querySelector(selector);
            if (btn) {
                btn.onclick = handler;
            }
        };
        bind('.sa-directions', () => this.getDirections());
        bind('.sa-add', () => document.getElementById('add-to-adventure').click());
        bind('.sa-visited', () => document.getElementById('mark-visited').click());
        bind('.sa-another', () => document.getElementById('find-another').click());
        bar.classList.remove('hidden');
    }

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
window.RandomPlacesFinder = window.RandomPlacesFinder || RandomPlacesFinder;