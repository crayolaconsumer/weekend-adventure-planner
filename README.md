# Random Places Finder

A web app that helps you discover random attractions and restaurants around any location using free OpenStreetMap APIs.

## Features

- **Real location data** using OpenStreetMap's Nominatim and Overpass APIs
- **GPS location** or manual address input
- **Customizable search radius** (1-20km)
- **Random discovery** of attractions and restaurants
- **Detailed place info** including distance, ratings, and photos
- **Direct navigation** to Google Maps for directions
- **Responsive design** for mobile and desktop
- **Completely free** - no API keys required

## APIs Used

### Nominatim (Geocoding)
- **Service**: OpenStreetMap's free geocoding service
- **Purpose**: Convert addresses to coordinates
- **Endpoint**: `https://nominatim.openstreetmap.org/search`
- **Rate limits**: Fair use policy (max 1 request/second)

### Overpass API (Places Data)
- **Service**: OpenStreetMap's query API for geographic data
- **Purpose**: Find nearby restaurants and attractions
- **Endpoint**: `https://overpass-api.de/api/interpreter`
- **Rate limits**: 10,000 queries per day per IP

## Place Types Searched

### Restaurants
- Restaurants (`amenity=restaurant`)
- Fast food (`amenity=fast_food`)
- Cafes (`amenity=cafe`)
- Bars (`amenity=bar`)

### Attractions
- Tourist attractions (`tourism=attraction`)
- Museums (`tourism=museum`)
- Parks (`leisure=park`)
- Historic sites (`historic=*`)
- Theaters (`amenity=theatre`)
- Viewpoints (`tourism=viewpoint`)

## Usage

1. Open `index.html` in a web browser
2. Either:
   - Click "Use Current Location" to get your GPS coordinates
   - Or enter an address manually
3. Select your preferred search radius
4. Click "Random Attraction" or "Random Restaurant"
5. Explore the random place found
6. Click "Get Directions" to navigate there
7. Click "Find Another" to discover more places

## Technical Details

- **Fallback system**: If APIs fail, falls back to mock data
- **Distance calculation**: Uses Haversine formula for accuracy
- **Error handling**: Comprehensive error messages for various failure scenarios
- **CORS**: Uses public APIs that support cross-origin requests
- **Performance**: Caches location data and handles API timeouts

## Browser Compatibility

- Modern browsers with ES6+ support
- Geolocation API support for GPS functionality
- Fetch API for network requests

## Rate Limiting

To respect the free APIs:
- Nominatim: Max 1 request per second
- Overpass: Max 10,000 queries per day
- Both services have fair use policies

## Offline Considerations

The app requires internet connectivity for:
- Geocoding addresses
- Fetching place data
- Loading place photos
- Getting directions

## Future Enhancements

- Add place categories (food type, attraction type)
- Implement favorites/bookmarks
- Add user reviews and photos
- Include opening hours when available
- Support for multiple languages
- Offline caching for frequently accessed areas