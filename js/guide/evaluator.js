// Guide Evaluator module
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc, collection, query, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function createGuideEvaluatorModule(app) {
    return {
        async loadGuideEvaluatorPage() {
            if (!app.isGuide) return;
            
            // Load evaluation stages dropdown
            await app.loadGuideEvaluatorStagesDropdown();
        },
        
        async loadGuideEvaluatorStagesDropdown() {
            const stageSelect = document.getElementById('guide-evaluator-stage-select');
            if (!stageSelect) return;
            
            try {
                const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
                const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
                
                stageSelect.innerHTML = '<option value="">-- Select a stage --</option>';
                
                // Only show stages where this guide is assigned as evaluator
                for (let i = 0; i < stages.length; i++) {
                    const isEvaluator = await app.isEvaluatorForStage(app.currentUser.uid, i);
                    if (isEvaluator) {
                        const option = document.createElement('option');
                        option.value = i;
                        option.textContent = `${i + 1}. ${stages[i].name || `Stage ${i + 1}`}`;
                        stageSelect.appendChild(option);
                    }
                }
            } catch (error) {
                console.error('Error loading guide evaluator stages dropdown:', error);
            }
        },
        
        async loadTeamsForGuideEvaluator() {
            const stageSelect = document.getElementById('guide-evaluator-stage-select');
            const teamsContainer = document.getElementById('guide-evaluator-teams-list-container');
            const teamsList = document.getElementById('guide-evaluator-teams-list');
            const formContainer = document.getElementById('guide-evaluator-form-container');
            
            if (!stageSelect || !teamsContainer || !teamsList) return;
            
            const stageIndex = stageSelect.value;
            
            // Hide form and teams list when stage changes
            if (formContainer) formContainer.style.display = 'none';
            teamsContainer.style.display = 'none';
            
            if (stageIndex === '') {
                return;
            }
            
            // Verify that guide is evaluator for this stage
            const isEvaluator = await app.isEvaluatorForStage(app.currentUser.uid, stageIndex);
            if (!isEvaluator) {
                alert('You are not assigned as an evaluator for this stage.');
                return;
            }
            
            try {
                // Load all teams
                const teamsQuery = query(collection(window.firebaseDb, 'projectGroups'));
                const teamsSnapshot = await getDocs(teamsQuery);
                
                const teams = [];
                teamsSnapshot.forEach(doc => {
                    const data = doc.data();
                    if (!data.deleted) {
                        teams.push({
                            id: doc.id,
                            groupName: data.groupName || 'Unnamed Team',
                            ...data
                        });
                    }
                });
                
                // Apply team order settings
                const sortedTeams = await app.applyTeamOrder(teams);
                
                if (sortedTeams.length === 0) {
                    teamsList.innerHTML = '<p class="empty-state">No teams available.</p>';
                    teamsContainer.style.display = 'block';
                    return;
                }
                
                // Check evaluation status for each team
                const teamsWithStatus = await Promise.all(sortedTeams.map(async (team) => {
                    try {
                        // Check if this evaluator has already submitted
                        let evaluatorSubmitted = false;
                        const evaluatorEntryDoc = await getDoc(
                            doc(window.firebaseDb, 'evaluations', `${team.id}_${stageIndex}`, 'evaluatorEntries', app.currentUser.uid)
                        );
                        if (evaluatorEntryDoc.exists()) {
                            evaluatorSubmitted = true;
                        }
                        
                        // Check main evaluation document (admin evaluation)
                        const mainEvalDoc = await getDoc(doc(window.firebaseDb, 'evaluations', `${team.id}_${stageIndex}`));
                        const mainEvalData = mainEvalDoc.exists() ? mainEvalDoc.data() : null;
                        
                        return {
                            ...team,
                            evaluatorSubmitted,
                            adminEvaluated: mainEvalData !== null
                        };
                    } catch (error) {
                        console.error(`Error loading status for team ${team.id}:`, error);
                        return {
                            ...team,
                            evaluatorSubmitted: false,
                            adminEvaluated: false
                        };
                    }
                }));
                
                // Render teams list with proper styling
                teamsList.innerHTML = teamsWithStatus.map(team => {
                    const statusClass = team.evaluatorSubmitted ? 'completed' : 'pending';
                    const statusText = team.evaluatorSubmitted ? '✓ Evaluated' : 'Pending';
                    const statusIcon = team.evaluatorSubmitted ? 'fa-check-circle' : 'fa-clock';
                    
                    return `
                        <div class="eval-team-card eval-team-${statusClass}" onclick="app.loadGuideEvaluatorEvaluationForm('${team.id}', '${stageIndex}')">
                            <div class="eval-team-name">${escapeHtml(team.groupName || 'Unnamed Team')}</div>
                            <div class="eval-team-info">
                                ${team.members && team.members.length > 0 ? `
                                    <span><i class="fas fa-users"></i> ${team.members.length} member${team.members.length !== 1 ? 's' : ''}</span>
                                ` : ''}
                                ${team.guideName ? `
                                    <span><i class="fas fa-user-tie"></i> ${escapeHtml(team.guideName)}</span>
                                ` : ''}
                                <span class="eval-status-badge">
                                    <i class="fas ${statusIcon}"></i> ${statusText}
                                </span>
                            </div>
                        </div>
                    `;
                }).join('');
                
                teamsContainer.style.display = 'block';
            } catch (error) {
                console.error('Error loading teams for guide evaluator:', error);
                teamsList.innerHTML = '<p class="error-message">Error loading teams.</p>';
                teamsContainer.style.display = 'block';
            }
        }
    };
}

