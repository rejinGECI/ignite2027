// Feedback module
import { escapeHtml } from '../utils/helpers.js';

export function createFeedbackModule(app) {
    return {
        async saveReflection() {
            const reflection = document.getElementById('weekly-reflection').value.trim();
            if (!reflection) {
                alert('Please write your reflection!');
                return;
            }
            
            const data = await app.getUserData();
            if (!data) return;
            
            if (!data.reflections) data.reflections = [];
            
            data.reflections.push({
                text: reflection,
                date: new Date().toISOString().split('T')[0],
                timestamp: new Date().toISOString()
            });
            
            await app.saveUserData(data);
            document.getElementById('weekly-reflection').value = '';
            alert('Reflection saved! 💭');
        },
        
        async addFeedbackNote() {
            const note = document.getElementById('new-feedback').value.trim();
            if (!note) {
                alert('Please enter a feedback note!');
                return;
            }
            
            const data = await app.getUserData();
            if (!data) return;
            
            if (!data.feedback) data.feedback = [];
            
            data.feedback.push({
                text: note,
                timestamp: new Date().toISOString()
            });
            
            await app.saveUserData(data);
            document.getElementById('new-feedback').value = '';
            app.renderFeedbackNotes();
        },
        
        async renderFeedbackNotes() {
            const data = await app.getUserData();
            if (!data) return;
            
            const container = document.getElementById('feedback-notes');
            if (!container) return;
            
            const feedback = (data.feedback || []).slice().reverse();
            
            if (feedback.length === 0) {
                container.innerHTML = '<p class="empty-state">No feedback notes yet.</p>';
                return;
            }
            
            container.innerHTML = feedback.map(note => {
                const date = new Date(note.timestamp);
                const formattedDate = date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                return `
                    <div class="feedback-note">
                        <div class="note-date">${formattedDate}</div>
                        <div class="note-text">${escapeHtml(note.text)}</div>
                    </div>
                `;
            }).join('');
        }
    };
}

