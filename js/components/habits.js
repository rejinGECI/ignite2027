// Habits module (Reading and Custom Habits)
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc, setDoc, collection, addDoc, query, orderBy, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function createHabitsModule(app) {
    return {
        async saveReading() {
            const pages = parseInt(document.getElementById('pages-read').value);
            if (isNaN(pages) || pages < 0) {
                alert('Please enter a valid number of pages!');
                return;
            }
            
            const bookName = document.getElementById('book-name').value.trim();
            const authorName = document.getElementById('author-name').value.trim();
            const notes = document.getElementById('reading-notes').value.trim();
            
            if (!bookName) {
                alert('Please enter a book name!');
                return;
            }
            
            const data = await app.getUserData();
            if (!data) return;
            
            const today = new Date().toISOString().split('T')[0];
            
            if (!data.habits) data.habits = { reading: [], custom: [], books: [] };
            if (!data.habits.reading) data.habits.reading = [];
            if (!data.habits.books) data.habits.books = [];
            
            // Store book info for dropdown
            const bookKey = `${bookName}|${authorName}`.toLowerCase();
            const existingBook = data.habits.books.find(b => b.key === bookKey);
            if (!existingBook) {
                data.habits.books.push({
                    key: bookKey,
                    bookName: bookName,
                    authorName: authorName
                });
            }
            
            data.habits.reading.push({
                date: today,
                pages: pages,
                bookName: bookName,
                authorName: authorName,
                notes: notes || '',
                timestamp: new Date().toISOString()
            });
            
            await app.saveUserData(data);
            
            // Clear form
            document.getElementById('pages-read').value = '';
            document.getElementById('book-name').value = '';
            document.getElementById('author-name').value = '';
            document.getElementById('reading-notes').value = '';
            document.getElementById('book-select').value = '';
            
            // Update dropdown and stats
            await app.loadBookDropdown();
            app.updateReadingStats();
            alert('Reading logged! 📚');
        },
        
        async updateReadingStats() {
            const data = await app.getUserData();
            const today = new Date().toISOString().split('T')[0];
            
            const reading = (data.habits?.reading || []);
            const todayReading = reading.filter(r => r.date === today);
            const todayPages = todayReading.reduce((sum, r) => sum + r.pages, 0);
            document.getElementById('today-pages').textContent = todayPages;
            
            // This week
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            const weekReading = reading.filter(r => new Date(r.date) >= weekAgo);
            const weekPages = weekReading.reduce((sum, r) => sum + r.pages, 0);
            document.getElementById('week-pages').textContent = weekPages;
            
            // Total
            const totalPages = reading.reduce((sum, r) => sum + r.pages, 0);
            document.getElementById('total-pages').textContent = totalPages;
            
            // Reading streak
            const readingStreak = app.calculateReadingStreak(reading);
            document.getElementById('reading-streak').textContent = readingStreak;
        },
        
        calculateReadingStreak: function(reading) {
            if (!reading || reading.length === 0) return 0;
            
            // Get unique dates and sort descending
            const uniqueDates = [...new Set(reading.map(r => r.date))].sort((a, b) => new Date(b) - new Date(a));
            
            if (uniqueDates.length === 0) return 0;
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            let streak = 0;
            let expectedDate = new Date(today);
            
            for (let i = 0; i < uniqueDates.length; i++) {
                const readingDate = new Date(uniqueDates[i]);
                readingDate.setHours(0, 0, 0, 0);
                
                const daysDiff = Math.floor((expectedDate - readingDate) / (1000 * 60 * 60 * 24));
                
                if (i === 0) {
                    // First date - check if it's today or yesterday
                    if (daysDiff === 0 || daysDiff === 1) {
                        streak = 1;
                        expectedDate = new Date(readingDate);
                        expectedDate.setDate(expectedDate.getDate() - 1);
                    } else {
                        // Gap found, streak broken
                        break;
                    }
                } else {
                    // Check if consecutive
                    if (daysDiff === 0) {
                        streak++;
                        expectedDate.setDate(expectedDate.getDate() - 1);
                    } else {
                        // Gap found, streak broken
                        break;
                    }
                }
            }
            
            return streak;
        },
        
        async loadBookDropdown() {
            const data = await app.getUserData();
            if (!data) return;
            
            const books = (data.habits?.books || []);
            const select = document.getElementById('book-select');
            if (!select) return;
            
            // Clear existing options except the first one
            while (select.children.length > 1) {
                select.removeChild(select.lastChild);
            }
            
            // Add books to dropdown
            books.forEach(book => {
                const option = document.createElement('option');
                option.value = book.key;
                option.textContent = `${book.bookName}${book.authorName ? ' by ' + book.authorName : ''}`;
                option.setAttribute('data-book-name', book.bookName);
                option.setAttribute('data-author-name', book.authorName || '');
                select.appendChild(option);
            });
        },
        
        onBookSelect() {
            const select = document.getElementById('book-select');
            if (!select || !select.value) return;
            
            const selectedOption = select.options[select.selectedIndex];
            const bookName = selectedOption.getAttribute('data-book-name');
            const authorName = selectedOption.getAttribute('data-author-name') || '';
            
            if (bookName) {
                document.getElementById('book-name').value = bookName;
                document.getElementById('author-name').value = authorName;
            }
        },
        
        async suggestBook() {
            const bookName = document.getElementById('suggest-book-name').value.trim();
            const note = document.getElementById('suggest-book-note').value.trim();
            
            if (!bookName) {
                alert('Please enter a book name!');
                return;
            }
            
            if (!note) {
                alert('Please add a note explaining why you recommend this book!');
                return;
            }
            
            if (!app.currentUser) return;
            
            try {
                // Get user info
                const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
                const userDoc = await getDoc(doc(window.firebaseDb, 'users', app.currentUser.uid));
                const userData = userDoc.data();
                const studentName = userData?.name || 'Unknown';
                const ktuid = userData?.username || userData?.ktuid || 'Unknown';
                
                // Save suggestion to Firestore
                await addDoc(collection(window.firebaseDb, 'bookSuggestions'), {
                    bookName: bookName,
                    note: note,
                    studentName: studentName,
                    ktuid: ktuid,
                    suggestedBy: app.currentUser.uid,
                    createdAt: new Date().toISOString(),
                    timestamp: serverTimestamp()
                });
                
                // Clear form
                document.getElementById('suggest-book-name').value = '';
                document.getElementById('suggest-book-note').value = '';
                
                // Reload suggestions
                await app.loadBookSuggestions();
                
                alert('Book suggestion added! 📚');
            } catch (error) {
                console.error('Error suggesting book:', error);
                alert('Error adding suggestion. Please try again.');
            }
        },
        
        async loadBookSuggestions() {
            const suggestionsList = document.getElementById('book-suggestions-list');
            if (!suggestionsList) return;
            
            try {
                // Get user's hidden books preference
                if (!app.currentUser) return;
                const userDataDoc = await getDoc(doc(window.firebaseDb, 'userData', app.currentUser.uid));
                const userData = userDataDoc.exists() ? userDataDoc.data() : {};
                const hiddenBookIds = userData.hiddenBookIds || [];
                
                // Get all book suggestions from Firestore
                const suggestionsRef = collection(window.firebaseDb, 'bookSuggestions');
                const q = query(suggestionsRef, orderBy('createdAt', 'desc'));
                const querySnapshot = await getDocs(q);
                
                if (querySnapshot.empty) {
                    suggestionsList.innerHTML = '<p class="empty-state">No book suggestions yet. Be the first to suggest a book!</p>';
                    return;
                }
                
                let html = '';
                let visibleCount = 0;
                
                querySnapshot.forEach((doc) => {
                    const suggestion = doc.data();
                    const suggestionId = doc.id;
                    
                    // Skip if this book is hidden by the user
                    if (hiddenBookIds.includes(suggestionId)) {
                        return;
                    }
                    
                    // Only show published suggestions
                    if (suggestion.published === false) {
                        return;
                    }
                    
                    visibleCount++;
                    const date = new Date(suggestion.createdAt).toLocaleDateString();
                    
                    html += `
                        <div class="book-suggestion-item" style="background: var(--card-bg); border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: var(--shadow); border-left: 4px solid var(--primary-color); position: relative;">
                            <button onclick="app.hideBookSuggestion('${suggestionId}')" style="position: absolute; top: 1rem; right: 1rem; background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1.2rem; padding: 0.5rem;" title="Hide this suggestion">
                                <i class="fas fa-eye-slash"></i>
                            </button>
                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                                <h5 style="margin: 0; color: var(--text-primary); font-size: 1.1rem;">
                                    <i class="fas fa-book" style="color: var(--primary-color); margin-right: 0.5rem;"></i>
                                    ${escapeHtml(suggestion.bookName)}
                                </h5>
                                <span style="font-size: 0.85rem; color: var(--text-secondary);">${date}</span>
                            </div>
                            <p style="color: var(--text-primary); margin: 1rem 0; line-height: 1.6;">${escapeHtml(suggestion.note)}</p>
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                                <i class="fas fa-user" style="color: var(--text-secondary);"></i>
                                <span style="color: var(--text-secondary); font-size: 0.9rem;">
                                    Suggested by <strong style="color: var(--primary-color);">${escapeHtml(suggestion.studentName)}</strong> 
                                    <span style="color: var(--text-secondary);">(${escapeHtml(suggestion.ktuid)})</span>
                                </span>
                            </div>
                        </div>
                    `;
                });
                
                if (visibleCount === 0) {
                    suggestionsList.innerHTML = '<p class="empty-state">No book suggestions to display. You may have hidden all suggestions.</p>';
                } else {
                    suggestionsList.innerHTML = html;
                }
            } catch (error) {
                console.error('Error loading book suggestions:', error);
                suggestionsList.innerHTML = '<p class="empty-state">Error loading suggestions. Please try again.</p>';
            }
        },
        
        async hideBookSuggestion(bookId) {
            try {
                if (!app.currentUser) return;
                const userDataDoc = await getDoc(doc(window.firebaseDb, 'userData', app.currentUser.uid));
                const userData = userDataDoc.exists() ? userDataDoc.data() : {};
                const hiddenBookIds = userData.hiddenBookIds || [];
                
                if (!hiddenBookIds.includes(bookId)) {
                    hiddenBookIds.push(bookId);
                    await setDoc(doc(window.firebaseDb, 'userData', app.currentUser.uid), {
                        hiddenBookIds: hiddenBookIds
                    }, { merge: true });
                }
                
                // Reload suggestions to update the display
                await app.loadBookSuggestions();
            } catch (error) {
                console.error('Error hiding book suggestion:', error);
                alert('Error hiding book suggestion. Please try again.');
            }
        },
        
        async addCustomHabit() {
            const habitName = document.getElementById('new-habit-name').value.trim();
            if (!habitName) {
                alert('Please enter a habit name!');
                return;
            }
            
            const data = await app.getUserData();
            if (!data.habits) data.habits = { reading: [], custom: [], books: [] };
            if (!data.habits.custom) data.habits.custom = [];
            
            data.habits.custom.push({
                id: Date.now(),
                name: habitName,
                entries: []
            });
            
            await app.saveUserData(data);
            document.getElementById('new-habit-name').value = '';
            await app.renderCustomHabits();
        },
        
        async renderCustomHabits() {
            const data = await app.getUserData();
            if (!data) return;
            
            const container = document.getElementById('custom-habits-list');
            if (!container) return;
            
            const habits = data.habits?.custom || [];
            
            if (habits.length === 0) {
                container.innerHTML = '<p class="empty-state">No habits yet. Add your first habit above!</p>';
                return;
            }
            
            const today = new Date().toISOString().split('T')[0];
            
            container.innerHTML = habits.map(habit => {
                const todayEntry = habit.entries.find(e => e.date === today);
                const isChecked = todayEntry ? todayEntry.completed : false;
                const minutes = todayEntry ? (todayEntry.minutes || 0) : 0;
                
                // Calculate habit stats
                const totalEntries = habit.entries.length;
                const completedEntries = habit.entries.filter(e => e.completed).length;
                const totalMinutes = habit.entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
                const completionRate = totalEntries > 0 ? Math.round((completedEntries / totalEntries) * 100) : 0;
                
                return `
                    <div class="custom-habit-item">
                        <div class="habit-item-header">
                            <div class="habit-name-section">
                                <h4>${escapeHtml(habit.name)}</h4>
                                <div class="habit-stats-inline">
                                    <span class="stat-badge">${completionRate}% complete</span>
                                    <span class="stat-badge">${totalMinutes} min total</span>
                                </div>
                            </div>
                            <div style="display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary btn-sm" onclick="app.showHabitDetails(${habit.id})" title="View habit details">
                                    <i class="fas fa-info-circle"></i> Details
                                </button>
                                <button class="btn-icon" onclick="app.deleteHabit(${habit.id})" title="Delete habit">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                        <div class="habit-item-controls">
                            <label class="habit-checkbox-label">
                                <input type="checkbox" class="habit-checkbox" ${isChecked ? 'checked' : ''} 
                                       onchange="app.toggleHabit(${habit.id}, this.checked)">
                                <span>Completed Today</span>
                            </label>
                            <div class="habit-time-section">
                                <label>Time Spent (minutes):</label>
                                <input type="number" id="habit-time-${habit.id}" min="0" value="${minutes}" 
                                       placeholder="0" class="habit-time-input"
                                       onchange="app.saveHabitTime(${habit.id}, this.value)">
                                <button class="btn btn-secondary btn-sm" onclick="app.saveHabitTime(${habit.id}, document.getElementById('habit-time-${habit.id}').value)">
                                    <i class="fas fa-save"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
            
            // Update habit statistics if method exists
            if (app.renderHabitStatistics) {
                await app.renderHabitStatistics();
            }
        },
        
        async toggleHabit(habitId, completed) {
            const data = await app.getUserData();
            if (!data || !data.habits) return;
            
            const habit = data.habits.custom.find(h => h.id === habitId);
            if (!habit) return;
            
            const today = new Date().toISOString().split('T')[0];
            let existingEntry = habit.entries.find(e => e.date === today);
            
            if (existingEntry) {
                existingEntry.completed = completed;
            } else {
                existingEntry = {
                    date: today,
                    completed: completed,
                    minutes: 0,
                    timestamp: new Date().toISOString()
                };
                habit.entries.push(existingEntry);
            }
            
            await app.saveUserData(data);
            await app.renderCustomHabits();
        },
        
        async saveHabitTime(habitId, minutes) {
            const minutesNum = parseInt(minutes) || 0;
            if (minutesNum < 0) {
                alert('Please enter a valid number of minutes!');
                return;
            }
            
            const data = await app.getUserData();
            if (!data || !data.habits) return;
            
            const habit = data.habits.custom.find(h => h.id === habitId);
            if (!habit) return;
            
            const today = new Date().toISOString().split('T')[0];
            let existingEntry = habit.entries.find(e => e.date === today);
            
            if (existingEntry) {
                existingEntry.minutes = minutesNum;
            } else {
                existingEntry = {
                    date: today,
                    completed: false,
                    minutes: minutesNum,
                    timestamp: new Date().toISOString()
                };
                habit.entries.push(existingEntry);
            }
            
            await app.saveUserData(data);
            await app.renderCustomHabits();
        },
        
        async deleteHabit(habitId) {
            if (!confirm('Are you sure you want to delete this habit? This action cannot be undone.')) {
                return;
            }
            
            const data = await app.getUserData();
            if (!data || !data.habits) return;
            
            data.habits.custom = data.habits.custom.filter(h => h.id !== habitId);
            await app.saveUserData(data);
            await app.renderCustomHabits();
        },
        
        async showHabitDetails(habitId) {
            const data = await app.getUserData();
            if (!data || !data.habits) return;
            
            const habit = data.habits.custom.find(h => h.id === habitId);
            if (!habit) return;
            
            const totalEntries = habit.entries.length;
            const completedEntries = habit.entries.filter(e => e.completed).length;
            const totalMinutes = habit.entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
            const completionRate = totalEntries > 0 ? Math.round((completedEntries / totalEntries) * 100) : 0;
            
            // Sort entries by date (most recent first)
            const sortedEntries = [...habit.entries].sort((a, b) => new Date(b.date) - new Date(a.date));
            
            // Create modal HTML (simplified version - full version would be longer)
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header" style="flex-shrink: 0;">
                        <h2>${escapeHtml(habit.name)} - Details</h2>
                        <button class="btn-icon" onclick="this.closest('.modal').remove()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-primary);">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem;">
                            <div style="text-align: center; padding: 1rem; background: var(--card-bg); border-radius: 8px;">
                                <div style="font-size: 2rem; font-weight: bold; color: var(--primary-color);">${completionRate}%</div>
                                <div style="color: var(--text-secondary); margin-top: 0.5rem;">Completion Rate</div>
                            </div>
                            <div style="text-align: center; padding: 1rem; background: var(--card-bg); border-radius: 8px;">
                                <div style="font-size: 2rem; font-weight: bold; color: var(--primary-color);">${totalEntries}</div>
                                <div style="color: var(--text-secondary); margin-top: 0.5rem;">Total Entries</div>
                            </div>
                            <div style="text-align: center; padding: 1rem; background: var(--card-bg); border-radius: 8px;">
                                <div style="font-size: 2rem; font-weight: bold; color: var(--primary-color);">${totalMinutes}</div>
                                <div style="color: var(--text-secondary); margin-top: 0.5rem;">Total Minutes</div>
                            </div>
                        </div>
                        <h3 style="margin-bottom: 1rem;">Recent Entries</h3>
                        <div style="max-height: 400px; overflow-y: auto;">
                            ${sortedEntries.length === 0 
                                ? '<p class="empty-state">No entries yet.</p>'
                                : sortedEntries.map(entry => {
                                    const date = new Date(entry.date);
                                    const formattedDate = date.toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        year: 'numeric'
                                    });
                                    return `
                                        <div style="padding: 1rem; background: var(--card-bg); border-radius: 8px; margin-bottom: 0.5rem;">
                                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                                <div>
                                                    <div style="font-weight: 600; color: var(--text-primary);">${formattedDate}</div>
                                                    <div style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 0.25rem;">
                                                        ${entry.completed ? '✅ Completed' : '❌ Not completed'} 
                                                        ${entry.minutes > 0 ? ` • ${entry.minutes} minutes` : ''}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                }).join('')
                            }
                        </div>
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

