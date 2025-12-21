// Activities module
import { escapeHtml } from '../utils/helpers.js';

export function createActivitiesModule(app) {
    return {
        async saveActivity() {
            const activityText = document.getElementById('activity-log').value.trim();
            if (!activityText) {
                alert('Please describe what you did today!');
                return;
            }
            
            const data = await app.getUserData();
            if (!data) return;
            
            const today = new Date().toISOString().split('T')[0];
            
            data.activities.push({
                date: today,
                text: activityText,
                timestamp: new Date().toISOString()
            });
            
            // Check if today's progress is less than 20 minutes, if so, mark as completed (20 minutes)
            const existingLog = data.timeLog.find(log => log.date === today);
            if (existingLog) {
                if (existingLog.minutes < 20) {
                    existingLog.minutes = 20; // Mark as completed
                }
            } else {
                // No time log for today, create one with 20 minutes
                data.timeLog.push({
                    date: today,
                    minutes: 20
                });
            }
            
            await app.saveUserData(data);
            document.getElementById('activity-log').value = '';
            app.renderTodayActivities();
            app.renderRecentActivities();
            await app.updateDashboard();
            await app.updateStatistics();
            alert('Activity saved! Keep up the great work! 💪');
        },
        
        async recordTime(minutes) {
            const data = await app.getUserData();
            if (!data) return;
            
            const today = new Date().toISOString().split('T')[0];
            
            const existingLog = data.timeLog.find(log => log.date === today);
            if (existingLog) {
                existingLog.minutes += minutes;
            } else {
                data.timeLog.push({
                    date: today,
                    minutes: minutes
                });
            }
            
            await app.saveUserData(data);
            await app.updateDashboard();
            await app.updateStatistics();
        },
        
        async renderTodayActivities() {
            const data = await app.getUserData();
            if (!data) return;
            
            const today = new Date().toISOString().split('T')[0];
            const todayActivities = (data.activities || []).filter(a => a.date === today);
            
            const container = document.getElementById('today-activities-list');
            if (todayActivities.length === 0) {
                container.innerHTML = '<p class="empty-state">No activities logged yet for today.</p>';
                return;
            }
            
            container.innerHTML = todayActivities.map(activity => {
                const time = new Date(activity.timestamp).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                return `
                    <div class="activity-entry">
                        <div>
                            <div class="activity-text">${escapeHtml(activity.text)}</div>
                            <div class="activity-time">Logged at ${time}</div>
                        </div>
                    </div>
                `;
            }).join('');
        },
        
        async renderRecentActivities() {
            const data = await app.getUserData();
            if (!data) return;
            
            const recent = (data.activities || []).slice(-5).reverse();
            
            const container = document.getElementById('recent-activities');
            if (recent.length === 0) {
                container.innerHTML = '<p class="empty-state">No activities yet. Start your journey today!</p>';
                return;
            }
            
            container.innerHTML = recent.map(activity => {
                const date = new Date(activity.date);
                const formattedDate = date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                });
                return `
                    <div class="activity-item">
                        <div class="activity-date">${formattedDate}</div>
                        <div class="activity-text">${escapeHtml(activity.text)}</div>
                    </div>
                `;
            }).join('');
        },
        
        async showAllActivities() {
            const data = await app.getUserData();
            if (!data) return;
            
            const allActivities = (data.activities || []).slice().reverse();
            
            // Create modal HTML
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header" style="flex-shrink: 0;">
                        <h2>All Activities</h2>
                        <button class="btn-icon" onclick="this.closest('.modal').remove()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-primary);">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        ${allActivities.length === 0 
                            ? '<p class="empty-state">No activities yet. Start your journey today!</p>'
                            : allActivities.map(activity => {
                                const date = new Date(activity.date);
                                const time = new Date(activity.timestamp);
                                const formattedDate = date.toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric'
                                });
                                const formattedTime = time.toLocaleTimeString('en-US', {
                                    hour: '2-digit',
                                    minute: '2-digit'
                                });
                                return `
                                    <div class="activity-item" style="margin-bottom: 1rem; padding: 1rem; background: var(--card-bg); border-radius: 8px; border-left: 4px solid var(--primary-color);">
                                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                                            <div class="activity-date" style="font-weight: 600; color: var(--text-primary);">${formattedDate}</div>
                                            <div style="font-size: 0.85rem; color: var(--text-secondary);">${formattedTime}</div>
                                        </div>
                                        <div class="activity-text" style="color: var(--text-primary); line-height: 1.6;">${escapeHtml(activity.text)}</div>
                                    </div>
                                `;
                            }).join('')
                        }
                    </div>
                </div>
            `;
            
            // Add click outside to close
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
            
            document.body.appendChild(modal);
        }
    };
}

