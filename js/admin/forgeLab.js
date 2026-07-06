// Forge Lab — admin analytics
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
    getSlotLabel,
    getDomainLabel,
    getForgeLabDomains,
    getAssignedSlots,
    sortSlotsByDateTime
} from '../utils/forgeLabConfig.js';

export function createAdminForgeLabModule(app) {
    return {
        async loadForgeLabAnalytics() {
            const summaryEl = document.getElementById('forge-lab-admin-summary');
            const chartsEl = document.getElementById('forge-lab-admin-charts');
            const listEl = document.getElementById('forge-lab-admin-students');
            if (!summaryEl || !chartsEl || !listEl) return;

            summaryEl.innerHTML = '<div class="loading-state">Loading Forge Lab analytics...</div>';
            chartsEl.innerHTML = '';
            listEl.innerHTML = '';

            if (!app.isAdmin && app.userRole !== 'admin') {
                summaryEl.innerHTML = '<div class="error-message">Access denied. Admin access required.</div>';
                return;
            }

            try {
                const usersQuery = query(
                    collection(window.firebaseDb, 'users'),
                    where('role', '==', 'student')
                );
                const usersSnapshot = await getDocs(usersQuery);

                const students = [];
                const domainCounts = {};
                const slotCounts = {};
                let totalEnrolled = 0;
                let totalSessions = 0;
                let totalMinutes = 0;
                let totalMilestones = 0;
                let completedMilestones = 0;

                const today = new Date();

                for (const userDoc of usersSnapshot.docs) {
                    const userData = userDoc.data();
                    const studentDataDoc = await getDoc(doc(window.firebaseDb, 'userData', userDoc.id));
                    const studentData = studentDataDoc.exists() ? studentDataDoc.data() : {};
                    const forge = studentData.forgeLab;

                    if (!forge?.enrolled) continue;

                    totalEnrolled++;
                    const logs = forge.sessionLogs || [];
                    const sessionCount = logs.length;
                    const minutes = logs.reduce((s, l) => s + (l.durationMinutes || 0), 0);
                    totalSessions += sessionCount;
                    totalMinutes += minutes;

                    const milestones = forge.path?.milestones || [];
                    totalMilestones += milestones.length;
                    completedMilestones += milestones.filter(m => m.status === 'completed').length;

                    getForgeLabDomains(forge).forEach(d => {
                        const key = `${d.category}::${d.subDomain}`;
                        domainCounts[key] = (domainCounts[key] || 0) + 1;
                    });

                    logs.forEach(log => {
                        if (log.slotId) {
                            slotCounts[log.slotId] = (slotCounts[log.slotId] || 0) + 1;
                        }
                    });

                    const lastLog = [...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
                    const lastDate = lastLog ? new Date(lastLog.date) : null;
                    const daysSince = lastDate
                        ? Math.floor((today - lastDate) / (1000 * 60 * 60 * 24))
                        : 999;

                    students.push({
                        id: userDoc.id,
                        name: userData.name || userData.username || 'Unknown',
                        ktuid: userData.username || '',
                        forge,
                        sessionCount,
                        minutes,
                        milestoneTotal: milestones.length,
                        milestoneDone: milestones.filter(m => m.status === 'completed').length,
                        daysSinceSession: daysSince,
                        isInactive: daysSince > 7 || sessionCount === 0
                    });
                }

                const avgSessions = totalEnrolled > 0 ? (totalSessions / totalEnrolled).toFixed(1) : 0;
                const avgMinutes = totalEnrolled > 0 ? Math.round(totalMinutes / totalEnrolled) : 0;
                const milestoneRate = totalMilestones > 0
                    ? Math.round((completedMilestones / totalMilestones) * 100)
                    : 0;
                const inactiveCount = students.filter(s => s.isInactive).length;

                app.allForgeLabStudents = students;

                this.renderForgeLabAdminSummary({
                    totalEnrolled,
                    totalSessions,
                    totalMinutes,
                    avgSessions,
                    avgMinutes,
                    milestoneRate,
                    inactiveCount
                }, summaryEl);

                this.renderForgeLabAdminCharts(domainCounts, slotCounts, students, chartsEl);
                this.renderForgeLabAdminStudents(students, listEl);
                this.setupForgeLabAdminSearch();
            } catch (err) {
                console.error('Forge Lab analytics error:', err);
                summaryEl.innerHTML = '<div class="error-message">Failed to load Forge Lab analytics.</div>';
            }
        },

        renderForgeLabAdminSummary(stats, summaryEl) {
            summaryEl.innerHTML = `
                <div class="summary-grid">
                    <div class="summary-card">
                        <div class="summary-icon" style="background: linear-gradient(135deg, #f97316, #ea580c);">
                            <i class="fas fa-users"></i>
                        </div>
                        <div class="summary-content">
                            <div class="summary-value">${stats.totalEnrolled}</div>
                            <div class="summary-label">Enrolled Students</div>
                        </div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-icon" style="background: linear-gradient(135deg, #3b82f6, #2563eb);">
                            <i class="fas fa-fire"></i>
                        </div>
                        <div class="summary-content">
                            <div class="summary-value">${stats.totalSessions}</div>
                            <div class="summary-label">Total Lab Sessions</div>
                            <div class="summary-sub">Avg ${stats.avgSessions} per student</div>
                        </div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-icon" style="background: linear-gradient(135deg, #10b981, #059669);">
                            <i class="fas fa-clock"></i>
                        </div>
                        <div class="summary-content">
                            <div class="summary-value">${stats.totalMinutes}</div>
                            <div class="summary-label">Total Focused Minutes</div>
                            <div class="summary-sub">Avg ${stats.avgMinutes} min/student</div>
                        </div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-icon" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed);">
                            <i class="fas fa-flag-checkered"></i>
                        </div>
                        <div class="summary-content">
                            <div class="summary-value">${stats.milestoneRate}%</div>
                            <div class="summary-label">Milestone Completion</div>
                            <div class="summary-sub">${stats.inactiveCount} inactive (7+ days)</div>
                        </div>
                    </div>
                </div>
            `;
        },

        renderForgeLabAdminCharts(domainCounts, slotCounts, students, chartsEl) {
            const maxDomain = Math.max(...Object.values(domainCounts), 1);
            const maxSlot = Math.max(...Object.values(slotCounts), 1);

            const domainBars = Object.entries(domainCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([key, count]) => {
                    const [cat, sub] = key.split('::');
                    const label = getDomainLabel(cat, sub);
                    const pct = Math.round((count / maxDomain) * 100);
                    return `
                        <div class="chart-bar-row">
                            <span class="chart-bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
                            <div class="chart-bar-track">
                                <div class="chart-bar-fill" style="width: ${pct}%; background: #f97316;"></div>
                            </div>
                            <span class="chart-bar-value">${count}</span>
                        </div>
                    `;
                }).join('') || '<p class="empty-state">No enrollments yet.</p>';

            const slotBars = Object.entries(slotCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([slotId, count]) => {
                    const pct = Math.round((count / maxSlot) * 100);
                    const studentWithSlot = students.find(s =>
                        (s.forge.sessionLogs || []).some(l => l.slotId === slotId)
                    );
                    const label = studentWithSlot
                        ? getSlotLabel(slotId, studentWithSlot.forge)
                        : getSlotLabel(slotId);
                    return `
                        <div class="chart-bar-row">
                            <span class="chart-bar-label">${escapeHtml(label)}</span>
                            <div class="chart-bar-track">
                                <div class="chart-bar-fill" style="width: ${pct}%; background: #3b82f6;"></div>
                            </div>
                            <span class="chart-bar-value">${count}</span>
                        </div>
                    `;
                }).join('') || '<p class="empty-state">No slot preferences recorded.</p>';

            const ratingBuckets = [0, 0, 0, 0, 0, 0];
            students.forEach(s => {
                (s.forge.sessionLogs || []).forEach(log => {
                    if (log.selfRating >= 1 && log.selfRating <= 5) {
                        ratingBuckets[log.selfRating]++;
                    }
                });
            });
            const maxRating = Math.max(...ratingBuckets.slice(1), 1);

            const ratingBars = [1, 2, 3, 4, 5].map(r => {
                const count = ratingBuckets[r];
                const pct = Math.round((count / maxRating) * 100);
                return `
                    <div class="chart-bar-row">
                        <span class="chart-bar-label">${'★'.repeat(r)}</span>
                        <div class="chart-bar-track">
                            <div class="chart-bar-fill" style="width: ${pct}%; background: #f59e0b;"></div>
                        </div>
                        <span class="chart-bar-value">${count}</span>
                    </div>
                `;
            }).join('');

            chartsEl.innerHTML = `
                <div class="charts-grid">
                    <div class="chart-card">
                        <h3><i class="fas fa-layer-group"></i> Enrollment by Domain</h3>
                        <div class="chart-bars">${domainBars}</div>
                    </div>
                    <div class="chart-card">
                        <h3><i class="fas fa-calendar-alt"></i> Lab Slots Used (from sessions)</h3>
                        <div class="chart-bars">${slotBars}</div>
                    </div>
                    <div class="chart-card">
                        <h3><i class="fas fa-star"></i> Session Self-Ratings</h3>
                        <div class="chart-bars">${ratingBars}</div>
                    </div>
                </div>
            `;
        },

        renderForgeLabAdminStudents(students, listEl) {
            students.sort((a, b) => {
                if (a.isInactive !== b.isInactive) return a.isInactive ? -1 : 1;
                return b.sessionCount - a.sessionCount;
            });

            if (students.length === 0) {
                listEl.innerHTML = '<div class="empty-state">No students enrolled in Forge Lab yet.</div>';
                return;
            }

            listEl.innerHTML = students.map(s => {
                const forge = s.forge;
                const domains = getForgeLabDomains(forge);
                const pathPct = s.milestoneTotal > 0
                    ? Math.round((s.milestoneDone / s.milestoneTotal) * 100)
                    : 0;
                const recentLogs = (forge.sessionLogs || [])
                    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                    .slice(0, 3);

                const domainsHtml = domains.map(d => `
                    <div class="forge-lab-admin-domain-item">
                        <strong>${escapeHtml(getDomainLabel(d.category, d.subDomain))}</strong>
                        ${d.specificFocus ? `<span> — ${escapeHtml(d.specificFocus)}</span>` : ''}
                    </div>
                `).join('');

                const assigned = sortSlotsByDateTime(getAssignedSlots(forge));
                const slotAssignHtml = this.renderAdminSlotAssignment(s, assigned);

                return `
                    <div class="forge-lab-admin-student-card ${s.isInactive ? 'inactive-student' : ''}" data-name="${escapeHtml(s.name.toLowerCase())}" data-ktuid="${escapeHtml(s.ktuid.toLowerCase())}" data-student-id="${escapeHtml(s.id)}">
                        <div class="forge-lab-admin-student-header">
                            <div>
                                <h4>${escapeHtml(s.name)} <small>(${escapeHtml(s.ktuid)})</small></h4>
                                <p class="forge-lab-admin-domain">${domains.length} focus area${domains.length !== 1 ? 's' : ''}</p>
                            </div>
                            <div class="forge-lab-admin-badges">
                                ${s.isInactive ? '<span class="badge badge-warning">Inactive</span>' : '<span class="badge badge-success">Active</span>'}
                                <span class="badge">${s.sessionCount} sessions</span>
                                <span class="badge">${s.minutes} min</span>
                            </div>
                        </div>
                        <div class="forge-lab-admin-details">
                            <p><strong>Focus areas:</strong></p>
                            ${domainsHtml || '<p>—</p>'}
                            <p><strong>Target:</strong> ${escapeHtml(forge.targetOutcome || forge.domain?.targetOutcome || '—')}</p>
                            ${forge.path?.title ? `<p><strong>Path:</strong> ${escapeHtml(forge.path.title)} — ${pathPct}% complete (${s.milestoneDone}/${s.milestoneTotal} milestones)</p>` : ''}
                            ${(forge.skillsToAcquire || forge.domain?.skillsToAcquire || []).length ? `<p><strong>Skills:</strong> ${(forge.skillsToAcquire || forge.domain?.skillsToAcquire || []).map(sk => escapeHtml(sk)).join(', ')}</p>` : ''}
                        </div>
                        ${slotAssignHtml}
                        ${recentLogs.length ? `
                            <div class="forge-lab-admin-recent">
                                <strong>Recent Sessions:</strong>
                                ${recentLogs.map(log => `
                                    <div class="forge-lab-admin-log-item">
                                        <span>${escapeHtml(log.date)}</span> —
                                        ${escapeHtml(log.whatWorkedOn?.substring(0, 100) || '')}${(log.whatWorkedOn?.length || 0) > 100 ? '…' : ''}
                                        <em>(${log.durationMinutes} min)</em>
                                    </div>
                                `).join('')}
                            </div>
                        ` : '<p class="empty-state" style="margin:0.5rem 0;">No sessions logged yet.</p>'}
                    </div>
                `;
            }).join('');
        },

        renderAdminSlotRow(studentId, slot) {
            const rowId = escapeHtml(slot.id);
            return `
                <div class="forge-lab-custom-slot-row" data-row-id="${rowId}">
                    <div class="forge-lab-custom-slot-field">
                        <label>Date</label>
                        <input type="date" class="form-input forge-lab-slot-date" value="${escapeHtml(slot.date || '')}">
                    </div>
                    <div class="forge-lab-custom-slot-field">
                        <label>Start</label>
                        <input type="time" class="form-input forge-lab-slot-start" value="${escapeHtml(slot.startTime || '')}">
                    </div>
                    <div class="forge-lab-custom-slot-field">
                        <label>End</label>
                        <input type="time" class="form-input forge-lab-slot-end" value="${escapeHtml(slot.endTime || '')}">
                    </div>
                    <button type="button" class="btn btn-sm btn-danger forge-lab-slot-remove"
                        onclick="app.removeAdminForgeLabSlotRow('${escapeHtml(studentId)}', '${rowId}')"
                        title="Remove slot">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        },

        renderAdminSlotAssignment(student, assigned) {
            const rowsHtml = assigned.length
                ? assigned.map(slot => this.renderAdminSlotRow(student.id, slot)).join('')
                : '<p class="form-hint forge-lab-no-slots-msg">No lab slots yet. Add one below.</p>';

            return `
                <div class="forge-lab-admin-slot-assign" id="slot-assign-${escapeHtml(student.id)}">
                    <p><strong><i class="fas fa-calendar-check"></i> Lab slots</strong></p>
                    <p class="form-hint">Pick a date and start/end time for each lab session.</p>
                    <div id="slot-rows-${escapeHtml(student.id)}" class="forge-lab-custom-slots">
                        ${rowsHtml}
                    </div>
                    <button type="button" class="btn btn-sm btn-secondary" style="margin-top: 0.75rem;"
                        onclick="app.addAdminForgeLabSlotRow('${escapeHtml(student.id)}')">
                        <i class="fas fa-plus"></i> Add slot
                    </button>
                    <button type="button" class="btn btn-sm btn-primary" style="margin-top: 0.75rem; margin-left: 0.5rem;"
                        onclick="app.saveStudentForgeLabSlots('${escapeHtml(student.id)}')">
                        <i class="fas fa-save"></i> Save slots
                    </button>
                </div>
            `;
        },

        addAdminForgeLabSlotRow(studentId) {
            const rowsEl = document.getElementById(`slot-rows-${studentId}`);
            if (!rowsEl) return;

            const emptyMsg = rowsEl.querySelector('.forge-lab-no-slots-msg');
            if (emptyMsg) emptyMsg.remove();

            const newSlot = {
                id: `slot_${Date.now()}`,
                date: '',
                startTime: '',
                endTime: ''
            };
            rowsEl.insertAdjacentHTML('beforeend', this.renderAdminSlotRow(studentId, newSlot));
        },

        removeAdminForgeLabSlotRow(studentId, rowId) {
            const rowsEl = document.getElementById(`slot-rows-${studentId}`);
            if (!rowsEl) return;

            const row = rowsEl.querySelector(`[data-row-id="${rowId}"]`);
            if (row) row.remove();

            if (!rowsEl.querySelector('.forge-lab-custom-slot-row')) {
                rowsEl.innerHTML = '<p class="form-hint forge-lab-no-slots-msg">No lab slots yet. Add one below.</p>';
            }
        },

        collectAdminForgeLabSlots(studentId) {
            const rowsEl = document.getElementById(`slot-rows-${studentId}`);
            if (!rowsEl) return [];

            return [...rowsEl.querySelectorAll('.forge-lab-custom-slot-row')].map(row => ({
                id: row.dataset.rowId || `slot_${Date.now()}`,
                date: row.querySelector('.forge-lab-slot-date')?.value || '',
                startTime: row.querySelector('.forge-lab-slot-start')?.value || '',
                endTime: row.querySelector('.forge-lab-slot-end')?.value || ''
            }));
        },

        validateForgeLabSlots(slots) {
            for (const slot of slots) {
                if (!slot.date || !slot.startTime || !slot.endTime) {
                    return 'Each slot needs a date, start time, and end time.';
                }
                if (slot.endTime <= slot.startTime) {
                    return 'End time must be after start time.';
                }
            }
            return null;
        },

        async saveStudentForgeLabSlots(studentId) {
            if (!app.isAdmin && app.userRole !== 'admin') {
                alert('Admin access required.');
                return;
            }

            const container = document.getElementById(`slot-assign-${studentId}`);
            if (!container) return;

            const slots = this.collectAdminForgeLabSlots(studentId);
            const validationError = this.validateForgeLabSlots(slots);
            if (validationError) {
                alert(validationError);
                return;
            }

            try {
                const studentDataRef = doc(window.firebaseDb, 'userData', studentId);
                const studentDataDoc = await getDoc(studentDataRef);
                const data = studentDataDoc.exists() ? studentDataDoc.data() : {};

                if (!data.forgeLab?.enrolled) {
                    alert('Student is not enrolled in Forge Lab.');
                    return;
                }

                data.forgeLab.assignedSlots = slots.map(s => ({
                    id: s.id,
                    date: s.date,
                    startTime: s.startTime,
                    endTime: s.endTime
                }));
                data.forgeLab.slotsAssignedAt = new Date().toISOString();

                await setDoc(studentDataRef, { forgeLab: data.forgeLab }, { merge: true });
                alert('Lab slots saved. Students will see the updated schedule.');
                await this.loadForgeLabAnalytics();
            } catch (err) {
                console.error('Failed to save slot assignment:', err);
                alert('Failed to save slots. Please try again.');
            }
        },

        setupForgeLabAdminSearch() {
            const searchInput = document.getElementById('search-forge-lab-students');
            if (!searchInput || searchInput.dataset.bound) return;
            searchInput.dataset.bound = 'true';

            searchInput.addEventListener('input', () => {
                const term = searchInput.value.toLowerCase().trim();
                document.querySelectorAll('.forge-lab-admin-student-card').forEach(card => {
                    const name = card.dataset.name || '';
                    const ktuid = card.dataset.ktuid || '';
                    card.style.display = (!term || name.includes(term) || ktuid.includes(term)) ? '' : 'none';
                });
            });
        }
    };
}
