class StorageManager {
    constructor() {
        this.storageKey = 'weekendAdventureApp';
        this.initializeStorage();
    }

    initializeStorage() {
        if (!localStorage.getItem(this.storageKey)) {
            const initialData = {
                visitedPlaces: [],
                savedAdventures: [],
                currentAdventure: null,
                stats: {
                    totalAdventures: 0,
                    placesVisited: 0,
                    totalDistance: 0,
                    totalScore: 0,
                    currentStreak: 0,
                    lastVisitDate: null,
                    favoriteType: null,
                    typeCounts: {}
                },
                preferences: {
                    favoriteThemes: [],
                    preferredRadius: 5000,
                    averageTime: 3
                }
            };
            this.saveData(initialData);
        }
    }

    getData() {
        try {
            return JSON.parse(localStorage.getItem(this.storageKey)) || {};
        } catch (error) {
            console.error('Error reading storage:', error);
            return {};
        }
    }

    saveData(data) {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (error) {
            console.error('Error saving to storage:', error);
        }
    }

    addVisitedPlace(place) {
        const data = this.getData();
        const visitedPlace = {
            ...place,
            visitedDate: new Date().toISOString(),
            id: Date.now()
        };

        data.visitedPlaces.push(visitedPlace);
        
        // Update stats
        data.stats.placesVisited++;
        data.stats.totalScore += 10; // Base points for visiting
        data.stats.totalDistance += parseFloat(place.distance || 0);
        
        // Update streak
        this.updateStreak(data);
        
        // Update type counts
        const type = place.type || 'unknown';
        data.stats.typeCounts[type] = (data.stats.typeCounts[type] || 0) + 1;
        data.stats.favoriteType = this.getFavoriteType(data.stats.typeCounts);
        
        this.saveData(data);
        return visitedPlace;
    }

    getVisitedPlaces() {
        return this.getData().visitedPlaces || [];
    }

    addPlaceNote(place, note) {
        const data = this.getData();
        const visitedPlace = data.visitedPlaces.find(p => p.name === place.name);
        
        if (visitedPlace) {
            visitedPlace.note = note;
            visitedPlace.noteDate = new Date().toISOString();
        } else {
            // Add as visited with note
            const newPlace = {
                ...place,
                note: note,
                noteDate: new Date().toISOString(),
                visitedDate: new Date().toISOString(),
                id: Date.now()
            };
            data.visitedPlaces.push(newPlace);
        }
        
        this.saveData(data);
    }

    saveAdventure(adventure) {
        const data = this.getData();
        const savedAdventure = {
            ...adventure,
            savedDate: new Date().toISOString()
        };
        
        data.savedAdventures.push(savedAdventure);
        this.saveData(data);
        return savedAdventure;
    }

    getSavedAdventures() {
        return this.getData().savedAdventures || [];
    }

    startAdventure(adventure) {
        const data = this.getData();
        data.currentAdventure = {
            ...adventure,
            startTime: new Date().toISOString(),
            status: 'active'
        };
        this.saveData(data);
    }

    completeAdventure(adventure, visitedPlaces, score) {
        const data = this.getData();
        
        // Update current adventure
        if (data.currentAdventure && data.currentAdventure.id === adventure.id) {
            data.currentAdventure.status = 'completed';
            data.currentAdventure.endTime = new Date().toISOString();
            data.currentAdventure.visitedPlaces = visitedPlaces;
            data.currentAdventure.score = score;
        }

        // Update stats
        data.stats.totalAdventures++;
        data.stats.totalScore += score;
        
        // Bonus points for completing adventure
        if (visitedPlaces.length === adventure.places.length) {
            data.stats.totalScore += 50; // Completion bonus
        }

        // Move to saved adventures
        data.savedAdventures.push(data.currentAdventure);
        data.currentAdventure = null;

        this.saveData(data);
        return data.stats.totalScore;
    }

    getCurrentAdventure() {
        return this.getData().currentAdventure;
    }

    getStats() {
        return this.getData().stats || {};
    }

    updateStreak(data) {
        const today = new Date().toDateString();
        const lastVisit = data.stats.lastVisitDate ? new Date(data.stats.lastVisitDate).toDateString() : null;
        
        if (lastVisit === today) {
            // Already visited today, don't update streak
            return;
        }
        
        if (lastVisit) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toDateString();
            
            if (lastVisit === yesterdayStr) {
                // Consecutive day
                data.stats.currentStreak++;
            } else {
                // Streak broken
                data.stats.currentStreak = 1;
            }
        } else {
            // First visit
            data.stats.currentStreak = 1;
        }
        
        data.stats.lastVisitDate = new Date().toISOString();
    }

    getFavoriteType(typeCounts) {
        let maxCount = 0;
        let favoriteType = null;
        
        for (const [type, count] of Object.entries(typeCounts)) {
            if (count > maxCount) {
                maxCount = count;
                favoriteType = type;
            }
        }
        
        return favoriteType;
    }

    updatePreferences(preferences) {
        const data = this.getData();
        data.preferences = { ...data.preferences, ...preferences };
        this.saveData(data);
    }

    getPreferences() {
        return this.getData().preferences || {};
    }

    // Analytics and insights
    getInsights() {
        const data = this.getData();
        const visitedPlaces = data.visitedPlaces || [];
        const stats = data.stats;

        if (visitedPlaces.length === 0) {
            return { message: 'Start exploring to see insights!' };
        }

        const insights = [];

        // Distance insights
        const avgDistance = stats.totalDistance / visitedPlaces.length;
        if (avgDistance > 10) {
            insights.push(`🚗 You're an explorer! Average distance: ${avgDistance.toFixed(1)}km`);
        } else if (avgDistance < 3) {
            insights.push(`🚶 You love local spots! Average distance: ${avgDistance.toFixed(1)}km`);
        }

        // Type preferences
        const typeCounts = stats.typeCounts;
        const totalVisits = Object.values(typeCounts).reduce((a, b) => a + b, 0);
        
        for (const [type, count] of Object.entries(typeCounts)) {
            const percentage = (count / totalVisits) * 100;
            if (percentage > 40) {
                insights.push(`🎯 You're a ${type} enthusiast! ${percentage.toFixed(0)}% of visits`);
            }
        }

        // Streak insights
        if (stats.currentStreak > 7) {
            insights.push(`🔥 Amazing streak! ${stats.currentStreak} days of exploration`);
        } else if (stats.currentStreak > 3) {
            insights.push(`⭐ Great momentum! ${stats.currentStreak} day streak`);
        }

        // Adventure completion rate
        const completedAdventures = data.savedAdventures.filter(a => a.status === 'completed').length;
        if (data.stats.totalAdventures > 0) {
            const completionRate = (completedAdventures / data.stats.totalAdventures) * 100;
            if (completionRate > 80) {
                insights.push(`🏆 Adventure master! ${completionRate.toFixed(0)}% completion rate`);
            }
        }

        return { insights, stats };
    }

    // Export data for backup
    exportData() {
        const data = this.getData();
        const exportData = {
            ...data,
            exportDate: new Date().toISOString(),
            version: '1.0'
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `weekend-adventures-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Import data from backup
    importData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedData = JSON.parse(e.target.result);
                    
                    // Validate data structure
                    if (importedData.visitedPlaces && importedData.stats) {
                        this.saveData(importedData);
                        resolve(importedData);
                    } else {
                        reject(new Error('Invalid data format'));
                    }
                } catch (error) {
                    reject(error);
                }
            };
            reader.readAsText(file);
        });
    }

    // Clear all data
    clearAllData() {
        if (confirm('Are you sure you want to clear all adventure data? This cannot be undone.')) {
            localStorage.removeItem(this.storageKey);
            this.initializeStorage();
            return true;
        }
        return false;
    }
}

// Initialization moved to init.js