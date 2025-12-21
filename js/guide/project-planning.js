// Guide Project Planning module
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function createGuideProjectPlanningModule(app) {
    return {
        async loadGuideProjectPlanning() {
            const container = document.getElementById('guide-project-planning-teams-list');
            if (!container) return;
            
            try {
                const guideEmail = app.currentUser.email;
                
                // Get teams assigned to this guide
                const teamsQuery = query(collection(window.firebaseDb, 'projectGroups'));
                const teamsSnapshot = await getDocs(teamsQuery);
                
                const teams = [];
                for (const teamDoc of teamsSnapshot.docs) {
                    const team = { id: teamDoc.id, ...teamDoc.data() };
                    if (team.deleted) continue;
                    
                    // Match by guideId (most reliable)
                    let matchesGuide = team.guideId === app.currentUser.uid;
                    
                    // If no guideId match, try matching by guide name or email
                    if (!matchesGuide) {
                        const userDoc = await getDoc(doc(window.firebaseDb, 'users', app.currentUser.uid));
                        if (userDoc.exists()) {
                            const userData = userDoc.data();
                            const userName = userData.name || '';
                            const userEmail = userData.email || guideEmail;
                            
                            // Match by guide name or email
                            matchesGuide = team.guideName === userName || 
                                          team.guideName === userEmail ||
                                          team.guideName === guideEmail ||
                                          (team.guideEmail && (team.guideEmail === userEmail || team.guideEmail === guideEmail));
                        } else {
                            // Fallback: match by email if user doc doesn't exist
                            matchesGuide = team.guideName === guideEmail || 
                                         (team.guideEmail && team.guideEmail === guideEmail);
                        }
                    }
                    
                    if (!matchesGuide) continue;
                    
                    // Load project planning status
                    const planningDoc = await getDoc(doc(window.firebaseDb, 'projectPlanning', team.id));
                    const planningData = planningDoc.exists() ? planningDoc.data() : null;
                    
                    team.planningData = planningData;
                    teams.push(team);
                }
                
                if (teams.length === 0) {
                    container.innerHTML = '<p class="empty-state">No teams assigned to you yet.</p>';
                    return;
                }
                
                // Render teams with planning status (simplified)
                container.innerHTML = teams.map(team => {
                    const isSubmitted = team.planningData && team.planningData.userStoriesSubmitted === true;
                    const isVerified = team.planningData && team.planningData.userStoriesVerified === true;
                    
                    return `
                        <div class="guide-team-card">
                            <h3>${escapeHtml(team.groupName || 'Unnamed Team')}</h3>
                            <div class="planning-status">
                                <span class="status-badge ${isSubmitted ? 'submitted' : 'pending'}">
                                    ${isSubmitted ? (isVerified ? '✓ Verified' : 'Submitted') : 'Pending'}
                                </span>
                            </div>
                        </div>
                    `;
                }).join('');
            } catch (error) {
                console.error('Error loading guide project planning:', error);
                container.innerHTML = '<p class="error-message">Error loading project planning data.</p>';
            }
        },
        
        async loadProjectPlanning() {
            // This function is kept for backward compatibility but project planning is now in mini project
            // Redirect to mini project if accessed directly
            if (document.getElementById('project-planning')) {
                // Student project planning page - load it
                await app.loadStudentMiniProject();
            } else {
                // Guide project planning
                await app.loadGuideProjectPlanning();
            }
        }
    };
}

