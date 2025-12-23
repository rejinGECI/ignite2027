// Admin MiniProject module
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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
        },
        
        async loadAdminFirstReviewVerification() {
            if (!app.isAdmin) return;
            
            const consolidatedView = document.getElementById('admin-first-review-consolidated-view');
            const container = document.getElementById('admin-first-review-teams-list');
            
            if (!consolidatedView) return;
            
            consolidatedView.innerHTML = '<div class="loading-state">Loading consolidated view...</div>';
            
            try {
                // Load all teams
                const teamsQuery = query(collection(window.firebaseDb, 'projectGroups'));
                const teamsSnapshot = await getDocs(teamsQuery);
                
                const teams = [];
                for (const teamDoc of teamsSnapshot.docs) {
                    const teamData = teamDoc.data();
                    if (teamData.deleted) continue;
                    
                    // Load first review schedule
                    const scheduleDoc = await getDoc(doc(window.firebaseDb, 'firstReviewSchedule', teamDoc.id));
                    const hasSchedule = scheduleDoc.exists();
                    const scheduleData = hasSchedule ? scheduleDoc.data() : null;
                    
                    // Calculate total backlogs
                    let totalBacklogs = 0;
                    if (scheduleData?.modules) {
                        scheduleData.modules.forEach(module => {
                            totalBacklogs += (module.productBacklogs?.length || 0);
                        });
                    }
                    totalBacklogs += (scheduleData?.standaloneBacklogs?.length || 0);
                    
                    teams.push({
                        id: teamDoc.id,
                        name: teamData.name || teamData.groupName || `Team ${teamDoc.id.substring(0, 8)}`,
                        guideId: teamData.guideId || '',
                        guideName: teamData.guideName || 'No Guide',
                        hasSchedule: hasSchedule,
                        submitted: scheduleData?.submitted || false,
                        verified: scheduleData?.verified || false,
                        frozen: scheduleData?.frozen || false,
                        submittedAt: scheduleData?.submittedAt || null,
                        verifiedAt: scheduleData?.verifiedAt || null,
                        frozenAt: scheduleData?.frozenAt || null,
                        modulesCount: scheduleData?.modules?.length || 0,
                        standaloneBacklogsCount: scheduleData?.standaloneBacklogs?.length || 0,
                        totalBacklogs: totalBacklogs
                    });
                }
                
                if (teams.length === 0) {
                    consolidatedView.innerHTML = '<p class="empty-state">No teams found.</p>';
                    return;
                }
                
                // Apply team order
                const teamsForOrdering = teams.map(t => ({
                    id: t.id,
                    groupName: t.name
                }));
                const sortedTeamsForOrdering = await app.applyTeamOrder(teamsForOrdering);
                
                // Map back to original team objects maintaining the order
                const teamMap = new Map(teams.map(t => [t.id, t]));
                const sortedTeams = sortedTeamsForOrdering.map(s => teamMap.get(s.id)).filter(Boolean);
                
                // Calculate statistics
                const stats = {
                    total: sortedTeams.length,
                    hasSchedule: sortedTeams.filter(t => t.hasSchedule).length,
                    submitted: sortedTeams.filter(t => t.submitted).length,
                    verified: sortedTeams.filter(t => t.verified).length,
                    frozen: sortedTeams.filter(t => t.frozen).length
                };
                
                // Render consolidated view
                consolidatedView.innerHTML = `
                    <div style="margin-bottom: 2rem; padding: 1.5rem; background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-radius: 8px; border-left: 4px solid #3b82f6;">
                        <h4 style="margin: 0 0 1rem 0; color: #1e40af; font-size: 1.1rem; font-weight: 600;">
                            <i class="fas fa-chart-bar"></i> Statistics
                                </h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;">
                            <div style="padding: 1rem; background: white; border-radius: 6px; text-align: center;">
                                <div style="font-size: 2rem; font-weight: 700; color: #3b82f6; margin-bottom: 0.25rem;">${stats.total}</div>
                                <div style="font-size: 0.85rem; color: var(--text-secondary);">Total Teams</div>
                            </div>
                            <div style="padding: 1rem; background: white; border-radius: 6px; text-align: center;">
                                <div style="font-size: 2rem; font-weight: 700; color: #10b981; margin-bottom: 0.25rem;">${stats.hasSchedule}</div>
                                <div style="font-size: 0.85rem; color: var(--text-secondary);">Has Schedule</div>
                            </div>
                            <div style="padding: 1rem; background: white; border-radius: 6px; text-align: center;">
                                <div style="font-size: 2rem; font-weight: 700; color: #3b82f6; margin-bottom: 0.25rem;">${stats.submitted}</div>
                                <div style="font-size: 0.85rem; color: var(--text-secondary);">Submitted</div>
                            </div>
                            <div style="padding: 1rem; background: white; border-radius: 6px; text-align: center;">
                                <div style="font-size: 2rem; font-weight: 700; color: #10b981; margin-bottom: 0.25rem;">${stats.verified}</div>
                                <div style="font-size: 0.85rem; color: var(--text-secondary);">Verified</div>
                                </div>
                            <div style="padding: 1rem; background: white; border-radius: 6px; text-align: center;">
                                <div style="font-size: 2rem; font-weight: 700; color: #f59e0b; margin-bottom: 0.25rem;">${stats.frozen}</div>
                                <div style="font-size: 0.85rem; color: var(--text-secondary);">Frozen</div>
                            </div>
                        </div>
                    </div>
                    
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden;">
                            <thead>
                                <tr style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white;">
                                    <th style="padding: 1rem; text-align: left; font-weight: 600;">Team Name</th>
                                    <th style="padding: 1rem; text-align: left; font-weight: 600;">Guide</th>
                                    <th style="padding: 1rem; text-align: center; font-weight: 600;">Schedule</th>
                                    <th style="padding: 1rem; text-align: center; font-weight: 600;">Status</th>
                                    <th style="padding: 1rem; text-align: center; font-weight: 600;">Freeze</th>
                                    <th style="padding: 1rem; text-align: center; font-weight: 600;">Modules</th>
                                    <th style="padding: 1rem; text-align: center; font-weight: 600;">Backlogs</th>
                                    <th style="padding: 1rem; text-align: center; font-weight: 600;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sortedTeams.map((team, index) => {
                                    const statusColor = team.verified ? '#10b981' : (team.submitted ? '#3b82f6' : '#6b7280');
                                    const statusText = team.verified ? 'Verified' : (team.submitted ? 'Submitted' : 'Not Submitted');
                                    const freezeColor = team.frozen ? '#f59e0b' : '#6b7280';
                                    const freezeText = team.frozen ? 'Frozen' : 'Active';
                                    
                                    return `
                                        <tr style="border-bottom: 1px solid #e5e7eb; ${index % 2 === 0 ? 'background: #f9fafb;' : 'background: white;'}">
                                            <td style="padding: 1rem; font-weight: 600; color: var(--text-primary);">
                                                ${escapeHtml(team.name)}
                                            </td>
                                            <td style="padding: 1rem; color: var(--text-secondary);">
                                                ${escapeHtml(team.guideName)}
                                            </td>
                                            <td style="padding: 1rem; text-align: center;">
                                                <span style="padding: 0.4rem 0.8rem; background: ${team.hasSchedule ? '#10b981' : '#6b7280'}; color: white; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">
                                                    ${team.hasSchedule ? '<i class="fas fa-check"></i> Yes' : '<i class="fas fa-times"></i> No'}
                                                </span>
                                            </td>
                                            <td style="padding: 1rem; text-align: center;">
                                                <span style="padding: 0.4rem 0.8rem; background: ${statusColor}; color: white; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">
                                                    ${statusText}
                                                </span>
                                            </td>
                                            <td style="padding: 1rem; text-align: center;">
                                                <span style="padding: 0.4rem 0.8rem; background: ${freezeColor}; color: white; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">
                                                    <i class="fas ${team.frozen ? 'fa-lock' : 'fa-unlock'}"></i> ${freezeText}
                                                </span>
                                            </td>
                                            <td style="padding: 1rem; text-align: center; color: var(--text-primary);">
                                                ${team.modulesCount}
                                            </td>
                                            <td style="padding: 1rem; text-align: center; color: var(--text-primary);">
                                                ${team.totalBacklogs}
                                            </td>
                                            <td style="padding: 1rem; text-align: center;">
                                                <button type="button" class="btn btn-primary btn-sm" onclick="app.loadAdminFirstReviewSchedule('${team.id}')" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">
                                                    <i class="fas fa-eye"></i> View
                                                </button>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
                
                // Setup search
                const searchInput = document.getElementById('search-first-review-teams');
                if (searchInput) {
                    searchInput.oninput = (e) => {
                        const searchTerm = e.target.value.toLowerCase();
                        const rows = consolidatedView.querySelectorAll('tbody tr');
                        rows.forEach(row => {
                            const teamName = row.textContent.toLowerCase();
                            row.style.display = teamName.includes(searchTerm) ? '' : 'none';
                        });
                    };
                }
            } catch (error) {
                console.error('Error loading first sprint consolidated view:', error);
                consolidatedView.innerHTML = '<p class="error-message">Error loading consolidated view. Please try again.</p>';
            }
        },
        
        async loadAdminFirstReviewSchedule(teamId) {
            if (!app.isAdmin) return;
            
            // Create modal for viewing/editing schedule
            const existingModal = document.getElementById('admin-first-review-modal');
            if (existingModal) existingModal.remove();
            
            const modal = document.createElement('div');
            modal.id = 'admin-first-review-modal';
            modal.className = 'modal';
            modal.style.display = 'flex';
            
            try {
                // Load team data
                const teamDoc = await getDoc(doc(window.firebaseDb, 'projectGroups', teamId));
                if (!teamDoc.exists()) {
                    alert('Team not found.');
                    return;
                }
                const teamData = teamDoc.data();
                const teamName = teamData.name || teamData.groupName || `Team ${teamId.substring(0, 8)}`;
                
                // Load schedule
                const scheduleDoc = await getDoc(doc(window.firebaseDb, 'firstReviewSchedule', teamId));
                const scheduleData = scheduleDoc.exists() ? scheduleDoc.data() : {
                    modules: [],
                    standaloneBacklogs: [],
                    submitted: false
                };
                
                // Load modules
                const modulesQuery = query(
                    collection(window.firebaseDb, 'cardSortingModules'),
                    where('teamId', '==', teamId)
                );
                const modulesSnapshot = await getDocs(modulesQuery);
                const allModules = [];
                modulesSnapshot.forEach(doc => {
                    allModules.push({ id: doc.id, ...doc.data() });
                });
                
                // Load all backlogs
                const backlogQuery = query(
                    collection(window.firebaseDb, 'productBacklog'),
                    where('teamId', '==', teamId)
                );
                const backlogSnapshot = await getDocs(backlogQuery);
                const allBacklogs = [];
                backlogSnapshot.forEach(doc => {
                    allBacklogs.push({ id: doc.id, ...doc.data(), source: 'projectPlanning' });
                });
                
                const firstReviewBacklogQuery = query(
                    collection(window.firebaseDb, 'firstReviewBacklogs'),
                    where('teamId', '==', teamId)
                );
                const firstReviewBacklogSnapshot = await getDocs(firstReviewBacklogQuery);
                firstReviewBacklogSnapshot.forEach(doc => {
                    allBacklogs.push({ id: doc.id, ...doc.data(), source: 'firstReview' });
                });
                
                // Load assignments
                const assignmentsQuery = query(
                    collection(window.firebaseDb, 'cardSortingAssignments'),
                    where('teamId', '==', teamId)
                );
                const assignmentsSnapshot = await getDocs(assignmentsQuery);
                const backlogToModule = {};
                assignmentsSnapshot.forEach(doc => {
                    const data = doc.data();
                    backlogToModule[data.backlogId] = data.moduleId;
                });
                
                // Render modal content
                modal.innerHTML = `
                    <div class="modal-content" style="max-width: 95vw; max-height: 95vh; overflow-y: auto; padding: 1rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border-color);">
                            <h2 style="margin: 0; font-size: 1.1rem; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 0.5rem;">
                                <i class="fas fa-check-circle" style="color: #3b82f6; font-size: 1rem;"></i> First Sprint Schedule - ${escapeHtml(teamName)}
                            </h2>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('admin-first-review-modal').remove()" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">
                                <i class="fas fa-times" style="font-size: 0.85rem;"></i> Close
                            </button>
                        </div>
                        
                        <div style="margin-bottom: 1rem;">
                            <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; margin-bottom: 0.75rem;">
                                <span style="padding: 0.35rem 0.75rem; background: ${scheduleData.submitted ? (scheduleData.verified ? '#3b82f6' : '#10b981') : '#f59e0b'}; color: white; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">
                                    Status: ${scheduleData.verified ? 'Verified' : (scheduleData.submitted ? 'Submitted' : 'Draft')}
                                </span>
                                ${scheduleData.submittedAt ? `
                                    <span style="padding: 0.35rem 0.75rem; background: #f3f4f6; color: var(--text-primary); border-radius: 4px; font-size: 0.75rem;">
                                        Submitted: ${scheduleData.submittedAt.toDate ? scheduleData.submittedAt.toDate().toLocaleString() : 'Unknown'}
                                    </span>
                                ` : ''}
                                ${scheduleData.verifiedAt ? `
                                    <span style="padding: 0.35rem 0.75rem; background: #dbeafe; color: #1e40af; border-radius: 4px; font-size: 0.75rem;">
                                        Verified: ${scheduleData.verifiedAt.toDate ? scheduleData.verifiedAt.toDate().toLocaleString() : 'Unknown'}
                                        ${scheduleData.verifiedBy ? ` by ${escapeHtml(scheduleData.verifiedBy)}` : ''}
                                    </span>
                                ` : ''}
                            </div>
                            ${scheduleData.submitted && !scheduleData.verified ? `
                            <div style="padding: 0.75rem; background: #fef3c7; border-radius: 6px; border-left: 3px solid #f59e0b; margin-bottom: 0.75rem;">
                                <div style="font-size: 0.8rem; font-weight: 600; color: #92400e; margin-bottom: 0.5rem;">
                                    <i class="fas fa-info-circle"></i> Verification Required
                                </div>
                                <form onsubmit="app.verifyFirstReviewSchedule(event, '${teamId}')" style="display: flex; flex-direction: column; gap: 0.5rem;">
                                    <div>
                                        <label style="font-size: 0.7rem; color: var(--text-secondary); font-weight: 500; display: block; margin-bottom: 0.3rem;">Admin Comments:</label>
                                        <textarea id="admin-verification-comments" class="form-input" rows="3" placeholder="Add comments for the team..." style="width: 100%; padding: 0.5rem; font-size: 0.8rem; border: 1px solid var(--border-color); border-radius: 4px; resize: vertical;">${scheduleData.adminComments || ''}</textarea>
                                    </div>
                                    <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                                        <button type="submit" class="btn btn-primary btn-sm" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;">
                                            <i class="fas fa-check-circle" style="font-size: 0.7rem;"></i> Verify & Unlock
                                        </button>
                                    </div>
                                </form>
                            </div>
                            ` : scheduleData.verified ? `
                            <div style="padding: 0.75rem; background: #dbeafe; border-radius: 6px; border-left: 3px solid #3b82f6; margin-bottom: 0.75rem;">
                                ${scheduleData.adminComments ? `
                                    <div style="font-size: 0.75rem; font-weight: 600; color: #1e40af; margin-bottom: 0.4rem;">
                                        <i class="fas fa-comment-alt"></i> Admin Comments:
                                    </div>
                                    <div style="font-size: 0.8rem; color: var(--text-primary); line-height: 1.5; margin-bottom: 0.75rem;">
                                        ${escapeHtml(scheduleData.adminComments)}
                                    </div>
                                ` : ''}
                                <div style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem; align-items: center; flex-wrap: wrap;">
                                    ${scheduleData.frozen ? `
                                        <span style="padding: 0.3rem 0.6rem; background: #fee2e2; color: #991b1b; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">
                                            <i class="fas fa-lock"></i> Frozen - Students cannot edit
                                        </span>
                                        <button type="button" class="btn btn-primary btn-sm" onclick="app.generateFirstSprintScheduleContract('${teamId}')" style="padding: 0.4rem 0.8rem; font-size: 0.75rem; background: #6366f1; color: white; border: none;">
                                            <i class="fas fa-file-contract" style="font-size: 0.7rem;"></i> Generate Contract
                                        </button>
                                        <button type="button" class="btn btn-success btn-sm" onclick="app.unfreezeFirstReviewSchedule('${teamId}')" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;">
                                            <i class="fas fa-unlock" style="font-size: 0.7rem;"></i> Unfreeze
                                        </button>
                                    ` : `
                                        <button type="button" class="btn btn-warning btn-sm" onclick="app.freezeFirstReviewSchedule('${teamId}')" style="padding: 0.4rem 0.8rem; font-size: 0.75rem; background: #f59e0b; color: white; border: none;">
                                            <i class="fas fa-lock" style="font-size: 0.7rem;"></i> Freeze Backlogs
                                        </button>
                                    `}
                                </div>
                                <form onsubmit="app.revertFirstReviewSchedule(event, '${teamId}')" style="display: flex; flex-direction: column; gap: 0.5rem;">
                                    <div>
                                        <label style="font-size: 0.7rem; color: var(--text-secondary); font-weight: 500; display: block; margin-bottom: 0.3rem;">Update Comments (optional):</label>
                                        <textarea id="admin-revert-comments" class="form-input" rows="3" placeholder="Add comments for reverting back to student..." style="width: 100%; padding: 0.5rem; font-size: 0.8rem; border: 1px solid var(--border-color); border-radius: 4px; resize: vertical;">${scheduleData.adminComments || ''}</textarea>
                                    </div>
                                    <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                                        <button type="submit" class="btn btn-warning btn-sm" style="padding: 0.4rem 0.8rem; font-size: 0.75rem; background: #f59e0b; color: white; border: none;">
                                            <i class="fas fa-undo" style="font-size: 0.7rem;"></i> Revert to Student
                                        </button>
                                    </div>
                                </form>
                            </div>
                            ` : ''}
                        </div>
                        
                        <div id="admin-first-review-schedule-content">
                            <!-- Schedule content will be loaded here -->
                        </div>
                    </div>
                `;
                
                document.body.appendChild(modal);
                
                // Load schedule content
                await app.renderAdminFirstReviewScheduleContent(teamId, scheduleData, allModules, allBacklogs, backlogToModule);
                
            } catch (error) {
                console.error('Error loading first review schedule:', error);
                alert('Error loading schedule. Please try again.');
                modal.remove();
            }
        },
        
        async renderAdminFirstReviewScheduleContent(teamId, scheduleData, allModules, allBacklogs, backlogToModule) {
            const container = document.getElementById('admin-first-review-schedule-content');
            if (!container) return;
            
            try {
                let html = '';
                
                // Render modules
                if (scheduleData.modules && scheduleData.modules.length > 0) {
                    html += '<h3 style="margin: 1rem 0 0.75rem 0; color: var(--text-primary); font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;"><i class="fas fa-folder" style="font-size: 0.9rem; color: #3b82f6;"></i> Modules</h3>';
                    
                    // Sort modules by order
                    const sortedModules = [...scheduleData.modules].sort((a, b) => {
                        const orderA = a.order !== undefined ? a.order : 999999;
                        const orderB = b.order !== undefined ? b.order : 999999;
                        return orderA - orderB;
                    });
                    
                    sortedModules.forEach((scheduleModule, moduleIndex) => {
                        const module = allModules.find(m => m.id === scheduleModule.moduleId);
                        if (!module) return;
                        
                        // Get backlogs that are explicitly in the schedule's productBacklogs array
                        // Only show backlogs from firstReviewBacklogs (all backlogs in schedule are from firstReviewBacklogs)
                        const scheduledBacklogIds = new Set((scheduleModule.productBacklogs || []).map(pb => String(pb.backlogId)));
                        
                        // Only get backlogs from firstReviewBacklogs that are in the schedule
                        const moduleBacklogs = allBacklogs.filter(b => 
                            b.source === 'firstReview' && 
                            scheduledBacklogIds.has(String(b.id))
                        );
                        
                        // Sort backlogs by order - using same logic as student view
                        const sortedBacklogs = [...moduleBacklogs].map(backlog => {
                            // Ensure string comparison for backlogId matching (same as student view)
                            const backlogSchedule = scheduleModule.productBacklogs?.find(pb => String(pb.backlogId) === String(backlog.id));
                            return {
                                ...backlog,
                                order: backlogSchedule?.order !== undefined ? backlogSchedule.order : 999999
                            };
                        }).sort((a, b) => {
                            const orderA = a.order !== undefined ? a.order : 999999;
                            const orderB = b.order !== undefined ? b.order : 999999;
                            return orderA - orderB;
                        });
                        
                        html += `
                            <div class="admin-module-card" 
                                 data-module-id="${scheduleModule.moduleId}" 
                                 data-module-order="${scheduleModule.order !== undefined ? scheduleModule.order : moduleIndex}"
                                 draggable="true"
                                 style="margin-bottom: 1rem; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 6px; background: #fafbfc; cursor: move;"
                                 ondragstart="app.handleAdminModuleDragStart(event, '${scheduleModule.moduleId}', '${teamId}')"
                                 ondragover="app.handleAdminModuleDragOver(event)"
                                 ondrop="app.handleAdminModuleDrop(event, '${scheduleModule.moduleId}', '${teamId}')"
                                 ondragend="app.handleAdminModuleDragEnd(event)">
                                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
                                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                                        <i class="fas fa-grip-vertical" style="color: #9ca3af; cursor: move; font-size: 0.9rem;" title="Drag to reorder module"></i>
                                        <h4 style="margin: 0; color: #1e40af; font-size: 0.9rem; font-weight: 600; display: flex; align-items: center; gap: 0.4rem;">
                                            <i class="fas fa-folder" style="color: #3b82f6; font-size: 0.85rem;"></i> ${escapeHtml(module.name || 'Unnamed Module')}
                                        </h4>
                                    </div>
                                    <button type="button" class="btn btn-primary btn-sm" onclick="app.showAdminAddBacklogModal('${teamId}', '${scheduleModule.moduleId}')" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;">
                                        <i class="fas fa-plus" style="font-size: 0.7rem;"></i> Add
                                    </button>
                                </div>
                                
                                <div style="display: flex; gap: 0.75rem; margin-bottom: 0.75rem; align-items: end;">
                                    <div style="flex: 1;">
                                        <label style="font-size: 0.7rem; color: var(--text-secondary); font-weight: 500; display: block; margin-bottom: 0.25rem;">Start Date</label>
                                        <input type="date" class="form-input" value="${scheduleModule.startDate || ''}" 
                                               onchange="app.updateAdminModuleDate('${teamId}', '${scheduleModule.moduleId}', 'startDate', this.value)"
                                               style="width: 100%; padding: 0.4rem; font-size: 0.8rem; border: 1px solid var(--border-color); border-radius: 4px;">
                                    </div>
                                    <div style="flex: 1;">
                                        <label style="font-size: 0.7rem; color: var(--text-secondary); font-weight: 500; display: block; margin-bottom: 0.25rem;">End Date</label>
                                        <input type="date" class="form-input" value="${scheduleModule.endDate || ''}" 
                                               onchange="app.updateAdminModuleDate('${teamId}', '${scheduleModule.moduleId}', 'endDate', this.value)"
                                               style="width: 100%; padding: 0.4rem; font-size: 0.8rem; border: 1px solid var(--border-color); border-radius: 4px;">
                                    </div>
                                </div>
                                
                                <div id="admin-module-backlogs-${scheduleModule.moduleId}" 
                                     class="admin-backlogs-container"
                                     data-module-id="${scheduleModule.moduleId}"
                                     style="display: flex; flex-direction: column; gap: 0.5rem;">
                                    ${sortedBacklogs.map(backlog => {
                                        const backlogSchedule = scheduleModule.productBacklogs?.find(pb => pb.backlogId === backlog.id);
                                        return app.renderAdminBacklogItem(backlog, backlogSchedule, scheduleModule.moduleId, teamId);
                                    }).join('')}
                                </div>
                            </div>
                        `;
                    });
                }
                
                // Render standalone backlogs - ONLY from firstReviewBacklogs
                if (scheduleData.standaloneBacklogs && scheduleData.standaloneBacklogs.length > 0) {
                    html += '<h3 style="margin: 1rem 0 0.75rem 0; color: var(--text-primary); font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;"><i class="fas fa-tasks" style="font-size: 0.9rem; color: #3b82f6;"></i> Standalone Product Backlogs</h3>';
                    html += '<div class="admin-card" style="padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 6px; background: #fafbfc;">';
                    html += '<button type="button" class="btn btn-primary btn-sm" onclick="app.showAdminAddBacklogModal(\'' + teamId + '\', null)" style="margin-bottom: 0.75rem; padding: 0.3rem 0.6rem; font-size: 0.75rem;">';
                    html += '<i class="fas fa-plus" style="font-size: 0.7rem;"></i> Add Backlog';
                    html += '</button>';
                    
                    // Only show backlogs from firstReviewBacklogs
                    const standaloneBacklogIds = new Set(scheduleData.standaloneBacklogs.map(b => String(b.backlogId)));
                    const standaloneBacklogs = allBacklogs.filter(b => 
                        b.source === 'firstReview' && 
                        standaloneBacklogIds.has(String(b.id))
                    );
                    
                    // Sort standalone backlogs by order (same as student view)
                    const sortedStandaloneBacklogs = standaloneBacklogs.map(backlog => {
                        // Ensure string comparison for backlogId matching (same as student view)
                        const backlogSchedule = scheduleData.standaloneBacklogs.find(pb => String(pb.backlogId) === String(backlog.id));
                        return {
                            backlog,
                            backlogSchedule,
                            order: backlogSchedule?.order !== undefined ? backlogSchedule.order : 999999
                        };
                    }).sort((a, b) => {
                        const orderA = a.order !== undefined ? a.order : 999999;
                        const orderB = b.order !== undefined ? b.order : 999999;
                        return orderA - orderB;
                    });
                    
                    sortedStandaloneBacklogs.forEach(({ backlog, backlogSchedule }) => {
                        if (backlogSchedule) {
                            html += app.renderAdminBacklogItem(backlog, backlogSchedule, null, teamId);
                        }
                    });
                    
                    html += '</div>';
                } else {
                    html += '<div class="admin-card" style="padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 6px; background: #fafbfc;">';
                    html += '<p class="empty-state" style="font-size: 0.85rem; margin: 0;">No standalone backlogs. <button type="button" class="btn btn-primary btn-sm" onclick="app.showAdminAddBacklogModal(\'' + teamId + '\', null)" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; margin-left: 0.5rem;">Add One</button></p>';
                    html += '</div>';
                }
                
                container.innerHTML = html;
            } catch (error) {
                console.error('Error rendering schedule content:', error);
                container.innerHTML = '<p class="error-message">Error rendering schedule. Please try again.</p>';
            }
        },
        
        renderAdminBacklogItem(backlog, backlogSchedule, moduleId, teamId) {
            const startDate = backlogSchedule?.startDate || '';
            const endDate = backlogSchedule?.endDate || '';
            const priority = backlog.priority || 'medium';
            const difficulty = backlog.difficulty || 'medium';
            
            // Priority colors
            const priorityColors = {
                low: '#6b7280',
                medium: '#3b82f6',
                high: '#f59e0b',
                critical: '#ef4444'
            };
            const priorityColor = priorityColors[priority] || '#3b82f6';
            
            // Difficulty colors
            const difficultyColors = {
                easy: '#10b981',
                medium: '#3b82f6',
                hard: '#f59e0b',
                'very-hard': '#ef4444'
            };
            const difficultyColor = difficultyColors[difficulty] || '#3b82f6';
            
            return `
                <div class="admin-backlog-item" 
                     data-backlog-id="${backlog.id}" 
                     data-module-id="${moduleId || 'standalone'}"
                     data-backlog-order="${backlogSchedule?.order !== undefined ? backlogSchedule.order : 999999}"
                     draggable="true"
                     style="padding: 0.75rem; background: #ffffff; border-radius: 4px; border-left: 3px solid ${priorityColor}; margin-bottom: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05); cursor: move;"
                     ondragstart="app.handleAdminBacklogDragStart(event, '${backlog.id}', '${moduleId || 'standalone'}', '${teamId}')"
                     ondragover="app.handleAdminBacklogDragOver(event)"
                     ondrop="app.handleAdminBacklogDrop(event, '${backlog.id}', '${moduleId || 'standalone'}', '${teamId}')"
                     ondragend="app.handleAdminBacklogDragEnd(event)">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem; gap: 0.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-right: 0.5rem;">
                            <i class="fas fa-grip-vertical" style="color: #9ca3af; cursor: move; font-size: 0.8rem;" title="Drag to reorder"></i>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.4rem; font-size: 0.85rem; line-height: 1.3;">
                                ${escapeHtml(backlog.task || backlog.description || 'Untitled Task')}
                            </div>
                            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
                                <span style="padding: 0.2rem 0.4rem; background: ${priorityColor}; color: white; border-radius: 8px; font-size: 0.65rem; font-weight: 500;">
                                    <i class="fas fa-flag" style="font-size: 0.6rem;"></i> ${priority}
                                </span>
                                <span style="padding: 0.2rem 0.4rem; background: ${difficultyColor}; color: white; border-radius: 8px; font-size: 0.65rem; font-weight: 500;">
                                    <i class="fas fa-signal" style="font-size: 0.6rem;"></i> ${difficulty}
                                </span>
                            </div>
                        </div>
                        <div style="display: flex; gap: 0.3rem; flex-shrink: 0;">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="app.editAdminBacklog('${backlog.id}', '${moduleId || ''}', '${teamId}')" style="padding: 0.3rem 0.5rem; font-size: 0.7rem; min-width: auto;">
                                <i class="fas fa-edit" style="font-size: 0.7rem;"></i>
                            </button>
                            <button type="button" class="btn btn-danger btn-sm" onclick="app.deleteAdminBacklog('${backlog.id}', '${moduleId || ''}', '${teamId}')" style="padding: 0.3rem 0.5rem; font-size: 0.7rem; min-width: auto;">
                                <i class="fas fa-trash" style="font-size: 0.7rem;"></i>
                            </button>
                        </div>
                    </div>
                    <div style="display: flex; gap: 0.75rem; align-items: end;">
                        <div style="flex: 1;">
                            <label style="font-size: 0.65rem; color: var(--text-secondary); font-weight: 500; display: block; margin-bottom: 0.2rem;">Start Date</label>
                            <input type="date" class="form-input" value="${startDate}" 
                                   onchange="app.updateAdminBacklogDate('${backlog.id}', '${moduleId || ''}', '${teamId}', 'startDate', this.value)"
                                   style="width: 100%; padding: 0.35rem; font-size: 0.75rem; border: 1px solid var(--border-color); border-radius: 4px;">
                        </div>
                        <div style="flex: 1;">
                            <label style="font-size: 0.65rem; color: var(--text-secondary); font-weight: 500; display: block; margin-bottom: 0.2rem;">End Date</label>
                            <input type="date" class="form-input" value="${endDate}" 
                                   onchange="app.updateAdminBacklogDate('${backlog.id}', '${moduleId || ''}', '${teamId}', 'endDate', this.value)"
                                   style="width: 100%; padding: 0.35rem; font-size: 0.75rem; border: 1px solid var(--border-color); border-radius: 4px;">
                        </div>
                    </div>
                </div>
            `;
        }
    };
}

