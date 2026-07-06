// Sound utility functions
export const SoundManager = {
    playSound: function(frequency, duration, type = 'sine') {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = frequency;
            oscillator.type = type;
            
            gainNode.gain.setValueAtTime(0.8, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + duration);
        } catch (e) {
            console.warn('Could not play sound:', e);
        }
    },
    
    playStartSound: function() {
        // Distinct upbeat sound for start - higher pitch, quick
        this.playSound(523.25, 0.2, 'sine'); // C
        setTimeout(() => this.playSound(659.25, 0.2, 'sine'), 100); // E
        setTimeout(() => this.playSound(783.99, 0.2, 'sine'), 200); // G
    },
    
    playPauseSound: function() {
        // Distinct pause sound - medium pitch, single tone
        this.playSound(392, 0.3, 'square'); // G
    },
    
    playStopSound: function() {
        // Distinct stop sound - lower descending tone
        this.playSound(440, 0.2, 'sine'); // A
        setTimeout(() => this.playSound(349.23, 0.3, 'sine'), 150); // F
    },
    
    playCompleteSound: function() {
        // Distinct completion sound - triumphant ascending melody
        this.playSound(523.25, 0.25, 'sine'); // C
        setTimeout(() => this.playSound(659.25, 0.25, 'sine'), 150); // E
        setTimeout(() => this.playSound(783.99, 0.3, 'sine'), 300); // G
        setTimeout(() => this.playSound(987.77, 0.3, 'sine'), 450); // B
        setTimeout(() => this.playSound(1046.50, 0.4, 'sine'), 600); // C (high)
    }
};

