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
                    
                    // Load student progress (completed tasks)
                    let completedBacklogIds = [];
                    let progressPercentage = 0;
                    try {
                        const studentProgressDoc = await getDoc(doc(window.firebaseDb, 'firstReviewStudentProgress', teamDoc.id));
                        if (studentProgressDoc.exists()) {
                            const progressData = studentProgressDoc.data();
                            completedBacklogIds = progressData.completedBacklogIds || [];
                        }
                        // Calculate progress percentage
                        if (totalBacklogs > 0) {
                            progressPercentage = Math.round((completedBacklogIds.length / totalBacklogs) * 100);
                        }
                    } catch (error) {
                        console.warn(`Error loading progress for team ${teamDoc.id}:`, error);
                    }
                    
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
                        totalBacklogs: totalBacklogs,
                        completedTasks: completedBacklogIds.length,
                        progressPercentage: progressPercentage
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
                    frozen: sortedTeams.filter(t => t.frozen).length,
                    lowProgress: sortedTeams.filter(t => t.hasSchedule && t.progressPercentage < 50).length
                };
                
                // Get teams with low progress (< 50%)
                const lowProgressTeams = sortedTeams.filter(t => t.hasSchedule && t.progressPercentage < 50)
                    .sort((a, b) => a.progressPercentage - b.progressPercentage);
                
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
                            <div style="padding: 1rem; background: white; border-radius: 6px; text-align: center;">
                                <div style="font-size: 2rem; font-weight: 700; color: ${stats.lowProgress > 0 ? '#ef4444' : '#10b981'}; margin-bottom: 0.25rem;">${stats.lowProgress}</div>
                                <div style="font-size: 0.85rem; color: var(--text-secondary);">Low Progress</div>
                            </div>
                        </div>
                    </div>
                    
                    ${lowProgressTeams.length > 0 ? `
                    <div style="margin-bottom: 2rem; padding: 1.5rem; background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-radius: 8px; border-left: 4px solid #ef4444; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.1);">
                        <h4 style="margin: 0 0 1rem 0; color: #991b1b; font-size: 1.1rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i> Teams with Low Progress (< 50%)
                        </h4>
                        <p style="margin: 0 0 1rem 0; color: #7f1d1d; font-size: 0.9rem;">
                            The following teams have completed less than 50% of their first sprint tasks. Consider reaching out to provide additional support.
                        </p>
                        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                            ${lowProgressTeams.map(team => {
                                const progressColor = team.progressPercentage < 25 ? '#ef4444' : (team.progressPercentage < 40 ? '#f59e0b' : '#3b82f6');
                                return `
                                    <div style="padding: 0.875rem; background: white; border-radius: 6px; border-left: 3px solid ${progressColor}; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                                        <div style="flex: 1; min-width: 0;">
                                            <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.25rem; font-size: 0.9rem;">${escapeHtml(team.name)}</div>
                                            <div style="font-size: 0.8rem; color: var(--text-secondary);">Guide: ${escapeHtml(team.guideName)}</div>
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0;">
                                            <div style="min-width: 140px;">
                                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem; gap: 0.5rem;">
                                                    <span style="font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap;">Progress:</span>
                                                    <span style="font-weight: 600; color: ${progressColor}; font-size: 0.85rem; white-space: nowrap;">${team.progressPercentage}%</span>
                                                </div>
                                                <div style="width: 100%; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
                                                    <div style="height: 100%; background: linear-gradient(90deg, ${progressColor} 0%, ${progressColor}dd 100%); width: ${team.progressPercentage}%; transition: width 0.3s ease; border-radius: 4px;"></div>
                                                </div>
                                                <div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.25rem; text-align: right;">
                                                    ${team.completedTasks} / ${team.totalBacklogs} tasks
                                                </div>
                                            </div>
                                            <button type="button" class="btn btn-primary btn-sm" onclick="app.loadAdminFirstReviewSchedule('${team.id}')" style="padding: 0.35rem 0.7rem; font-size: 0.8rem; white-space: nowrap;">
                                                <i class="fas fa-eye"></i> View
                                            </button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                    ` : ''}
                    
                    <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
                        <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; table-layout: auto;">
                            <thead>
                                <tr style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white;">
                                    <th style="padding: 0.75rem; text-align: left; font-weight: 600; font-size: 0.9rem;">Team Name</th>
                                    <th style="padding: 0.75rem; text-align: left; font-weight: 600; font-size: 0.9rem;">Guide</th>
                                    <th style="padding: 0.75rem; text-align: center; font-weight: 600; font-size: 0.9rem;">Schedule</th>
                                    <th style="padding: 0.75rem; text-align: center; font-weight: 600; font-size: 0.9rem;">Status</th>
                                    <th style="padding: 0.75rem; text-align: center; font-weight: 600; font-size: 0.9rem;">Freeze</th>
                                    <th style="padding: 0.75rem; text-align: center; font-weight: 600; font-size: 0.9rem; min-width: 110px;">Progress</th>
                                    <th style="padding: 0.75rem; text-align: center; font-weight: 600; font-size: 0.9rem;">Modules</th>
                                    <th style="padding: 0.75rem; text-align: center; font-weight: 600; font-size: 0.9rem;">Backlogs</th>
                                    <th style="padding: 0.75rem; text-align: center; font-weight: 600; font-size: 0.9rem;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sortedTeams.map((team, index) => {
                                    const statusColor = team.verified ? '#10b981' : (team.submitted ? '#3b82f6' : '#6b7280');
                                    const statusText = team.verified ? 'Verified' : (team.submitted ? 'Submitted' : 'Not Submitted');
                                    const freezeColor = team.frozen ? '#f59e0b' : '#6b7280';
                                    const freezeText = team.frozen ? 'Frozen' : 'Active';
                                    
                                    // Progress bar color based on percentage
                                    let progressColor = '#10b981'; // Green for high progress
                                    if (team.progressPercentage < 25) {
                                        progressColor = '#ef4444'; // Red for very low progress
                                    } else if (team.progressPercentage < 50) {
                                        progressColor = '#f59e0b'; // Orange for low progress
                                    } else if (team.progressPercentage < 75) {
                                        progressColor = '#3b82f6'; // Blue for medium progress
                                    }
                                    
                                    return `
                                        <tr style="border-bottom: 1px solid #e5e7eb; ${index % 2 === 0 ? 'background: #f9fafb;' : 'background: white;'}">
                                            <td style="padding: 0.75rem; font-weight: 600; color: var(--text-primary); font-size: 0.9rem; vertical-align: middle;">
                                                ${escapeHtml(team.name)}
                                            </td>
                                            <td style="padding: 0.75rem; color: var(--text-secondary); font-size: 0.85rem; vertical-align: middle;">
                                                ${escapeHtml(team.guideName)}
                                            </td>
                                            <td style="padding: 0.75rem; text-align: center; vertical-align: middle;">
                                                <span style="padding: 0.35rem 0.65rem; background: ${team.hasSchedule ? '#10b981' : '#6b7280'}; color: white; border-radius: 10px; font-size: 0.8rem; font-weight: 600;">
                                                    ${team.hasSchedule ? '<i class="fas fa-check"></i> Yes' : '<i class="fas fa-times"></i> No'}
                                                </span>
                                            </td>
                                            <td style="padding: 0.75rem; text-align: center; vertical-align: middle;">
                                                <span style="padding: 0.35rem 0.65rem; background: ${statusColor}; color: white; border-radius: 10px; font-size: 0.8rem; font-weight: 600;">
                                                    ${statusText}
                                                </span>
                                            </td>
                                            <td style="padding: 0.75rem; text-align: center; vertical-align: middle;">
                                                <span style="padding: 0.35rem 0.65rem; background: ${freezeColor}; color: white; border-radius: 10px; font-size: 0.8rem; font-weight: 600;">
                                                    <i class="fas ${team.frozen ? 'fa-lock' : 'fa-unlock'}"></i> ${freezeText}
                                                </span>
                                            </td>
                                            <td style="padding: 0.75rem; text-align: center; vertical-align: middle;">
                                                ${team.hasSchedule ? `
                                                    <div style="min-width: 100px; max-width: 130px; margin: 0 auto;">
                                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem; gap: 0.25rem;">
                                                            <span style="font-size: 0.7rem; color: var(--text-primary); font-weight: 600; white-space: nowrap;">${team.progressPercentage}%</span>
                                                            <span style="font-size: 0.65rem; color: var(--text-secondary); white-space: nowrap;">${team.completedTasks}/${team.totalBacklogs}</span>
                                                        </div>
                                                        <div style="width: 100%; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
                                                            <div style="height: 100%; background: linear-gradient(90deg, ${progressColor} 0%, ${progressColor}dd 100%); width: ${team.progressPercentage}%; transition: width 0.3s ease; border-radius: 4px;"></div>
                                                        </div>
                                                    </div>
                                                ` : '<span style="color: var(--text-secondary); font-size: 0.75rem;">N/A</span>'}
                                            </td>
                                            <td style="padding: 0.75rem; text-align: center; color: var(--text-primary); font-size: 0.9rem; vertical-align: middle;">
                                                ${team.modulesCount}
                                            </td>
                                            <td style="padding: 0.75rem; text-align: center; color: var(--text-primary); font-size: 0.9rem; vertical-align: middle;">
                                                ${team.totalBacklogs}
                                            </td>
                                            <td style="padding: 0.75rem; text-align: center; vertical-align: middle;">
                                                <button type="button" class="btn btn-primary btn-sm" onclick="app.loadAdminFirstReviewSchedule('${team.id}')" style="padding: 0.35rem 0.7rem; font-size: 0.8rem;">
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
        
        async generateFirstSprintProgressReport() {
            if (!app.isAdmin) return;
            
            try {
                // Load all teams with progress data
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
                    
                    // Load student progress
                    let completedBacklogIds = [];
                    let imageLinks = [];
                    let progressPercentage = 0;
                    let completedTasks = 0;
                    
                    try {
                        const studentProgressDoc = await getDoc(doc(window.firebaseDb, 'firstReviewStudentProgress', teamDoc.id));
                        if (studentProgressDoc.exists()) {
                            const progressData = studentProgressDoc.data();
                            completedBacklogIds = progressData.completedBacklogIds || [];
                            imageLinks = progressData.imageLinks || [];
                        }
                        completedTasks = completedBacklogIds.length;
                        if (totalBacklogs > 0) {
                            progressPercentage = Math.round((completedTasks / totalBacklogs) * 100);
                        }
                    } catch (error) {
                        console.warn(`Error loading progress for team ${teamDoc.id}:`, error);
                    }
                    
                    teams.push({
                        id: teamDoc.id,
                        name: teamData.name || teamData.groupName || `Team ${teamDoc.id.substring(0, 8)}`,
                        guideName: teamData.guideName || 'No Guide',
                        topic: teamData.topic || 'Not assigned',
                        hasSchedule: hasSchedule,
                        submitted: scheduleData?.submitted || false,
                        verified: scheduleData?.verified || false,
                        frozen: scheduleData?.frozen || false,
                        modulesCount: scheduleData?.modules?.length || 0,
                        totalBacklogs: totalBacklogs,
                        completedTasks: completedTasks,
                        progressPercentage: progressPercentage,
                        imageLinksCount: imageLinks.length
                    });
                }
                
                if (teams.length === 0) {
                    alert('No teams found to generate report.');
                    return;
                }
                
                // Apply team order
                const teamsForOrdering = teams.map(t => ({
                    id: t.id,
                    groupName: t.name
                }));
                const sortedTeamsForOrdering = await app.applyTeamOrder(teamsForOrdering);
                const teamMap = new Map(teams.map(t => [t.id, t]));
                const sortedTeams = sortedTeamsForOrdering.map(s => teamMap.get(s.id)).filter(Boolean);
                
                // Calculate statistics
                const teamsWithSchedule = sortedTeams.filter(t => t.hasSchedule);
                const stats = {
                    total: sortedTeams.length,
                    hasSchedule: teamsWithSchedule.length,
                    submitted: sortedTeams.filter(t => t.submitted).length,
                    verified: sortedTeams.filter(t => t.verified).length,
                    frozen: sortedTeams.filter(t => t.frozen).length,
                    averageProgress: teamsWithSchedule.length > 0 
                        ? Math.round(teamsWithSchedule.reduce((sum, t) => sum + t.progressPercentage, 0) / teamsWithSchedule.length)
                        : 0,
                    lowProgress: sortedTeams.filter(t => t.hasSchedule && t.progressPercentage < 50).length,
                    highProgress: sortedTeams.filter(t => t.hasSchedule && t.progressPercentage >= 75).length,
                    totalCompletedTasks: teamsWithSchedule.reduce((sum, t) => sum + t.completedTasks, 0),
                    totalTasks: teamsWithSchedule.reduce((sum, t) => sum + t.totalBacklogs, 0)
                };
                
                const printWindow = window.open('', '_blank');
                const currentDate = new Date().toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                let html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>First Sprint Progress Report</title>
                        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Lato:wght@400;600;700&display=swap" rel="stylesheet">
                        <style>
                            @media print {
                                @page {
                                    margin: 1.5cm;
                                    size: A4 landscape;
                                }
                                body {
                                    margin: 0;
                                    padding: 0;
                                    -webkit-print-color-adjust: exact;
                                    print-color-adjust: exact;
                                }
                                .no-print {
                                    display: none;
                                }
                                * {
                                    -webkit-print-color-adjust: exact;
                                    print-color-adjust: exact;
                                }
                            }
                            * {
                                margin: 0;
                                padding: 0;
                                box-sizing: border-box;
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                            body {
                                font-family: 'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                margin: 0;
                                padding: 20px;
                                color: #1e293b;
                                background: #ffffff;
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                            .header {
                                text-align: center;
                                margin-bottom: 35px;
                                padding: 25px;
                                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                                background-color: #10b981;
                                border-radius: 12px;
                                box-shadow: 0 10px 25px rgba(16, 185, 129, 0.2);
                                color: white;
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                            .header h1 {
                                margin: 0 0 15px 0;
                                font-family: 'Montserrat', sans-serif;
                                font-size: 32px;
                                font-weight: 700;
                                text-transform: uppercase;
                                letter-spacing: 1.5px;
                                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                            }
                            .header .subtitle {
                                font-size: 16px;
                                font-weight: 400;
                                opacity: 0.95;
                                margin: 8px 0;
                            }
                            .header .stats {
                                display: flex;
                                justify-content: center;
                                gap: 30px;
                                margin-top: 20px;
                                flex-wrap: wrap;
                            }
                            .header .stat-item {
                                background: rgba(255, 255, 255, 0.2);
                                padding: 10px 20px;
                                border-radius: 8px;
                                backdrop-filter: blur(10px);
                            }
                            .header .stat-label {
                                font-size: 12px;
                                opacity: 0.9;
                                text-transform: uppercase;
                                letter-spacing: 1px;
                            }
                            .header .stat-value {
                                font-size: 24px;
                                font-weight: 700;
                                margin-top: 5px;
                            }
                            table {
                                width: 100%;
                                border-collapse: separate;
                                border-spacing: 0;
                                margin-top: 25px;
                                font-size: 12px;
                                background: white;
                                border-radius: 10px;
                                overflow: hidden;
                                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                            th {
                                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                                background-color: #10b981;
                                color: white !important;
                                padding: 14px 10px;
                                text-align: left;
                                font-weight: 700;
                                font-family: 'Montserrat', sans-serif;
                                font-size: 12px;
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                                border: none;
                                position: relative;
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                            th:not(:last-child)::after {
                                content: '';
                                position: absolute;
                                right: 0;
                                top: 20%;
                                height: 60%;
                                width: 1px;
                                background: rgba(255, 255, 255, 0.3);
                            }
                            td {
                                padding: 12px 10px;
                                border-bottom: 1px solid #cbd5e1;
                                vertical-align: middle;
                                font-family: 'Lato', sans-serif;
                            }
                            tr:nth-child(even) {
                                background: #f8fafc;
                            }
                            tr:hover {
                                background: #f1f5f9;
                            }
                            .progress-bar-container {
                                width: 100px;
                                height: 20px;
                                background: #e5e7eb;
                                border-radius: 10px;
                                overflow: hidden;
                                position: relative;
                                margin: 0 auto;
                            }
                            .progress-bar-fill {
                                height: 100%;
                                border-radius: 10px;
                                transition: width 0.3s ease;
                            }
                            .progress-text {
                                position: absolute;
                                top: 50%;
                                left: 50%;
                                transform: translate(-50%, -50%);
                                font-size: 10px;
                                font-weight: 700;
                                color: #1e293b;
                                z-index: 1;
                            }
                            .status-badge {
                                display: inline-block;
                                padding: 4px 10px;
                                border-radius: 12px;
                                font-size: 11px;
                                font-weight: 600;
                                text-align: center;
                            }
                            .status-verified {
                                background: #10b981;
                                color: white;
                            }
                            .status-submitted {
                                background: #3b82f6;
                                color: white;
                            }
                            .status-pending {
                                background: #6b7280;
                                color: white;
                            }
                            .status-frozen {
                                background: #f59e0b;
                                color: white;
                            }
                            .status-active {
                                background: #6b7280;
                                color: white;
                            }
                            .text-center {
                                text-align: center;
                            }
                            .text-right {
                                text-align: right;
                            }
                            .no-print {
                                display: none;
                            }
                            .footer {
                                margin-top: 40px;
                                text-align: center;
                                font-size: 12px;
                                color: #1e40af;
                                border-top: 2px solid #cbd5e1;
                                padding-top: 20px;
                                font-family: 'Lato', sans-serif;
                            }
                            .footer .logo-text {
                                font-family: 'Montserrat', sans-serif;
                                font-weight: 700;
                                font-size: 16px;
                                color: #10b981;
                                margin-bottom: 5px;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1>First Sprint Progress Report</h1>
                            <div class="subtitle">Consolidated Progress Report for All Teams</div>
                            <div class="subtitle">Generated on: ${currentDate}</div>
                            <div class="stats">
                                <div class="stat-item">
                                    <div class="stat-label">Total Teams</div>
                                    <div class="stat-value">${stats.total}</div>
                                </div>
                                <div class="stat-item">
                                    <div class="stat-label">Has Schedule</div>
                                    <div class="stat-value">${stats.hasSchedule}</div>
                                </div>
                                <div class="stat-item">
                                    <div class="stat-label">Average Progress</div>
                                    <div class="stat-value">${stats.averageProgress}%</div>
                                </div>
                                <div class="stat-item">
                                    <div class="stat-label">High Progress (≥75%)</div>
                                    <div class="stat-value">${stats.highProgress}</div>
                                </div>
                                <div class="stat-item">
                                    <div class="stat-label">Low Progress (<50%)</div>
                                    <div class="stat-value">${stats.lowProgress}</div>
                                </div>
                                <div class="stat-item">
                                    <div class="stat-label">Total Completed</div>
                                    <div class="stat-value">${stats.totalCompletedTasks}/${stats.totalTasks}</div>
                                </div>
                            </div>
                        </div>
                        
                        <table>
                            <thead>
                                <tr>
                                    <th style="width: 5%;">#</th>
                                    <th style="width: 12%;">Team Name</th>
                                    <th style="width: 12%;">Guide</th>
                                    <th style="width: 15%;">Topic</th>
                                    <th style="width: 8%;" class="text-center">Status</th>
                                    <th style="width: 8%;" class="text-center">Freeze</th>
                                    <th style="width: 12%;" class="text-center">Progress</th>
                                    <th style="width: 10%;" class="text-center">Completed</th>
                                    <th style="width: 8%;" class="text-center">Modules</th>
                                    <th style="width: 10%;" class="text-center">Total Tasks</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                
                sortedTeams.forEach((team, index) => {
                    const statusColor = team.verified ? 'status-verified' : (team.submitted ? 'status-submitted' : 'status-pending');
                    const statusText = team.verified ? 'Verified' : (team.submitted ? 'Submitted' : 'Not Submitted');
                    const freezeStatus = team.frozen ? 'status-frozen' : 'status-active';
                    const freezeText = team.frozen ? 'Frozen' : 'Active';
                    
                    // Progress bar color
                    let progressColor = '#10b981';
                    if (team.progressPercentage < 25) {
                        progressColor = '#ef4444';
                    } else if (team.progressPercentage < 50) {
                        progressColor = '#f59e0b';
                    } else if (team.progressPercentage < 75) {
                        progressColor = '#3b82f6';
                    }
                    
                    html += `
                        <tr>
                            <td class="text-center">${index + 1}</td>
                            <td style="font-weight: 600;">${escapeHtml(team.name)}</td>
                            <td>${escapeHtml(team.guideName)}</td>
                            <td style="font-size: 11px;">${escapeHtml(team.topic)}</td>
                            <td class="text-center">
                                <span class="status-badge ${statusColor}">${statusText}</span>
                            </td>
                            <td class="text-center">
                                <span class="status-badge ${freezeStatus}">${freezeText}</span>
                            </td>
                            <td class="text-center">
                                ${team.hasSchedule ? `
                                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                                        <div class="progress-bar-container">
                                            <div class="progress-bar-fill" style="width: ${team.progressPercentage}%; background: ${progressColor};"></div>
                                            <div class="progress-text">${team.progressPercentage}%</div>
                                        </div>
                                        <div style="font-size: 10px; color: #64748b;">${team.completedTasks}/${team.totalBacklogs}</div>
                                    </div>
                                ` : '<span style="color: #94a3b8;">N/A</span>'}
                            </td>
                            <td class="text-center" style="font-weight: 600;">${team.hasSchedule ? team.completedTasks : '-'}</td>
                            <td class="text-center">${team.modulesCount}</td>
                            <td class="text-center">${team.hasSchedule ? team.totalBacklogs : '-'}</td>
                        </tr>
                    `;
                });
                
                html += `
                            </tbody>
                        </table>
                        
                        <div style="margin-top: 30px; padding: 20px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #10b981;">
                            <h3 style="margin: 0 0 15px 0; color: #1e293b; font-size: 18px; font-weight: 600;">
                                <i class="fas fa-info-circle"></i> Report Summary
                            </h3>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; font-size: 13px;">
                                <div>
                                    <strong>Total Teams:</strong> ${stats.total}
                                </div>
                                <div>
                                    <strong>Teams with Schedule:</strong> ${stats.hasSchedule}
                                </div>
                                <div>
                                    <strong>Submitted Schedules:</strong> ${stats.submitted}
                                </div>
                                <div>
                                    <strong>Verified Schedules:</strong> ${stats.verified}
                                </div>
                                <div>
                                    <strong>Frozen Schedules:</strong> ${stats.frozen}
                                </div>
                                <div>
                                    <strong>Average Progress:</strong> ${stats.averageProgress}%
                                </div>
                                <div>
                                    <strong>High Progress Teams (≥75%):</strong> ${stats.highProgress}
                                </div>
                                <div>
                                    <strong>Low Progress Teams (<50%):</strong> ${stats.lowProgress}
                                </div>
                                <div>
                                    <strong>Total Tasks Completed:</strong> ${stats.totalCompletedTasks} out of ${stats.totalTasks}
                                </div>
                                <div>
                                    <strong>Overall Completion Rate:</strong> ${stats.totalTasks > 0 ? Math.round((stats.totalCompletedTasks / stats.totalTasks) * 100) : 0}%
                                </div>
                            </div>
                        </div>
                        
                        <div class="footer">
                            <div class="logo-text">IGNITE</div>
                            <p>Mini Project Management System - First Sprint Progress Report</p>
                            <p>Generated on ${currentDate}</p>
                        </div>
                    </body>
                    </html>
                `;
                
                printWindow.document.write(html);
                printWindow.document.close();
                
                // Wait for content to load before printing
                setTimeout(() => {
                    printWindow.focus();
                }, 500);
                
            } catch (error) {
                console.error('Error generating progress report:', error);
                alert('Error generating progress report. Please try again.');
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
                
                // Load student progress (completed tasks and image links)
                let completedBacklogIds = [];
                let imageLinks = [];
                try {
                    const studentProgressDoc = await getDoc(doc(window.firebaseDb, 'firstReviewStudentProgress', teamId));
                    if (studentProgressDoc.exists()) {
                        const progressData = studentProgressDoc.data();
                        completedBacklogIds = progressData.completedBacklogIds || [];
                        imageLinks = progressData.imageLinks || [];
                    }
                } catch (error) {
                    console.warn('Error loading student progress:', error);
                }
                
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
                await app.renderAdminFirstReviewScheduleContent(teamId, scheduleData, allModules, allBacklogs, backlogToModule, completedBacklogIds, imageLinks);
                
            } catch (error) {
                console.error('Error loading first review schedule:', error);
                alert('Error loading schedule. Please try again.');
                modal.remove();
            }
        },
        
        async renderAdminFirstReviewScheduleContent(teamId, scheduleData, allModules, allBacklogs, backlogToModule, completedBacklogIds = [], imageLinks = []) {
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
                        
                        // Sort backlogs by order
                        const sortedBacklogs = [...moduleBacklogs].map(backlog => {
                            const backlogSchedule = scheduleModule.productBacklogs?.find(pb => pb.backlogId === backlog.id);
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
                                        const isCompleted = completedBacklogIds.includes(String(backlog.id));
                                        return app.renderAdminBacklogItem(backlog, backlogSchedule, scheduleModule.moduleId, teamId, isCompleted);
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
                    
                    standaloneBacklogs.forEach(backlog => {
                        const backlogSchedule = scheduleData.standaloneBacklogs.find(pb => String(pb.backlogId) === String(backlog.id));
                        if (backlogSchedule) {
                            const isCompleted = completedBacklogIds.includes(String(backlog.id));
                            html += app.renderAdminBacklogItem(backlog, backlogSchedule, null, teamId, isCompleted);
                        }
                    });
                    
                    html += '</div>';
                } else {
                    html += '<div class="admin-card" style="padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 6px; background: #fafbfc;">';
                    html += '<p class="empty-state" style="font-size: 0.85rem; margin: 0;">No standalone backlogs. <button type="button" class="btn btn-primary btn-sm" onclick="app.showAdminAddBacklogModal(\'' + teamId + '\', null)" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; margin-left: 0.5rem;">Add One</button></p>';
                    html += '</div>';
                }
                
                // Add student progress section (completed tasks summary and image links)
                // Always show progress section
                html += '<div style="margin-top: 2rem; padding: 1.5rem; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 8px; border-left: 4px solid #10b981; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.1);">';
                html += '<h3 style="margin: 0 0 1rem 0; color: #065f46; display: flex; align-items: center; gap: 0.5rem; font-size: 1rem;"><i class="fas fa-chart-line" style="color: #10b981;"></i> Student Progress</h3>';
                
                // Completed tasks summary
                const totalBacklogs = (scheduleData.modules?.reduce((sum, m) => sum + (m.productBacklogs?.length || 0), 0) || 0) + (scheduleData.standaloneBacklogs?.length || 0);
                const completedCount = completedBacklogIds.length;
                const completionPercentage = totalBacklogs > 0 ? Math.round((completedCount / totalBacklogs) * 100) : 0;
                
                html += `<div style="margin-bottom: 1.5rem; padding: 1rem; background: white; border-radius: 6px; border: 1px solid #d1fae5;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <strong style="color: var(--text-primary); font-size: 0.9rem;">Completed Tasks:</strong>
                        <span style="font-size: 1.1rem; font-weight: 600; color: #10b981;">${completedCount} / ${totalBacklogs} (${completionPercentage}%)</span>
                    </div>
                    <div style="width: 100%; height: 12px; background: #d1fae5; border-radius: 6px; overflow: hidden;">
                        <div style="height: 100%; background: linear-gradient(90deg, #10b981 0%, #059669 100%); width: ${completionPercentage}%; transition: width 0.3s ease;"></div>
                    </div>
                </div>`;
                
                // Image links
                html += '<div style="margin-top: 1rem;"><h4 style="margin: 0 0 0.75rem 0; color: #065f46; font-size: 0.95rem;"><i class="fas fa-images"></i> Project Progress Images</h4>';
                if (imageLinks.length > 0) {
                    html += '<div style="display: flex; flex-direction: column; gap: 0.75rem;">';
                    imageLinks.forEach((link, index) => {
                        html += `<div style="padding: 1rem; background: white; border-radius: 6px; border: 1px solid #d1fae5;">
                            <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" style="color: #10b981; text-decoration: none; word-break: break-all; display: flex; align-items: center; gap: 0.5rem;">
                                <i class="fas fa-external-link-alt"></i>
                                <span>${escapeHtml(link)}</span>
                            </a>
                        </div>`;
                    });
                    html += '</div>';
                } else {
                    html += '<p style="color: var(--text-secondary); font-size: 0.9rem; font-style: italic;">No image links added yet.</p>';
                }
                html += '</div></div>';
                
                container.innerHTML = html;
            } catch (error) {
                console.error('Error rendering schedule content:', error);
                container.innerHTML = '<p class="error-message">Error rendering schedule. Please try again.</p>';
            }
        },
        
        renderAdminBacklogItem(backlog, backlogSchedule, moduleId, teamId, isCompleted = false) {
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
                     style="padding: 0.75rem; background: ${isCompleted ? '#f0fdf4' : '#ffffff'}; border-radius: 4px; border-left: 3px solid ${priorityColor}; margin-bottom: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05); cursor: move;"
                     ondragstart="app.handleAdminBacklogDragStart(event, '${backlog.id}', '${moduleId || 'standalone'}', '${teamId}')"
                     ondragover="app.handleAdminBacklogDragOver(event)"
                     ondrop="app.handleAdminBacklogDrop(event, '${backlog.id}', '${moduleId || 'standalone'}', '${teamId}')"
                     ondragend="app.handleAdminBacklogDragEnd(event)">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem; gap: 0.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-right: 0.5rem;">
                            <i class="fas fa-grip-vertical" style="color: #9ca3af; cursor: move; font-size: 0.8rem;" title="Drag to reorder"></i>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem;">
                                ${isCompleted ? '<i class="fas fa-check-circle" style="color: #10b981; font-size: 0.85rem;"></i>' : ''}
                                <div style="font-weight: 600; color: var(--text-primary); font-size: 0.85rem; line-height: 1.3; ${isCompleted ? 'text-decoration: line-through; opacity: 0.7;' : ''}">
                                    ${escapeHtml(backlog.task || backlog.description || 'Untitled Task')}
                                </div>
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
        },
        
        async loadGitHubReposTeams() {
            if (!app.isAdmin) return;
            
            const container = document.getElementById('github-repos-teams-list');
            if (!container) return;
            
            container.innerHTML = '<div class="loading-state">Loading teams with GitHub repositories...</div>';
            
            try {
                const teamsQuery = query(collection(window.firebaseDb, 'projectGroups'));
                const teamsSnapshot = await getDocs(teamsQuery);
                
                const teams = [];
                teamsSnapshot.forEach(doc => {
                    const data = doc.data();
                    if (!data.deleted && data.githubRepository) {
                        teams.push({
                            id: doc.id,
                            groupName: data.groupName || data.name || 'Unnamed Team',
                            githubRepository: data.githubRepository,
                            guideName: data.guideName || 'No Guide',
                            topic: data.topic || 'Not assigned',
                            members: data.members || []
                        });
                    }
                });
                
                if (teams.length === 0) {
                    container.innerHTML = '<p class="empty-state">No teams with GitHub repositories found.</p>';
                    return;
                }
                
                // Apply team order
                const teamsForOrdering = teams.map(t => ({
                    id: t.id,
                    groupName: t.groupName
                }));
                const sortedTeamsForOrdering = await app.applyTeamOrder(teamsForOrdering);
                const teamMap = new Map(teams.map(t => [t.id, t]));
                const sortedTeams = sortedTeamsForOrdering.map(s => teamMap.get(s.id)).filter(Boolean);
                
                // Store teams for search and PDF generation
                app.githubReposTeams = sortedTeams;
                
                container.innerHTML = `
                    <div style="margin-bottom: 1.5rem; padding: 1rem; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 8px; border-left: 4px solid #10b981;">
                        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                            <i class="fab fa-github" style="font-size: 1.5rem; color: #10b981;"></i>
                            <div>
                                <h4 style="margin: 0; color: #065f46; font-size: 1.1rem;">Total Teams with GitHub Repositories</h4>
                                <p style="margin: 0.25rem 0 0 0; color: #047857; font-size: 0.9rem;">${sortedTeams.length} team${sortedTeams.length !== 1 ? 's' : ''} have updated their GitHub repositories</p>
                            </div>
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 1rem;">
                        ${sortedTeams.map(team => `
                            <div class="project-team-item" style="border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                <div class="team-header" style="margin-bottom: 0.75rem;">
                                    <h4 style="margin: 0; color: var(--text-primary); font-size: 1rem;">${escapeHtml(team.groupName)}</h4>
                                </div>
                                <div style="margin-bottom: 0.5rem;">
                                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.25rem;">
                                        <i class="fas fa-user-tie" style="margin-right: 0.5rem;"></i>Guide: ${escapeHtml(team.guideName)}
                                    </div>
                                    ${team.topic && team.topic !== 'Not assigned' ? `
                                        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.25rem;">
                                            <i class="fas fa-lightbulb" style="margin-right: 0.5rem;"></i>Topic: ${escapeHtml(team.topic)}
                                        </div>
                                    ` : ''}
                                    ${team.members && team.members.length > 0 ? `
                                        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
                                            <i class="fas fa-users" style="margin-right: 0.5rem;"></i>Members: ${team.members.length}
                                        </div>
                                    ` : ''}
                                </div>
                                <div style="padding: 0.75rem; background: #f8fafc; border-radius: 6px; border-left: 3px solid #10b981;">
                                    <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem;">
                                        <i class="fab fa-github" style="color: #10b981; margin-right: 0.5rem;"></i>GitHub Repository:
                                    </div>
                                    <a href="${escapeHtml(team.githubRepository)}" target="_blank" rel="noopener noreferrer" 
                                       style="color: #10b981; text-decoration: none; word-break: break-all; display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem;">
                                        <i class="fas fa-external-link-alt"></i>
                                        <span>${escapeHtml(team.githubRepository)}</span>
                                    </a>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
                
                // Setup search functionality
                const searchInput = document.getElementById('search-github-repos-teams');
                if (searchInput) {
                    searchInput.oninput = (e) => {
                        const searchTerm = e.target.value.toLowerCase();
                        const teamCards = container.querySelectorAll('.project-team-item');
                        teamCards.forEach(card => {
                            const teamText = card.textContent.toLowerCase();
                            card.style.display = teamText.includes(searchTerm) ? '' : 'none';
                        });
                    };
                }
            } catch (error) {
                console.error('Error loading GitHub repositories:', error);
                container.innerHTML = '<p class="error-message">Error loading teams with GitHub repositories. Please try again.</p>';
            }
        },
        
        async generateGitHubReposReport() {
            if (!app.isAdmin) return;
            
            try {
                // Load teams data if not already loaded
                if (!app.githubReposTeams || app.githubReposTeams.length === 0) {
                    // Load teams with GitHub repos
                    const teamsQuery = query(collection(window.firebaseDb, 'projectGroups'));
                    const teamsSnapshot = await getDocs(teamsQuery);
                    
                    const teams = [];
                    teamsSnapshot.forEach(doc => {
                        const data = doc.data();
                        if (!data.deleted && data.githubRepository) {
                            teams.push({
                                id: doc.id,
                                groupName: data.groupName || data.name || 'Unnamed Team',
                                githubRepository: data.githubRepository,
                                guideName: data.guideName || 'No Guide',
                                topic: data.topic || 'Not assigned',
                                members: data.members || []
                            });
                        }
                    });
                    
                    // Apply team order
                    const teamsForOrdering = teams.map(t => ({
                        id: t.id,
                        groupName: t.groupName
                    }));
                    const sortedTeamsForOrdering = await app.applyTeamOrder(teamsForOrdering);
                    const teamMap = new Map(teams.map(t => [t.id, t]));
                    app.githubReposTeams = sortedTeamsForOrdering.map(s => teamMap.get(s.id)).filter(Boolean);
                }
                
                const teams = app.githubReposTeams;
                
                if (teams.length === 0) {
                    alert('No teams with GitHub repositories found to generate report.');
                    return;
                }
                
                const printWindow = window.open('', '_blank');
                const currentDate = new Date().toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                let html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>GitHub Repositories Report</title>
                        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Lato:wght@400;600;700&display=swap" rel="stylesheet">
                        <style>
                            @media print {
                                @page {
                                    margin: 1.5cm;
                                    size: A4 portrait;
                                }
                                body {
                                    margin: 0;
                                    padding: 0;
                                    -webkit-print-color-adjust: exact;
                                    print-color-adjust: exact;
                                }
                                .no-print {
                                    display: none;
                                }
                                * {
                                    -webkit-print-color-adjust: exact;
                                    print-color-adjust: exact;
                                }
                            }
                            * {
                                margin: 0;
                                padding: 0;
                                box-sizing: border-box;
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                            body {
                                font-family: 'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                margin: 0;
                                padding: 20px;
                                color: #1e293b;
                                background: #ffffff;
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                            .header {
                                text-align: center;
                                margin-bottom: 35px;
                                padding: 25px;
                                background: linear-gradient(135deg, #24292e 0%, #1a1e22 100%);
                                background-color: #24292e;
                                border-radius: 12px;
                                box-shadow: 0 10px 25px rgba(36, 41, 46, 0.2);
                                color: white;
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                            .header h1 {
                                margin: 0 0 15px 0;
                                font-family: 'Montserrat', sans-serif;
                                font-size: 32px;
                                font-weight: 700;
                                text-transform: uppercase;
                                letter-spacing: 1.5px;
                                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                            }
                            .header .subtitle {
                                font-size: 16px;
                                font-weight: 400;
                                opacity: 0.95;
                                margin: 8px 0;
                            }
                            .header .stats {
                                display: flex;
                                justify-content: center;
                                gap: 30px;
                                margin-top: 20px;
                                flex-wrap: wrap;
                            }
                            .header .stat-item {
                                background: rgba(255, 255, 255, 0.2);
                                padding: 10px 20px;
                                border-radius: 8px;
                                backdrop-filter: blur(10px);
                            }
                            .header .stat-label {
                                font-size: 12px;
                                opacity: 0.9;
                                text-transform: uppercase;
                                letter-spacing: 1px;
                            }
                            .header .stat-value {
                                font-size: 24px;
                                font-weight: 700;
                                margin-top: 5px;
                            }
                            table {
                                width: 100%;
                                border-collapse: separate;
                                border-spacing: 0;
                                margin-top: 25px;
                                font-size: 11px;
                                background: white;
                                border-radius: 10px;
                                overflow: hidden;
                                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                            th {
                                background: linear-gradient(135deg, #24292e 0%, #1a1e22 100%);
                                background-color: #24292e;
                                color: white !important;
                                padding: 12px 8px;
                                text-align: left;
                                font-weight: 700;
                                font-family: 'Montserrat', sans-serif;
                                font-size: 11px;
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                                border: none;
                                position: relative;
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                            th:not(:last-child)::after {
                                content: '';
                                position: absolute;
                                right: 0;
                                top: 20%;
                                height: 60%;
                                width: 1px;
                                background: rgba(255, 255, 255, 0.3);
                            }
                            td {
                                padding: 10px 8px;
                                border-bottom: 1px solid #cbd5e1;
                                vertical-align: top;
                                font-family: 'Lato', sans-serif;
                            }
                            tr:nth-child(even) {
                                background: #f8fafc;
                            }
                            tr:hover {
                                background: #f1f5f9;
                            }
                            .repo-link {
                                color: #0366d6;
                                text-decoration: none;
                                word-break: break-all;
                                font-size: 10px;
                            }
                            .repo-link:hover {
                                text-decoration: underline;
                            }
                            .text-center {
                                text-align: center;
                            }
                            .text-right {
                                text-align: right;
                            }
                            .no-print {
                                display: none;
                            }
                            .footer {
                                margin-top: 40px;
                                text-align: center;
                                font-size: 12px;
                                color: #6a737d;
                                border-top: 2px solid #cbd5e1;
                                padding-top: 20px;
                                font-family: 'Lato', sans-serif;
                            }
                            .footer .logo-text {
                                font-family: 'Montserrat', sans-serif;
                                font-weight: 700;
                                font-size: 16px;
                                color: #24292e;
                                margin-bottom: 5px;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1><i class="fab fa-github"></i> GitHub Repositories Report</h1>
                            <div class="subtitle">Teams with Updated GitHub Repositories</div>
                            <div class="subtitle">Generated on: ${currentDate}</div>
                            <div class="stats">
                                <div class="stat-item">
                                    <div class="stat-label">Total Teams</div>
                                    <div class="stat-value">${teams.length}</div>
                                </div>
                            </div>
                        </div>
                        
                        <table>
                            <thead>
                                <tr>
                                    <th style="width: 5%;">#</th>
                                    <th style="width: 20%;">Team Name</th>
                                    <th style="width: 15%;">Guide</th>
                                    <th style="width: 20%;">Topic</th>
                                    <th style="width: 10%;" class="text-center">Members</th>
                                    <th style="width: 30%;">GitHub Repository</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                
                teams.forEach((team, index) => {
                    html += `
                        <tr>
                            <td class="text-center">${index + 1}</td>
                            <td style="font-weight: 600;">${escapeHtml(team.groupName)}</td>
                            <td>${escapeHtml(team.guideName)}</td>
                            <td style="font-size: 10px;">${escapeHtml(team.topic)}</td>
                            <td class="text-center">${team.members ? team.members.length : 0}</td>
                            <td>
                                <a href="${escapeHtml(team.githubRepository)}" target="_blank" class="repo-link">
                                    ${escapeHtml(team.githubRepository)}
                                </a>
                            </td>
                        </tr>
                    `;
                });
                
                html += `
                            </tbody>
                        </table>
                        
                        <div class="footer">
                            <div class="logo-text">IGNITE</div>
                            <p>Mini Project Management System - GitHub Repositories Report</p>
                            <p>Generated on ${currentDate}</p>
                        </div>
                    </body>
                    </html>
                `;
                
                printWindow.document.write(html);
                printWindow.document.close();
                
                // Wait for content to load before printing
                setTimeout(() => {
                    printWindow.focus();
                }, 500);
                
            } catch (error) {
                console.error('Error generating GitHub repositories report:', error);
                alert('Error generating progress report. Please try again.');
            }
        }
    };
}

