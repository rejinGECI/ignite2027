// Timer module
import { SoundManager } from '../utils/soundManager.js';

export function createTimerModule(app) {
    return {
        startTimer: function() {
            if (!app.timer.isRunning) {
                app.timer.isRunning = true;
                app.timer.isPaused = false;
                
                // Play start sound
                SoundManager.playStartSound();
                
                app.timer.interval = setInterval(() => {
                    if (app.timer.remaining > 0) {
                        app.timer.remaining--;
                        app.updateTimerDisplay();
                    } else {
                        app.completeTimer();
                    }
                }, 1000);
                
                document.getElementById('start-timer').style.display = 'none';
                document.getElementById('pause-timer').style.display = 'inline-flex';
                document.getElementById('stop-timer').style.display = 'inline-flex';
            }
        },
        
        pauseTimer: function() {
            if (app.timer.isRunning) {
                clearInterval(app.timer.interval);
                app.timer.isRunning = false;
                app.timer.isPaused = true;
                
                // Play pause sound
                SoundManager.playPauseSound();
                
                document.getElementById('start-timer').style.display = 'inline-flex';
                document.getElementById('pause-timer').style.display = 'none';
            }
        },
        
        stopTimer: async function() {
            clearInterval(app.timer.interval);
            app.timer.isRunning = false;
            app.timer.isPaused = false;
            
            // Play stop sound
            SoundManager.playStopSound();
            
            // Calculate minutes spent
            const secondsSpent = app.timer.duration - app.timer.remaining;
            if (secondsSpent > 0 && !app.isAdmin) {
                // Convert seconds to minutes and record (round to nearest minute)
                const minutesSpent = Math.round(secondsSpent / 60);
                if (minutesSpent > 0) {
                    await app.recordTime(minutesSpent);
                }
            }
            
            app.timer.remaining = app.timer.duration;
            app.updateTimerDisplay();
            
            document.getElementById('start-timer').style.display = 'inline-flex';
            document.getElementById('pause-timer').style.display = 'none';
            document.getElementById('stop-timer').style.display = 'none';
        },
        
        completeTimer: async function() {
            clearInterval(app.timer.interval);
            app.timer.isRunning = false;
            app.timer.isPaused = false;
            if (!app.isAdmin) {
                // Record 20 minutes when timer completes
                await app.recordTime(20);
                
                // Automatically record timer completion as an activity
                await app.recordTimerCompletion();
            }
            app.timer.remaining = app.timer.duration;
            app.updateTimerDisplay();
            
            // Play completion sound
            SoundManager.playCompleteSound();
            
            document.getElementById('start-timer').style.display = 'inline-flex';
            document.getElementById('pause-timer').style.display = 'none';
            document.getElementById('stop-timer').style.display = 'none';
            
            if (!app.isAdmin) {
                alert('🎉 Great job! You completed your session!');
            }
        },
        
        async recordTimerCompletion() {
            const data = await app.getUserData();
            if (!data) return;
            
            const today = new Date().toISOString().split('T')[0];
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
            });
            
            // Create activity entry for timer completion
            data.activities = data.activities || [];
            data.activities.push({
                date: today,
                text: `⏱️ Timer session completed at ${timeStr}`,
                timestamp: now.toISOString()
            });
            
            await app.saveUserData(data);
            await app.renderTodayActivities();
            await app.renderRecentActivities();
            await app.updateDashboard();
            await app.renderDailySessions(); // Update daily sessions in statistics
        },
        
        updateTimerDisplay: function() {
            const minutes = Math.floor(app.timer.remaining / 60);
            const seconds = app.timer.remaining % 60;
            document.getElementById('timer-display').textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            // Update progress circle
            const progress = ((app.timer.duration - app.timer.remaining) / app.timer.duration) * 565.48;
            document.getElementById('timer-circle').style.strokeDashoffset = 565.48 - progress;
        }
    };
}

