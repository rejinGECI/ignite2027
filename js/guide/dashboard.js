// Guide Dashboard module
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc, collection, query, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function createGuideDashboardModule(app) {
    return {
        async loadGuideDashboard() {
            if (app.userRole !== 'guide') return;
            
            // Load teams assigned to this guide
            await app.loadGuideTeams();
        },
        
        async loadGuideTeams() {
            const container = document.getElementById('guide-teams-list');
            if (!container) return;
            
            try {
                // Load evaluation stages
                const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
                const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
                
                // Get guide's email to match teams
                const guideEmail = app.currentUser.email;
                
                // Query teams by guideId (Firestore document ID) or guideName (email)
                const teamsQuery = query(
                    collection(window.firebaseDb, 'projectGroups') // Keep collection name for backward compatibility
                );
                const teamsSnapshot = await getDocs(teamsQuery);
                
                const teams = [];
                teamsSnapshot.forEach(doc => {
                    const data = doc.data();
                    if (!data.deleted) {
                        // Match by guideId (Firestore document ID) or guideName (email)
                        const matchesGuide = data.guideId === app.currentUser.uid || 
                                           data.guideName === guideEmail ||
                                           (data.guideId && data.guideId === app.currentUser.uid);
                        
                        if (matchesGuide) {
                            teams.push({
                                id: doc.id,
                                ...data
                            });
                        }
                    }
                });
                
                if (teams.length === 0) {
                    container.innerHTML = '<p class="empty-state">No teams assigned to you yet.</p>';
                    return;
                }
                
                // Render teams list (simplified version)
                container.innerHTML = teams.map(team => `
                    <div class="guide-team-card">
                        <h3>${escapeHtml(team.groupName || 'Unnamed Team')}</h3>
                        <p>Team members: ${(team.members || []).map(m => escapeHtml(m.name || 'Unknown')).join(', ')}</p>
                    </div>
                `).join('');
            } catch (error) {
                console.error('Error loading guide teams:', error);
                container.innerHTML = '<p class="error-message">Error loading teams.</p>';
            }
        },
        
        async checkIfGuideIsEvaluator() {
            if (!app.currentUser || !app.currentUser.uid || app.userRole !== 'guide') {
                return false;
            }
            
            try {
                const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
                const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
                
                for (let i = 0; i < stages.length; i++) {
                    const isEvaluator = await app.isEvaluatorForStage(app.currentUser.uid, i);
                    if (isEvaluator) {
                        return true;
                    }
                }
                return false;
            } catch (error) {
                console.error('Error checking if guide is evaluator:', error);
                return false;
            }
        }
    };
}

