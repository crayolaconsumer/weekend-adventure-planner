class WeatherManager {
    constructor() {
        this.apiKey = null; // Users can add their own API key
    this.fallbackWeather = null;
    this.lastWeather = null;
        this.init();
    }

    async fetchHourlyForecast(lat, lng) {
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,weathercode&timezone=auto&forecast_days=1`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json();
            const times = data?.hourly?.time || [];
            const temps = data?.hourly?.temperature_2m || [];
            const codes = data?.hourly?.weathercode || [];
            const list = [];
            const now = Date.now();
            for (let i = 0; i < times.length; i++) {
                const t = new Date(times[i]);
                if (t.getTime() >= now && list.length < 12) {
                    const hour = t.toLocaleTimeString([], { hour: '2-digit' });
                    const desc = this.describeOpenMeteoCode(codes[i]);
                    const icon = this.getWeatherIcon(desc);
                    list.push({ time: hour, temp: Math.round(temps[i]), icon });
                }
            }
            return list.slice(0, 6);
        } catch (e) { return []; }
    }

    init() {
        this.setupWeatherDisplay();
        this.loadStoredWeather();
    }

    setupWeatherDisplay() {
        // Use existing weather widget from HTML
        const weatherWidget = document.getElementById('weather-widget');
        if (weatherWidget) {
            // Widget already exists in HTML, just ensure it has the right structure
            const content = weatherWidget.querySelector('.weather-content');
            if (content) {
                // Elements already exist, no need to create them
                return;
            }
        }
    }

    async getWeatherForLocation(lat, lng) {
        // Prefer keyless sources first (Open-Meteo, wttr.in). OWM only if key provided.
        let weather = await this.tryOpenMeteo(lat, lng);

        if (!weather) {
            weather = await this.tryWeatherAPI(lat, lng);
        }

        if (!weather) {
            const hasKey = !!localStorage.getItem('openweather_api_key');
            if (hasKey) {
                weather = await this.tryOpenWeatherMap(lat, lng);
            }
        }

        if (!weather) {
            weather = this.generateMockWeather(lat);
        }

        this.cacheWeather(weather);
        this.displayWeather(weather);
        return weather;
    }

    async tryOpenMeteo(lat, lng) {
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&timezone=auto`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('API request failed');
            const data = await response.json();
            return this.parseOpenMeteo(data);
        } catch (error) {
            console.warn('Open-Meteo failed:', error);
            return null;
        }
    }

    async tryOpenWeatherMap(lat, lng) {
        // Users can set their own API key in localStorage
        const apiKey = localStorage.getItem('openweather_api_key') || 'demo';
        
        if (apiKey === 'demo') {
            console.log('Weather: Using mock data - add your OpenWeatherMap API key to localStorage[\"openweather_api_key\"] for real weather');
            return null;
        }

        try {
            const response = await fetch(
                `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`
            );
            
            if (!response.ok) throw new Error('API request failed');
            
            const data = await response.json();
            return this.parseOpenWeatherMap(data);
            
        } catch (error) {
            console.warn('OpenWeatherMap failed:', error);
            return null;
        }
    }

    async tryWeatherAPI(lat, lng) {
        // Free tier of WeatherAPI.com (no key needed for basic info)
        try {
            const response = await fetch(
                `https://wttr.in/${lat},${lng}?format=j1`
            );
            
            if (!response.ok) throw new Error('API request failed');
            
            const data = await response.json();
            return this.parseWttrIn(data);
            
        } catch (error) {
            console.warn('Weather API failed:', error);
            return null;
        }
    }

    parseOpenWeatherMap(data) {
        return {
            temperature: Math.round(data.main.temp),
            description: data.weather[0].description,
            condition: data.weather[0].main.toLowerCase(),
            humidity: data.main.humidity,
            windSpeed: data.wind.speed,
            icon: this.getWeatherIcon(data.weather[0].main),
            isGoodForOutdoor: this.isGoodWeatherForOutdoor(data),
            source: 'OpenWeatherMap',
            timestamp: Date.now()
        };
    }

    parseOpenMeteo(data) {
        const cw = data && data.current_weather;
        if (!cw) return null;
        const desc = this.describeOpenMeteoCode(cw.weathercode);
        return {
            temperature: Math.round(cw.temperature),
            description: desc,
            condition: desc,
            humidity: null,
            windSpeed: cw.windspeed,
            icon: this.getWeatherIcon(desc),
            isGoodForOutdoor: this.isGoodWeatherForOutdoor({ temp: cw.temperature, weatherDesc: [{ value: desc }] }),
            source: 'Open-Meteo',
            timestamp: Date.now()
        };
    }

    describeOpenMeteoCode(code) {
        const map = {
            0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
            45: 'fog', 48: 'fog',
            51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
            61: 'rain', 63: 'rain', 65: 'rain',
            66: 'freezing rain', 67: 'freezing rain',
            71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow',
            80: 'rain', 81: 'rain', 82: 'rain',
            85: 'snow', 86: 'snow',
            95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm'
        };
        return map[code] || 'clear';
    }

    parseWttrIn(data) {
        const current = data.current_condition[0];
        return {
            temperature: Math.round(current.temp_C),
            description: current.weatherDesc[0].value.toLowerCase(),
            condition: current.weatherDesc[0].value.toLowerCase(),
            humidity: current.humidity,
            windSpeed: current.windspeedKmph,
            icon: this.getWeatherIcon(current.weatherDesc[0].value),
            isGoodForOutdoor: this.isGoodWeatherForOutdoor(current),
            source: 'wttr.in',
            timestamp: Date.now()
        };
    }

    generateMockWeather(lat) {
        // Generate realistic weather based on location and season
        const conditions = ['sunny', 'partly cloudy', 'cloudy', 'rainy', 'clear'];
        const condition = conditions[Math.floor(Math.random() * conditions.length)];
        
        // Rough temperature based on latitude
        const baseTemp = 20 - Math.abs(lat) * 0.5;
        const temp = Math.round(baseTemp + (Math.random() - 0.5) * 20);
        
        return {
            temperature: temp,
            description: condition,
            condition: condition,
            humidity: Math.round(40 + Math.random() * 40),
            windSpeed: Math.round(Math.random() * 15),
            icon: this.getWeatherIcon(condition),
            isGoodForOutdoor: temp > 5 && temp < 35 && !condition.includes('rain'),
            source: 'Mock Weather',
            timestamp: Date.now()
        };
    }

    getWeatherIcon(condition) {
        const iconMap = {
            'clear': '☀️',
            'sunny': '☀️',
            'partly cloudy': '⛅',
            'cloudy': '☁️',
            'overcast': '☁️',
            'rain': '🌧️',
            'rainy': '🌧️',
            'drizzle': '🌦️',
            'thunderstorm': '⛈️',
            'snow': '❄️',
            'mist': '🌫️',
            'fog': '🌫️'
        };
        
        const conditionLower = condition.toLowerCase();
        for (const [key, icon] of Object.entries(iconMap)) {
            if (conditionLower.includes(key)) {
                return icon;
            }
        }
        
        return '🌤️';
    }

    isGoodWeatherForOutdoor(weatherData) {
        const temp = weatherData.temp_C || weatherData.temp || weatherData.main?.temp;
        const condition = weatherData.weatherDesc?.[0]?.value || weatherData.weather?.[0]?.main || weatherData.condition;
        
        // Good weather criteria
        const tempOk = temp > 5 && temp < 35; // 5-35°C
        const conditionOk = !condition.toLowerCase().includes('rain') && 
                           !condition.toLowerCase().includes('storm') &&
                           !condition.toLowerCase().includes('snow');
        
        return tempOk && conditionOk;
    }

    displayWeather(weather) {
        const widget = document.getElementById('weather-widget');
        if (!widget) return;
        
        widget.classList.remove('hidden');
        widget.querySelector('.weather-icon').textContent = weather.icon;
        widget.querySelector('.weather-temp').textContent = `${weather.temperature}°`;
        widget.querySelector('.weather-desc').textContent = weather.description;
        
        // Add weather-based class for styling
        widget.className = `weather-widget weather-${weather.condition.replace(/\s+/g, '-')}`;
        
    // Add tooltip with more details
    widget.title = `${weather.description}\nHumidity: ${weather.humidity}%\nWind: ${weather.windSpeed} km/h\nSource: ${weather.source}`;
    this.lastWeather = weather;
    widget.onclick = () => this.showWeatherModal();
    }

    cacheWeather(weather) {
        try {
            localStorage.setItem('cachedWeather', JSON.stringify(weather));
        } catch (error) {
            console.warn('Failed to cache weather data:', error);
        }
    }

    loadStoredWeather() {
        const cached = localStorage.getItem('cachedWeather');
        if (cached) {
            try {
                const weather = JSON.parse(cached);
                // Use cached weather if less than 1 hour old
                if (Date.now() - weather.timestamp < 60 * 60 * 1000) {
                    this.displayWeather(weather);
                    this.fallbackWeather = weather;
                }
            } catch (error) {
                console.warn('Failed to parse cached weather:', error);
            }
        }
    }

    getWeatherRecommendations(weather) {
        const recommendations = {
            indoor: [],
            outdoor: [],
            general: []
        };

        if (!weather) {
            return {
                indoor: ['museums', 'cafes', 'shopping centers', 'libraries'],
                outdoor: ['parks', 'viewpoints'],
                general: ['any location type']
            };
        }

        // Temperature-based recommendations
        if (weather.temperature < 5) {
            recommendations.indoor.push('warm cafes', 'museums', 'shopping centers', 'indoor attractions');
            recommendations.general.push('Hot drinks recommended');
        } else if (weather.temperature > 30) {
            recommendations.indoor.push('air-conditioned cafes', 'museums', 'indoor markets');
            recommendations.outdoor.push('parks with shade', 'waterfront areas');
            recommendations.general.push('Stay hydrated');
        } else {
            recommendations.outdoor.push('parks', 'outdoor cafes', 'walking tours', 'viewpoints');
        }

        // Weather condition recommendations
        if (weather.condition.includes('rain')) {
            recommendations.indoor.push('museums', 'galleries', 'covered markets', 'cafes');
            recommendations.general.push('Bring an umbrella');
        } else if (weather.condition.includes('sun')) {
            recommendations.outdoor.push('beaches', 'parks', 'outdoor restaurants', 'scenic spots');
            recommendations.general.push('Perfect for outdoor activities');
        }

        return recommendations;
    }

    getAdventureTimeRecommendation(weather) {
        if (!weather) return 'Any time is good for adventure!';

        if (weather.isGoodForOutdoor) {
            if (weather.temperature > 25) {
                return '🌞 Great weather! Consider early morning or evening for outdoor activities.';
            } else {
                return '☀️ Perfect weather for outdoor adventures!';
            }
        } else {
            return '🏢 Weather suggests indoor activities. Check out museums, cafes, and covered attractions!';
        }
    }

    async updateWeatherForAdventure(location) {
        if (!location) return null;

        try {
            this.lastCoords = { lat: location.lat, lng: location.lng };
            const weather = await this.getWeatherForLocation(location.lat, location.lng);
            
            // Show weather-based suggestions
            const recommendations = this.getWeatherRecommendations(weather);
            const timeRec = this.getAdventureTimeRecommendation(weather);
            
            if (window.pwaManager) {
                window.pwaManager.showToast(timeRec, 'info');
            }
            
            return { weather, recommendations };
            
        } catch (error) {
            console.error('Weather update failed:', error);
            return null;
        }
    }

    // Integration with adventure planner
    filterPlacesByWeather(places, weather) {
        if (!weather || !places) return places;

        return places.map(place => {
            // Add weather suitability score
            let suitabilityScore = 1;
            
            if (weather.isGoodForOutdoor) {
                // Boost outdoor places in good weather
                if (place.type === 'park' || place.type === 'viewpoint' || 
                    place.name.toLowerCase().includes('outdoor') ||
                    place.name.toLowerCase().includes('garden')) {
                    suitabilityScore = 1.5;
                }
            } else {
                // Boost indoor places in bad weather
                if (place.type === 'museum' || place.type === 'cafe' || 
                    place.type === 'restaurant' || place.type === 'theatre' ||
                    place.name.toLowerCase().includes('indoor') ||
                    place.name.toLowerCase().includes('covered')) {
                    suitabilityScore = 1.5;
                }
            }
            
            return {
                ...place,
                weatherSuitability: suitabilityScore,
                weatherTip: this.getPlaceWeatherTip(place, weather)
            };
        }).sort((a, b) => (b.weatherSuitability || 1) - (a.weatherSuitability || 1));
    }

    getPlaceWeatherTip(place, weather) {
        if (!weather) return null;
        
        const isOutdoor = place.type === 'park' || place.type === 'viewpoint' || 
                         place.name.toLowerCase().includes('outdoor');
        
        if (isOutdoor && !weather.isGoodForOutdoor) {
            if (weather.condition.includes('rain')) {
                return '☔ Consider checking if this outdoor location has covered areas';
            } else if (weather.temperature < 5) {
                return '🧥 Dress warmly for this outdoor location';
            } else if (weather.temperature > 30) {
                return '🌞 Bring sun protection and water';
            }
        }
        
        return null;
    }

    // Settings for weather API
    setAPIKey(service, key) {
        if (service === 'openweathermap') {
            localStorage.setItem('openweather_api_key', key);
            if (window.pwaManager) {
                window.pwaManager.showToast('🌤️ Weather API key saved!', 'success');
            }
        }
    }

    removeAPIKey(service) {
        if (service === 'openweathermap') {
            localStorage.removeItem('openweather_api_key');
            if (window.pwaManager) {
                window.pwaManager.showToast('🌤️ Weather API key removed', 'info');
            }
        }
    }

    showWeatherModal() {
    const w = this.lastWeather || this.fallbackWeather;
    if (!w) return;
    const c = Number(w.temperature);
    const f = Math.round((c * 9) / 5 + 32);
    const windKmh = Number(w.windSpeed) || 0;
    const windMph = (windKmh * 0.621371).toFixed(1);

    const overlay = document.createElement('div');
    overlay.className = 'weather-modal-overlay';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.innerHTML = `
      <div class="weather-modal">
        <div class="wm-header">
          <h3>Weather details</h3>
          <button class="wm-close" aria-label="Close">✕</button>
        </div>
        <div class="wm-body">
          <div class="wm-row"><span>Condition</span><span>${w.icon} ${w.description}</span></div>
          <div class="wm-row"><span>Temperature</span><span>${c}°C / ${f}°F</span></div>
          ${w.humidity != null ? `<div class=\"wm-row\"><span>Humidity</span><span>${w.humidity}%</span></div>` : ''}
          ${w.windSpeed != null ? `<div class=\"wm-row\"><span>Wind</span><span>${windKmh} km/h • ${windMph} mph</span></div>` : ''}
          <div class="wm-row"><span>Source</span><span>${w.source}</span></div>
          <div class="wm-forecast"><div class="wm-forecast-title">Next hours</div><div class="wm-forecast-row" id="wm-forecast-row"></div></div>
          <div class="wm-footnote">Updated: ${new Date(w.timestamp).toLocaleString()}</div>
        </div>
      </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.wm-close').onclick = () => overlay.remove();
    document.addEventListener('keydown', function onEsc(ev){ if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } });
    document.body.appendChild(overlay);

    // Load forecast asynchronously
    if (this.lastCoords) {
      this.fetchHourlyForecast(this.lastCoords.lat, this.lastCoords.lng)
        .then(items => {
          const row = overlay.querySelector('#wm-forecast-row');
          if (!row || !items || items.length === 0) return;
          items.forEach(it => {
            const el = document.createElement('div');
            el.className = 'wm-fItem';
            el.innerHTML = `<div class=\"wm-fTime\">${it.time}</div><div class=\"wm-fIcon\">${it.icon}</div><div class=\"wm-fTemp\">${it.temp}°</div>`;
            row.appendChild(el);
          });
        })
        .catch(() => {});
    }
    }
}

// Add weather styles
const weatherStyles = document.createElement('style');
weatherStyles.textContent = `
    .weather-widget {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.2);
        padding: 8px 12px;
        border-radius: 20px;
        font-size: 0.85rem;
        backdrop-filter: blur(10px);
        cursor: pointer;
        transition: all 0.3s ease;
        margin-left: 10px;
        white-space: nowrap;
    }

    .weather-widget:hover {
        background: rgba(255, 255, 255, 0.3);
        transform: scale(1.05);
    }

    .weather-icon {
        font-size: 1.1em;
    }

    .weather-temp {
        font-weight: 600;
    }

    .weather-desc {
        text-transform: capitalize;
    }

    .weather-sunny,
    .weather-clear {
        background: rgba(255, 193, 7, 0.3);
    }

    .weather-rainy,
    .weather-rain {
        background: rgba(54, 162, 235, 0.3);
    }

    .weather-cloudy {
        background: rgba(108, 117, 125, 0.3);
    }

    @media (max-width: 768px) {
        .weather-desc {
            display: none;
        }
        
        .weather-widget {
            margin-left: 5px;
            padding: 6px 10px;
            gap: 6px;
        }
    }

    /* Weather modal */
    .weather-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 11000; }
    .weather-modal { background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 12px; width: 92%; max-width: 420px; box-shadow: 0 10px 30px var(--shadow); animation: fadeInUp 180ms ease; }
    .wm-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border-color); }
    .wm-header h3 { margin: 0; font-size: 1rem; }
    .wm-close { background: transparent; border: none; width: 34px; height: 34px; min-width: 34px; padding: 0; border-radius: 6px; font-size: 16px; color: var(--text-primary); display: inline-flex; align-items: center; justify-content: center; box-shadow: none; }
    .wm-body { padding: 12px 14px; }
    .wm-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; font-size: 0.95rem; }
    .wm-row span:first-child { color: var(--text-secondary); }
    .wm-footnote { margin-top: 6px; color: var(--text-secondary); font-size: 0.8rem; }
    .wm-forecast { margin-top: 8px; }
    .wm-forecast-title { font-weight: 600; font-size: 0.9rem; color: var(--text-primary); margin-bottom: 6px; }
    .wm-forecast-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
    .wm-fItem { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 6px 4px; text-align: center; }
    .wm-fTime { font-size: 0.75rem; color: var(--text-secondary); }
    .wm-fIcon { font-size: 1rem; margin: 2px 0; }
    .wm-fTemp { font-weight: 600; }
`;
document.head.appendChild(weatherStyles);

// Initialize weather manager
document.addEventListener('DOMContentLoaded', () => {
    window.weatherManager = new WeatherManager();
    
    // Listen for app-level location updates
    document.addEventListener('locationUpdated', (e) => {
        const loc = e.detail?.location;
        if (loc && window.weatherManager) {
            window.weatherManager.updateWeatherForAdventure(loc);
        }
    });

    // Integrate with existing location detection
    if (window.randomPlacesFinder) {
        const originalGetCurrentLocation = window.randomPlacesFinder.getCurrentLocation;
        window.randomPlacesFinder.getCurrentLocation = function() {
            const result = originalGetCurrentLocation.call(this);
            
            // Update weather when location is found
            if (this.currentLocation) {
                window.weatherManager.updateWeatherForAdventure(this.currentLocation);
            }
            
            return result;
        };
    }
});