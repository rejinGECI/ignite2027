// Dreams module
export function createDreamsModule(app) {
    return {
        async saveDreams() {
            const data = await app.getUserData();
            if (!data) return;
            
            data.dreams = {
                career: document.getElementById('dream-career').value,
                places: document.getElementById('places-visit').value,
                things: document.getElementById('things-do').value,
                plan: document.getElementById('action-plan').value,
                lastUpdated: new Date().toISOString()
            };
            await app.saveUserData(data);
            
            // Update dream life inspiration on all pages
            app.displayDreamLifeInspiration(data.dreams.career || '');
            
            alert('Dreams and plans saved successfully! ✨');
        },
        
        async loadDreams() {
            const data = await app.getUserData();
            if (!data || !data.dreams) return;
            
            {
                document.getElementById('dream-career').value = data.dreams.career || '';
                document.getElementById('places-visit').value = data.dreams.places || '';
                document.getElementById('things-do').value = data.dreams.things || '';
                document.getElementById('action-plan').value = data.dreams.plan || '';
            }
            
            // Display dream life content on all pages for inspiration
            app.displayDreamLifeInspiration(data.dreams.career || '');
        },
        
        displayDreamLifeInspiration: function(dreamLifeText) {
            if (!dreamLifeText || dreamLifeText.trim() === '') {
                // Hide all inspiration cards if no dream life content
                document.querySelectorAll('.dream-life-inspiration-card').forEach(card => {
                    card.style.display = 'none';
                });
                return;
            }
            
            // Truncate if too long (show first 200 characters)
            const displayText = dreamLifeText.length > 200 
                ? dreamLifeText.substring(0, 200) + '...' 
                : dreamLifeText;
            
            // Update all inspiration cards on all pages
            const inspirationIds = [
                'dream-life-content',
                'dream-life-content-progress',
                'dream-life-content-stats',
                'dream-life-content-habits',
                'dream-life-content-feedback'
            ];
            
            const cardIds = [
                'dream-life-inspiration',
                'dream-life-inspiration-progress',
                'dream-life-inspiration-stats',
                'dream-life-inspiration-habits',
                'dream-life-inspiration-feedback'
            ];
            
            inspirationIds.forEach(id => {
                const element = document.getElementById(id);
                if (element) {
                    element.textContent = displayText;
                }
            });
            
            cardIds.forEach(id => {
                const card = document.getElementById(id);
                if (card) {
                    card.style.display = 'block';
                }
            });
        }
    };
}

