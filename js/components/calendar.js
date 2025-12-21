// Calendar module
export function createCalendarModule(app) {
    return {
        async renderCalendar() {
            if (app.isAdmin) return;
            const data = await app.getUserData();
            if (!data) return;
            
            const timeLog = data.timeLog || [];
            const reading = (data.habits?.reading || []);
            
            // Filter by go-live date
            const goLiveDate = await app.getGoLiveDate();
            let filteredTimeLog = timeLog;
            if (goLiveDate) {
                const goLive = new Date(goLiveDate);
                goLive.setHours(0, 0, 0, 0);
                filteredTimeLog = timeLog.filter(log => {
                    const logDate = new Date(log.date);
                    logDate.setHours(0, 0, 0, 0);
                    return logDate >= goLive;
                });
            }
            
            const container = document.getElementById('activity-calendar');
            if (!container) return;
            
            // Get last 30 days
            const days = [];
            for (let i = 29; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                days.push(date.toISOString().split('T')[0]);
            }
            
            container.innerHTML = days.map(date => {
                const log = filteredTimeLog.find(l => l.date === date);
                
                // Check if there's any activity submitted on this date (activity description = completed)
                const dateActivities = (data.activities || []).filter(a => a.date === date);
                const hasActivity = dateActivities.length > 0;
                
                // If activity is submitted OR any minutes logged (> 0), it's completed (partial = full completion)
                const isActive = hasActivity || (log && log.minutes > 0);
                
                // Check if there's reading activity on this date
                const readingEntry = reading.find(r => r.date === date);
                const hasReading = readingEntry && readingEntry.pages > 0;
                const readingPages = hasReading ? readingEntry.pages : 0;
                
                const dayNum = new Date(date).getDate();
                let className = 'calendar-day';
                if (isActive) className += ' active';
                
                // Build title with both timer and reading info
                let title = date + ': ';
                if (hasActivity) {
                    title += 'Activity submitted';
                } else if (log) {
                    title += log.minutes + ' min';
                } else {
                    title += 'Not completed';
                }
                if (hasReading) {
                    title += `, ${readingPages} pages read`;
                }
                
                // Add reading icon if there's reading activity
                const readingIcon = hasReading ? '<i class="fas fa-book calendar-reading-icon" title="' + readingPages + ' pages"></i>' : '';
                
                return `<div class="${className}" title="${title}">
                    <span class="calendar-day-number">${dayNum}</span>
                    ${readingIcon}
                </div>`;
            }).join('');
        }
    };
}

