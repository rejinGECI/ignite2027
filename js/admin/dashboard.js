// Admin Dashboard module
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc, updateDoc, deleteDoc, setDoc, collection, query, where, getDocs, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function createAdminDashboardModule(app) {
    return {
        async loadStudentsList() {
            const container = document.getElementById('students-list');
            if (!container) {
                console.error('Students list container not found');
                return;
            }
            
            container.innerHTML = '<div class="loading-state">Loading students...</div>';
            
            try {
                // Check if user is admin
                if (!app.isAdmin && app.userRole !== 'admin') {
                    container.innerHTML = '<div class="error-message">Access denied. Admin access required.</div>';
                    return;
                }
                
                const usersQuery = query(
                    collection(window.firebaseDb, 'users'),
                    where('role', '==', 'student')
                );
                const usersSnapshot = await getDocs(usersQuery);
                
                const students = [];
                for (const userDoc of usersSnapshot.docs) {
                    const userData = userDoc.data();
                    const studentDataDoc = await getDoc(doc(window.firebaseDb, 'userData', userDoc.id));
                    const studentData = studentDataDoc.exists() ? studentDataDoc.data() : {};
                    
                    const timeLog = studentData.timeLog || [];
                    
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
                    
                    const streak = await app.calculateStreak(timeLog);
                    const totalMinutes = filteredTimeLog.reduce((sum, log) => sum + log.minutes, 0);
                    const uniqueDays = new Set(filteredTimeLog.map(log => log.date)).size;
                    
                    students.push({
                        id: userDoc.id,
                        name: userData.name || userData.username || 'Unknown',
                        username: userData.username || userData.name || 'Unknown',
                        email: userData.email || '',
                        streak: streak.current,
                        totalMinutes: totalMinutes,
                        daysActive: uniqueDays
                    });
                }
                
                // Sort students by name
                students.sort((a, b) => a.name.localeCompare(b.name));
                
                // Store students for search
                app.allStudents = students;
                
                if (students.length === 0) {
                    container.innerHTML = '<div class="empty-state">No students found. Upload a CSV file to create student accounts.</div>';
                    return;
                }
                
                container.innerHTML = students.map(student => `
                    <div class="student-card" data-student-id="${escapeHtml(student.id)}" data-student-name="${escapeHtml(student.name.toLowerCase())}" data-student-ktuid="${escapeHtml(student.username.toLowerCase())}">
                        <div class="student-header">
                            <div>
                                <div class="student-name">${escapeHtml(student.name)}</div>
                                <div class="student-email">KTU ID: ${escapeHtml(student.username)}</div>
                            </div>
                            <button type="button" class="btn btn-danger btn-sm" title="Delete student" onclick="app.deleteStudent('${escapeHtml(student.id)}')">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                        <div class="student-stats">
                            <div class="student-stat">
                                <div class="student-stat-value">${student.streak}</div>
                                <div class="student-stat-label">Day Streak</div>
                            </div>
                            <div class="student-stat">
                                <div class="student-stat-value">${student.totalMinutes}</div>
                                <div class="student-stat-label">Total Minutes</div>
                            </div>
                            <div class="student-stat">
                                <div class="student-stat-value">${student.daysActive}</div>
                                <div class="student-stat-label">Days Active</div>
                            </div>
                            <div class="student-stat">
                                <div class="student-stat-value">${Math.floor(student.totalMinutes / 60)}</div>
                                <div class="student-stat-label">Total Hours</div>
                            </div>
                        </div>
                    </div>
                `).join('');
                
                // Setup search functionality
                app.setupStudentSearch();
            } catch (error) {
                console.error('Error loading students:', error);
                let errorMessage = error.message;
                
                // Provide helpful error messages
                if (error.code === 'permission-denied' || error.message.includes('permission')) {
                    errorMessage = `
                        <div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 8px; padding: 1rem; margin: 1rem 0;">
                            <strong style="color: #dc2626;">⚠️ Permission Denied</strong><br>
                            <p style="margin: 0.5rem 0; color: #991b1b;">
                                Firestore security rules need to be updated to allow admin access.<br>
                                See <code>FIRESTORE_SECURITY_RULES.md</code> for instructions.
                            </p>
                            <p style="margin: 0.5rem 0; color: #991b1b; font-size: 0.9rem;">
                                Go to Firebase Console → Firestore Database → Rules and update the rules.
                            </p>
                        </div>
                    `;
                }
                
                container.innerHTML = `<div class="error-message">${errorMessage}</div>`;
            }
        },
        
        async loadAllStudentFeedback() {
            const container = document.getElementById('all-feedback-container');
            if (!container) return;
            
            if (!app.isAdmin && app.userRole !== 'admin') {
                container.innerHTML = '<div class="error-message">Access denied. Admin access required.</div>';
                return;
            }
            
            container.innerHTML = '<div class="loading-state">Loading feedback...</div>';
            
            try {
                const usersQuery = query(
                    collection(window.firebaseDb, 'users'),
                    where('role', '==', 'student')
                );
                const usersSnapshot = await getDocs(usersQuery);
                
                const allFeedback = [];
                
                for (const userDoc of usersSnapshot.docs) {
                    const userData = userDoc.data();
                    const studentDataDoc = await getDoc(doc(window.firebaseDb, 'userData', userDoc.id));
                    const studentData = studentDataDoc.exists() ? studentDataDoc.data() : {};
                    
                    const feedback = studentData.feedback || [];
                    
                    feedback.forEach(fb => {
                        allFeedback.push({
                            studentName: userData.name || userData.username || 'Unknown',
                            studentKtuid: userData.username || 'Unknown',
                            text: fb.text,
                            timestamp: fb.timestamp
                        });
                    });
                }
                
                // Sort by timestamp (most recent first)
                allFeedback.sort((a, b) => {
                    const timeA = new Date(a.timestamp).getTime();
                    const timeB = new Date(b.timestamp).getTime();
                    return timeB - timeA;
                });
                
                if (allFeedback.length === 0) {
                    container.innerHTML = '<p class="empty-state">No feedback from students yet.</p>';
                    return;
                }
                
                container.innerHTML = allFeedback.map(fb => {
                    const date = new Date(fb.timestamp);
                    const formattedDate = date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    
                    return `
                        <div class="admin-feedback-item">
                            <div class="admin-feedback-header">
                                <div class="admin-feedback-student">
                                    <strong>${escapeHtml(fb.studentName)}</strong>
                                    <span class="admin-feedback-ktuid">KTU ID: ${escapeHtml(fb.studentKtuid)}</span>
                                </div>
                                <div class="admin-feedback-date">${formattedDate}</div>
                            </div>
                            <div class="admin-feedback-text">${escapeHtml(fb.text)}</div>
                        </div>
                    `;
                }).join('');
            } catch (error) {
                console.error('Error loading feedback:', error);
                container.innerHTML = `<div class="error-message">Error loading feedback: ${error.message}</div>`;
            }
        },
        
        async loadAllBookSuggestions() {
            const container = document.getElementById('admin-book-suggestions-container');
            if (!container) return;
            
            if (!app.isAdmin && app.userRole !== 'admin') {
                container.innerHTML = '<div class="error-message">Access denied. Admin access required.</div>';
                return;
            }
            
            container.innerHTML = '<div class="loading-state">Loading book suggestions...</div>';
            
            try {
                const suggestionsRef = collection(window.firebaseDb, 'bookSuggestions');
                const q = query(suggestionsRef, orderBy('createdAt', 'desc'));
                const querySnapshot = await getDocs(q);
                
                if (querySnapshot.empty) {
                    container.innerHTML = '<p class="empty-state">No book suggestions yet.</p>';
                    return;
                }
                
                container.innerHTML = querySnapshot.docs.map(doc => {
                    const suggestion = doc.data();
                    const date = new Date(suggestion.createdAt).toLocaleDateString();
                    
                    return `
                        <div class="admin-book-suggestion-item" style="background: var(--card-bg); border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: var(--shadow); border-left: 4px solid var(--primary-color);">
                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                                <div>
                                    <strong><i class="fas fa-book" style="color: var(--primary-color); margin-right: 0.5rem;"></i>${escapeHtml(suggestion.bookName)}</strong>
                                    <span class="admin-feedback-ktuid">Suggested by ${escapeHtml(suggestion.studentName)} (${escapeHtml(suggestion.ktuid)})</span>
                                </div>
                                <span style="font-size: 0.85rem; color: var(--text-secondary);">${date}</span>
                            </div>
                            <p style="color: var(--text-primary); margin: 1rem 0; line-height: 1.6;">${escapeHtml(suggestion.note)}</p>
                            <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                                <button class="btn btn-primary btn-sm" onclick="app.publishBookSuggestion('${doc.id}', true)" ${suggestion.published !== false ? 'disabled' : ''}>
                                    <i class="fas fa-check"></i> Publish
                                </button>
                                <button class="btn btn-secondary btn-sm" onclick="app.publishBookSuggestion('${doc.id}', false)" ${suggestion.published === false ? 'disabled' : ''}>
                                    <i class="fas fa-eye-slash"></i> Unpublish
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');
            } catch (error) {
                console.error('Error loading book suggestions:', error);
                container.innerHTML = `<div class="error-message">Error loading suggestions: ${error.message}</div>`;
            }
        },
        
        setupStudentSearch: function() {
            const searchInput = document.getElementById('search-students');
            if (!searchInput) return;
            
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                document.querySelectorAll('.student-card').forEach(card => {
                    const name = card.dataset.studentName || card.querySelector('.student-name')?.textContent.toLowerCase() || '';
                    const ktuid = card.dataset.studentKtuid || card.querySelector('.student-email')?.textContent.toLowerCase() || '';
                    if (name.includes(searchTerm) || ktuid.includes(searchTerm)) {
                        card.style.display = 'block';
                    } else {
                        card.style.display = 'none';
                    }
                });
            });
        },

        async cleanupStudentReferences(studentId) {
            const seminarRef = doc(window.firebaseDb, 'settings', 'seminar');
            const seminarSnap = await getDoc(seminarRef);
            if (seminarSnap.exists()) {
                const data = seminarSnap.data();
                const updates = {};

                if (data.guideAssignments?.[studentId]) {
                    const guideAssignments = { ...data.guideAssignments };
                    delete guideAssignments[studentId];
                    updates.guideAssignments = guideAssignments;
                }
                if (data.presentationAssignments?.[studentId]) {
                    const presentationAssignments = { ...data.presentationAssignments };
                    delete presentationAssignments[studentId];
                    updates.presentationAssignments = presentationAssignments;
                }
                if (Array.isArray(data.presentations) && data.presentations.length) {
                    updates.presentations = data.presentations
                        .filter(p => p.studentId !== studentId)
                        .map(p => ({
                            ...p,
                            questionerIds: (p.questionerIds || []).filter(id => id !== studentId),
                            questionerScores: Object.fromEntries(
                                Object.entries(p.questionerScores || {}).filter(([id]) => id !== studentId)
                            )
                        }));
                }
                if (data.questionFairness?.[studentId]) {
                    const questionFairness = { ...data.questionFairness };
                    delete questionFairness[studentId];
                    updates.questionFairness = questionFairness;
                }

                if (Object.keys(updates).length) {
                    await setDoc(seminarRef, updates, { merge: true });
                }
            }

            const teamsSnap = await getDocs(collection(window.firebaseDb, 'projectGroups'));
            for (const teamDoc of teamsSnap.docs) {
                const team = teamDoc.data();
                const members = team.members || [];
                const filtered = members.filter(m =>
                    m.id !== studentId && m.uid !== studentId && m.studentId !== studentId
                );
                if (filtered.length !== members.length) {
                    await updateDoc(teamDoc.ref, { members: filtered });
                }
            }
        },

        async deleteStudent(studentId) {
            if (!app.isAdmin && app.userRole !== 'admin') {
                alert('Only administrators can delete students.');
                return;
            }

            const userSnap = await getDoc(doc(window.firebaseDb, 'users', studentId));
            if (!userSnap.exists()) {
                alert('Student not found.');
                return;
            }

            const userData = userSnap.data();
            if (userData.role !== 'student') {
                alert('This account is not a student.');
                return;
            }

            const label = userData.name || userData.username || 'this student';
            if (!confirm(`Delete "${label}"?\n\nThis removes their profile and activity data from IGNITE. This cannot be undone.`)) {
                return;
            }

            try {
                await this.cleanupStudentReferences(studentId);
                await deleteDoc(doc(window.firebaseDb, 'userData', studentId));
                await updateDoc(doc(window.firebaseDb, 'users', studentId), {
                    role: 'deleted',
                    deletedAt: new Date().toISOString()
                });

                if (app.allStudents) {
                    app.allStudents = app.allStudents.filter(s => s.id !== studentId);
                }

                await this.loadStudentsList();
                alert('Student deleted successfully.');
            } catch (error) {
                console.error('Error deleting student:', error);
                alert('Error deleting student. Please try again.');
            }
        },
        
        async publishBookSuggestion(bookId, published) {
            if (!app.isAdmin && app.userRole !== 'admin') {
                alert('Only administrators can publish book suggestions.');
                return;
            }
            
            try {
                await updateDoc(doc(window.firebaseDb, 'bookSuggestions', bookId), {
                    published: published,
                    updatedAt: new Date().toISOString()
                });
                
                // Reload the book suggestions list
                await app.loadAllBookSuggestions();
            } catch (error) {
                console.error('Error publishing book suggestion:', error);
                alert('Error updating book suggestion. Please try again.');
            }
        }
    };
}

