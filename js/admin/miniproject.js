// Admin MiniProject module
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function createAdminMiniProjectModule(app) {
    return {
        async loadMiniProjectSettings() {
            if (!app.isAdmin) return;
            
            const enabled = await app.isMiniProjectEnabled();
            const checkbox = document.getElementById('miniproject-enabled');
            if (checkbox) {
                checkbox.checked = enabled;
            }
            
            // Load evaluation stages
            await app.loadEvaluationStages();
            
            // Load evaluator stage dropdown
            await app.loadEvaluatorStageDropdown();
            
            // Load team order settings
            await app.loadTeamOrderSettings();
            
            // Load important dates
            await app.loadImportantDates();
        },
        
        async loadGuidesList() {
            if (!app.isAdmin) return;
            
            const container = document.getElementById('guides-list');
            if (!container) return;
            
            try {
                const guidesQuery = query(
                    collection(window.firebaseDb, 'users'),
                    where('role', '==', 'guide')
                );
                const guidesSnapshot = await getDocs(guidesQuery);
                
                const guides = [];
                guidesSnapshot.forEach(doc => {
                    const data = doc.data();
                    guides.push({
                        id: doc.id,
                        name: data.name || 'Unknown',
                        email: data.email || '',
                        username: data.username || '',
                        password: data.password || '' // Include password for report generation
                    });
                });
                
                if (guides.length === 0) {
                    container.innerHTML = '<p class="empty-state">No guides created yet.</p>';
                    return;
                }
                
                container.innerHTML = guides.map(guide => `
                    <div class="guide-item">
                        <div class="guide-info">
                            <strong>${escapeHtml(guide.name)}</strong>
                            <span class="guide-email">${escapeHtml(guide.email)}</span>
                        </div>
                        <div class="guide-actions">
                            <button type="button" class="btn btn-primary btn-sm" onclick="app.editGuide('${guide.id}')">
                                <i class="fas fa-edit"></i> Edit
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="app.deleteGuide('${guide.id}')">
                                <i class="fas fa-trash"></i> Delete
                            </button>
                        </div>
                    </div>
                `).join('');
            } catch (error) {
                if (error.code === 'permission-denied' || error.message?.includes('permission')) {
                    container.innerHTML = '<p class="error-message">Permission denied. Please update Firestore security rules to allow admin access to users collection.</p>';
                } else {
                    console.error('Error loading guides:', error);
                    container.innerHTML = '<p class="error-message">Error loading guides.</p>';
                }
            }
        },
        
        async loadProjectTeams() {
            if (!app.isAdmin) return;
            
            const container = document.getElementById('project-teams-list');
            if (!container) return;
            
            try {
                const teamsQuery = query(collection(window.firebaseDb, 'projectGroups')); // Keep collection name for backward compatibility
                const teamsSnapshot = await getDocs(teamsQuery);
                
                const teams = [];
                teamsSnapshot.forEach(doc => {
                    const data = doc.data();
                    if (!data.deleted) { // Filter out deleted teams
                        teams.push({
                            id: doc.id,
                            ...data
                        });
                    }
                });
                
                if (teams.length === 0) {
                    container.innerHTML = '<p class="empty-state">No project teams created yet.</p>';
                    return;
                }
                
                container.innerHTML = teams.map(team => `
                    <div class="project-team-item">
                        <div class="team-header">
                            <h4>${escapeHtml(team.groupName || 'Unnamed Team')}</h4>
                            <div class="team-actions">
                                <button type="button" class="btn btn-primary btn-sm" onclick="app.editTeam('${team.id}')">
                                    <i class="fas fa-edit"></i> Edit
                                </button>
                                <button type="button" class="btn btn-secondary btn-sm" onclick="app.deleteTeam('${team.id}')">
                                    <i class="fas fa-trash"></i> Delete
                                </button>
                            </div>
                        </div>
                        <div class="team-members">
                            ${(team.members || []).map(member => `
                                <span class="team-member">${escapeHtml(member.name || 'Unknown')}</span>
                            `).join('')}
                        </div>
                    </div>
                `).join('');
            } catch (error) {
                console.error('Error loading project teams:', error);
                container.innerHTML = '<p class="error-message">Error loading teams.</p>';
            }
        },
        
        async loadEvaluationStagesDropdown() {
            const select = document.getElementById('eval-stage-select');
            const consolidatedReportBtn = document.getElementById('generate-consolidated-report-btn');
            
            if (!select) return;
            
            try {
                const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
                const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
                
                // Clear existing options
                select.innerHTML = '<option value="">Select Evaluation Stage</option>';
                
                // Add stages
                stages.forEach((stage, index) => {
                    const option = document.createElement('option');
                    option.value = index.toString();
                    option.textContent = stage.name || `Stage ${index + 1}`;
                    select.appendChild(option);
                });
                
                // Show/hide consolidated report button based on stages
                if (consolidatedReportBtn) {
                    consolidatedReportBtn.style.display = stages.length > 0 ? 'block' : 'none';
                }
            } catch (error) {
                console.error('Error loading evaluation stages dropdown:', error);
            }
        },
        
        async loadUserStoriesStatus() {
            const container = document.getElementById('user-stories-status-container');
            if (!container) {
                console.warn('User stories status container not found');
                return;
            }
            
            try {
                // Load all project teams
                const teamsQuery = query(collection(window.firebaseDb, 'projectGroups'));
                const teamsSnapshot = await getDocs(teamsQuery);
                
                const teams = [];
                teamsSnapshot.forEach(doc => {
                    const data = doc.data();
                    if (!data.deleted) {
                        teams.push({
                            id: doc.id,
                            groupName: data.groupName || 'Unnamed Team',
                            userStories: data.userStories || []
                        });
                    }
                });
                
                if (teams.length === 0) {
                    container.innerHTML = '<p class="empty-state">No teams found.</p>';
                    return;
                }
                
                // Count teams with and without user stories
                const teamsWithStories = teams.filter(t => t.userStories && t.userStories.length > 0).length;
                const teamsWithoutStories = teams.length - teamsWithStories;
                
                container.innerHTML = `
                    <div class="user-stories-status-summary">
                        <div class="status-card">
                            <div class="status-value">${teams.length}</div>
                            <div class="status-label">Total Teams</div>
                        </div>
                        <div class="status-card success">
                            <div class="status-value">${teamsWithStories}</div>
                            <div class="status-label">With User Stories</div>
                        </div>
                        <div class="status-card warning">
                            <div class="status-value">${teamsWithoutStories}</div>
                            <div class="status-label">Without User Stories</div>
                        </div>
                    </div>
                    <div class="user-stories-teams-list">
                        ${teams.map(team => `
                            <div class="team-status-item">
                                <strong>${escapeHtml(team.groupName)}</strong>
                                <span class="status-badge ${team.userStories && team.userStories.length > 0 ? 'success' : 'warning'}">
                                    ${team.userStories && team.userStories.length > 0 
                                        ? `${team.userStories.length} user stories` 
                                        : 'No user stories'}
                                </span>
                            </div>
                        `).join('')}
                    </div>
                `;
            } catch (error) {
                console.error('Error loading user stories status:', error);
                container.innerHTML = '<p class="error-message">Error loading user stories status.</p>';
            }
        }
    };
}

