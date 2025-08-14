// Initialize all components in the correct order
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Weekend Adventure Planner...');
    
    // Check if core scripts are loaded (managers auto-initialize)
    const checkScriptsLoaded = () => {
        const required = ['RandomPlacesFinder', 'AdventurePlanner', 'StorageManager'];
        
        return required.every(className => {
            const exists = typeof window[className] !== 'undefined';
            if (!exists) console.log(`Missing core class: ${className}`);
            return exists;
        });
    };
    
    const initializeApp = () => {
        try {
            // Initialize in correct order
            console.log('Creating StorageManager...');
            window.storageManager = new StorageManager();
            
            console.log('Creating RandomPlacesFinder...');
            window.randomPlacesFinder = new RandomPlacesFinder();
            
            console.log('Creating AdventurePlanner...');
            window.adventurePlanner = new AdventurePlanner();
            
            // Update initial stats
            if (window.adventurePlanner.updateStats) {
                window.adventurePlanner.updateStats();
            }
            
            console.log('Weekend Adventure Planner initialized successfully!');
            
        } catch (error) {
            console.error('Error initializing app:', error);
            try {
                window.pwaManager?.showToast('There was an error starting the app. Please refresh the page.', 'error');
            } catch (e) {}
        }
    };
    
    // Try to initialize immediately, or wait a bit for scripts to load
    if (checkScriptsLoaded()) {
        initializeApp();
    } else {
        console.log('Waiting for scripts to load...');
        setTimeout(() => {
            if (checkScriptsLoaded()) {
                initializeApp();
            } else {
                console.error('Scripts failed to load properly');
                try { window.pwaManager?.showToast('Some features may not work. Please refresh the page.', 'warning'); } catch (e) {}
            }
        }, 500);
    }
});