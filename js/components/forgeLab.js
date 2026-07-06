// Forge Lab — student skill upgrade & focused lab sessions
import { escapeHtml } from '../utils/helpers.js';
import {
    FORGE_LAB_DOMAINS,
    FORGE_LAB_COMMITMENT,
    getSlotLabel,
    getDomainLabel,
    getDefaultForgeLab,
    getForgeLabDomains,
    getAssignedSlots,
    formatCustomSlotLabel,
    sortSlotsByDateTime,
    isLoggableSlot,
    findAssignedSlot
} from '../utils/forgeLabConfig.js';

function isCustomCategory(category) {
    return category === 'custom';
}

export function createForgeLabModule(app) {
    const pendingEnrollmentDomains = [];

    return {
        ensureForgeLab(data) {
            if (!data.forgeLab) {
                data.forgeLab = getDefaultForgeLab();
            }
            const forge = data.forgeLab;
            if (!forge.path) {
                forge.path = { title: '', objective: '', milestones: [], createdAt: null, updatedAt: null };
            }
            if (!forge.path.milestones) forge.path.milestones = [];
            if (!forge.sessionLogs) forge.sessionLogs = [];
            if (!forge.domains) forge.domains = getForgeLabDomains(forge);
            if (forge.domain?.targetOutcome && !forge.targetOutcome) {
                forge.targetOutcome = forge.domain.targetOutcome;
            }
            if (forge.domain?.skillsToAcquire?.length && !forge.skillsToAcquire?.length) {
                forge.skillsToAcquire = forge.domain.skillsToAcquire;
            }
            if (!forge.skillsToAcquire) forge.skillsToAcquire = [];
            if (forge.targetOutcome === undefined) forge.targetOutcome = '';
            if (!Array.isArray(forge.assignedSlots)) forge.assignedSlots = [];
            return forge;
        },

        renderForgeLabCommitmentList() {
            const list = document.getElementById('forge-lab-commitment-list');
            if (!list) return;
            list.innerHTML = FORGE_LAB_COMMITMENT.points.map(p => `<li>${escapeHtml(p)}</li>`).join('');
        },

        async loadForgeLab() {
            this.populateForgeLabDomainSelect();
            const data = await app.getUserData();
            if (!data) return;
            const forge = this.ensureForgeLab(data);

            const enrollSection = document.getElementById('forge-lab-enroll-section');
            const workspaceSection = document.getElementById('forge-lab-workspace-section');
            if (!enrollSection || !workspaceSection) return;

            if (forge.enrolled) {
                enrollSection.style.display = 'none';
                workspaceSection.style.display = 'block';
                this.renderForgeLabHome(forge);
                this.renderForgeLabPlan(forge);
                this.initForgeLabLogForm(forge);
            } else {
                enrollSection.style.display = 'block';
                workspaceSection.style.display = 'none';
                this.populateForgeLabSubDomainSelect('');
                this.updateForgeLabFocusFieldUIFor('forge-lab-');
                this.renderForgeLabPendingDomains();
            }
        },

        populateForgeLabDomainSelect() {
            this.fillForgeLabCategorySelect('forge-lab-domain-category');
            this.fillForgeLabCategorySelect('forge-lab-add-domain-category');
        },

        fillForgeLabCategorySelect(selectId) {
            const select = document.getElementById(selectId);
            if (!select) return;
            if (select.dataset.populated === 'true') return;
            select.innerHTML = '<option value="">Choose...</option>';
            Object.entries(FORGE_LAB_DOMAINS).forEach(([id, domain]) => {
                select.innerHTML += `<option value="${id}">${escapeHtml(domain.label)}</option>`;
            });
            select.dataset.populated = 'true';
        },

        populateForgeLabSubDomainSelect(categoryId, subSelectId = 'forge-lab-domain-sub') {
            const select = document.getElementById(subSelectId);
            if (!select) return;
            select.innerHTML = '<option value="">Choose...</option>';
            if (!categoryId || !FORGE_LAB_DOMAINS[categoryId]) return;
            FORGE_LAB_DOMAINS[categoryId].subDomains.forEach(sub => {
                select.innerHTML += `<option value="${sub.id}">${escapeHtml(sub.label)}</option>`;
            });
        },

        updateForgeLabFocusFieldUIFor(prefix) {
            const category = document.getElementById(`${prefix}domain-category`)?.value || '';
            const isCustom = category === 'custom';
            const subSelect = document.getElementById(`${prefix}domain-sub`);
            const subGroup = document.getElementById(`${prefix}subdomain-group`);
            const label = document.getElementById(`${prefix}specific-focus-label`);
            const field = document.getElementById(`${prefix}specific-focus`);
            const hint = document.getElementById(`${prefix}specific-focus-hint`);

            if (isCustom && subSelect) {
                if (subSelect.options.length > 1 && !subSelect.value) {
                    subSelect.value = 'self-defined';
                }
                if (subGroup) subGroup.style.display = 'none';
                if (label) label.innerHTML = '<strong>Details</strong>';
                if (field) {
                    field.rows = 4;
                    field.placeholder = 'Describe what you want to learn or achieve...';
                }
                if (hint) hint.textContent = '';
            } else {
                if (subGroup) subGroup.style.display = '';
                if (label) label.innerHTML = '<strong>Details</strong>';
                if (field) {
                    field.rows = 2;
                    field.placeholder = 'e.g. React apps, DSA practice, project ideas';
                }
                if (hint) hint.textContent = '';
            }
        },

        onForgeLabAddDomainChange() {
            const category = document.getElementById('forge-lab-add-domain-category')?.value || '';
            this.populateForgeLabSubDomainSelect(category, 'forge-lab-add-domain-sub');
            const desc = document.getElementById('forge-lab-add-domain-description');
            if (desc) desc.textContent = FORGE_LAB_DOMAINS[category]?.description || '';
            this.updateForgeLabFocusFieldUIFor('forge-lab-add-');
        },

        onForgeLabAddSubDomainChange() {
            this.updateForgeLabFocusFieldUIFor('forge-lab-add-');
        },

        buildFocusAreaFromForm(prefix) {
            const category = document.getElementById(`${prefix}domain-category`)?.value;
            let subDomain = document.getElementById(`${prefix}domain-sub`)?.value;
            const specificFocus = document.getElementById(`${prefix}specific-focus`)?.value.trim() || '';

            if (isCustomCategory(category)) subDomain = 'self-defined';

            if (!category || !subDomain) {
                return { error: isCustomCategory(category)
                    ? 'Choose Custom as your topic area.'
                    : 'Choose a topic area and focus.' };
            }
            if (!specificFocus) {
                return { error: isCustomCategory(category)
                    ? 'Describe what you want to work on.'
                    : 'Add a few details about your focus.' };
            }
            return {
                entry: {
                    id: `dom_${Date.now()}`,
                    category,
                    subDomain,
                    specificFocus
                }
            };
        },

        isDuplicateFocusArea(domains, entry) {
            return domains.some(d =>
                d.category === entry.category &&
                d.subDomain === entry.subDomain &&
                d.specificFocus === entry.specificFocus
            );
        },

        addForgeLabFocusArea() {
            const result = this.buildFocusAreaFromForm('forge-lab-');
            if (result.error) { alert(result.error); return; }

            if (this.isDuplicateFocusArea(pendingEnrollmentDomains, result.entry)) {
                alert('This topic is already on your list.');
                return;
            }

            pendingEnrollmentDomains.push(result.entry);
            document.getElementById('forge-lab-specific-focus').value = '';
            this.renderForgeLabPendingDomains();
        },

        onForgeLabDomainChange() {
            const category = document.getElementById('forge-lab-domain-category')?.value || '';
            this.populateForgeLabSubDomainSelect(category, 'forge-lab-domain-sub');
            const desc = document.getElementById('forge-lab-domain-description');
            if (desc) desc.textContent = FORGE_LAB_DOMAINS[category]?.description || '';
            this.updateForgeLabFocusFieldUIFor('forge-lab-');
        },

        onForgeLabSubDomainChange() {
            this.updateForgeLabFocusFieldUIFor('forge-lab-');
        },

        removeForgeLabFocusArea(domainId) {
            const idx = pendingEnrollmentDomains.findIndex(d => d.id === domainId);
            if (idx !== -1) pendingEnrollmentDomains.splice(idx, 1);
            this.renderForgeLabPendingDomains();
        },

        renderForgeLabPendingDomains() {
            const container = document.getElementById('forge-lab-pending-domains');
            if (!container) return;

            if (pendingEnrollmentDomains.length === 0) {
                container.innerHTML = '<p class="empty-state">Add at least one topic above.</p>';
                return;
            }

            container.innerHTML = pendingEnrollmentDomains.map(d => `
                <div class="forge-lab-pending-domain-card">
                    <div class="forge-lab-pending-domain-info">
                        <strong>${escapeHtml(getDomainLabel(d.category, d.subDomain))}</strong>
                        <p>${escapeHtml(d.specificFocus)}</p>
                    </div>
                    <button type="button" class="btn btn-sm btn-danger" onclick="app.removeForgeLabFocusArea('${escapeHtml(d.id)}')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `).join('');
        },

        async addEnrolledForgeLabFocusArea() {
            const result = this.buildFocusAreaFromForm('forge-lab-add-');
            if (result.error) { alert(result.error); return; }

            const data = await app.getUserData();
            if (!data) return;
            const forge = this.ensureForgeLab(data);

            if (this.isDuplicateFocusArea(forge.domains, result.entry)) {
                alert('This topic is already on your profile.');
                return;
            }

            forge.domains.push(result.entry);
            forge.updatedAt = new Date().toISOString();

            await app.saveUserData(data);

            document.getElementById('forge-lab-add-specific-focus').value = '';
            document.getElementById('forge-lab-add-domain-category').value = '';
            document.getElementById('forge-lab-add-domain-sub').innerHTML = '<option value="">Choose...</option>';
            const desc = document.getElementById('forge-lab-add-domain-description');
            if (desc) desc.textContent = '';

            alert('Topic added!');
            await this.loadForgeLab();
            this.showForgeLabTab('home');
        },

        async removeEnrolledForgeLabFocusArea(domainId) {
            const data = await app.getUserData();
            if (!data) return;
            const forge = this.ensureForgeLab(data);

            if (forge.domains.length <= 1) {
                alert('Keep at least one topic on your profile.');
                return;
            }

            if (!confirm('Remove this topic?')) return;

            forge.domains = forge.domains.filter(d => d.id !== domainId);
            forge.updatedAt = new Date().toISOString();

            await app.saveUserData(data);
            await this.loadForgeLab();
            this.showForgeLabTab('home');
        },

        async saveForgeLabGoals() {
            const targetOutcome = document.getElementById('forge-lab-update-target-outcome')?.value.trim() || '';
            const skillsRaw = document.getElementById('forge-lab-update-skills')?.value.trim() || '';

            if (!targetOutcome) {
                alert('Please enter your goal.');
                return;
            }

            const data = await app.getUserData();
            if (!data) return;
            const forge = this.ensureForgeLab(data);

            forge.targetOutcome = targetOutcome;
            forge.skillsToAcquire = skillsRaw
                ? skillsRaw.split(',').map(s => s.trim()).filter(Boolean)
                : [];
            forge.updatedAt = new Date().toISOString();

            await app.saveUserData(data);
            alert('Goal saved!');
            await this.loadForgeLab();
            this.showForgeLabTab('plan');
        },

        async enrollForgeLab() {
            const targetOutcome = document.getElementById('forge-lab-target-outcome')?.value.trim() || '';
            const skillsRaw = document.getElementById('forge-lab-skills')?.value.trim() || '';

            if (pendingEnrollmentDomains.length === 0) {
                alert('Add at least one topic before joining.');
                return;
            }
            if (!targetOutcome) {
                alert('Please write your goal.');
                return;
            }
            if (!document.getElementById('forge-lab-commitment-accept')?.checked) {
                alert('Please agree to the Forge Lab Promise.');
                return;
            }

            const skillsToAcquire = skillsRaw
                ? skillsRaw.split(',').map(s => s.trim()).filter(Boolean)
                : [];

            const data = await app.getUserData();
            if (!data) return;
            const forge = this.ensureForgeLab(data);

            forge.enrolled = true;
            forge.enrolledAt = new Date().toISOString();
            forge.commitmentAcceptedAt = new Date().toISOString();
            forge.domains = pendingEnrollmentDomains.map(d => ({ ...d }));
            forge.targetOutcome = targetOutcome;
            forge.skillsToAcquire = skillsToAcquire;
            forge.assignedSlots = [];
            forge.updatedAt = new Date().toISOString();

            pendingEnrollmentDomains.length = 0;
            const commitmentCb = document.getElementById('forge-lab-commitment-accept');
            if (commitmentCb) commitmentCb.checked = false;

            await app.saveUserData(data);
            alert('Welcome to Forge Lab!');
            await this.loadForgeLab();
            this.showForgeLabTab('home');
        },

        async showForgeLabTab(tabId) {
            document.querySelectorAll('.forge-lab-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.forge-lab-tab-panel').forEach(p => p.classList.remove('active'));
            const tab = document.querySelector(`.forge-lab-tab[data-tab="${tabId}"]`);
            const panel = document.getElementById(`forge-lab-tab-${tabId}`);
            if (tab) tab.classList.add('active');
            if (panel) panel.classList.add('active');

            if (tabId === 'log') {
                const data = await app.getUserData();
                if (data) {
                    this.initForgeLabLogForm(this.ensureForgeLab(data));
                }
            }
        },

        renderForgeLabHome(forge) {
            const el = document.getElementById('forge-lab-home');
            if (!el) return;

            const totalSessions = (forge.sessionLogs || []).length;
            const totalMinutes = (forge.sessionLogs || []).reduce((s, l) => s + (l.durationMinutes || 0), 0);
            const assigned = sortSlotsByDateTime(getAssignedSlots(forge));
            const domains = getForgeLabDomains(forge);

            const slotsHtml = assigned.length
                ? assigned.map(slot => `
                    <div class="forge-lab-dash-slot-item">
                        <i class="fas fa-clock"></i>
                        <span>${escapeHtml(formatCustomSlotLabel(slot))}</span>
                    </div>
                `).join('')
                : '<p class="forge-lab-dash-empty"><i class="fas fa-hourglass-half"></i> Your lab times will appear here once assigned.</p>';

            const topicsHtml = domains.map(d => `
                <div class="forge-lab-pending-domain-card">
                    <div class="forge-lab-pending-domain-info">
                        <strong>${escapeHtml(getDomainLabel(d.category, d.subDomain))}</strong>
                        <p>${escapeHtml(d.specificFocus || '')}</p>
                    </div>
                    ${domains.length > 1 ? `
                        <button type="button" class="btn btn-sm btn-danger"
                            onclick="app.removeEnrolledForgeLabFocusArea('${escapeHtml(d.id)}')" title="Remove">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : ''}
                </div>
            `).join('');

            const recentLogs = [...(forge.sessionLogs || [])]
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 5);

            const recentHtml = recentLogs.length
                ? recentLogs.map(log => `
                    <div class="forge-lab-session-card">
                        <div class="forge-lab-session-header">
                            <div>
                                <strong>${escapeHtml(log.date)}</strong>
                                <span class="forge-lab-tag">${escapeHtml(getSlotLabel(log.slotId, forge))}</span>
                            </div>
                            <span class="forge-lab-session-duration">${log.durationMinutes} min</span>
                        </div>
                        <p>${escapeHtml(log.whatWorkedOn)}</p>
                        ${log.learnings ? `<p class="form-hint">${escapeHtml(log.learnings)}</p>` : ''}
                    </div>
                `).join('')
                : '<p class="forge-lab-dash-empty">No sessions yet. After lab, tap Log Session.</p>';

            el.innerHTML = `
                <div class="forge-lab-dash-stats">
                    <div class="forge-lab-dash-stat forge-lab-dash-stat-fire">
                        <span class="forge-lab-dash-stat-value">${totalSessions}</span>
                        <span class="forge-lab-dash-stat-label">Sessions</span>
                    </div>
                    <div class="forge-lab-dash-stat forge-lab-dash-stat-blue">
                        <span class="forge-lab-dash-stat-value">${totalMinutes}</span>
                        <span class="forge-lab-dash-stat-label">Minutes</span>
                    </div>
                </div>

                <div class="forge-lab-dash-card">
                    <h4><i class="fas fa-bullseye"></i> My goal</h4>
                    <p>${forge.targetOutcome ? escapeHtml(forge.targetOutcome) : '<span class="form-hint">Set your goal in My Plan.</span>'}</p>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="app.showForgeLabTab('plan')">
                        <i class="fas fa-edit"></i> Edit goal &amp; plan
                    </button>
                </div>

                <div class="forge-lab-dash-card" style="margin-top: 1rem;">
                    <h4><i class="fas fa-calendar-alt"></i> My lab slots</h4>
                    <div class="forge-lab-dash-slots">${slotsHtml}</div>
                    <button type="button" class="btn btn-primary" style="margin-top: 0.75rem;"
                        onclick="app.showForgeLabTab('log')">
                        <i class="fas fa-pen"></i> Log session
                    </button>
                </div>

                <div class="forge-lab-dash-card" style="margin-top: 1rem;">
                    <h4><i class="fas fa-bookmark"></i> My topics</h4>
                    <div class="forge-lab-dash-focus-list">${topicsHtml || '<p class="form-hint">No topics yet.</p>'}</div>
                    <div class="forge-lab-add-topic" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color, #e5e7eb);">
                        <p class="form-hint" style="margin-bottom: 0.75rem;">Add another topic anytime.</p>
                        <div class="form-group">
                            <label for="forge-lab-add-domain-category"><strong>Topic area</strong></label>
                            <select id="forge-lab-add-domain-category" class="form-input" onchange="app.onForgeLabAddDomainChange()">
                                <option value="">Choose...</option>
                            </select>
                        </div>
                        <div class="form-group" id="forge-lab-add-subdomain-group">
                            <label for="forge-lab-add-domain-sub"><strong>Focus</strong></label>
                            <select id="forge-lab-add-domain-sub" class="form-input" onchange="app.onForgeLabAddSubDomainChange()">
                                <option value="">Choose...</option>
                            </select>
                        </div>
                        <div class="form-group" id="forge-lab-add-specific-focus-group">
                            <label id="forge-lab-add-specific-focus-label" for="forge-lab-add-specific-focus"><strong>Details</strong></label>
                            <textarea id="forge-lab-add-specific-focus" class="form-input" rows="2"
                                placeholder="What exactly will you work on?"></textarea>
                        </div>
                        <button type="button" class="btn btn-secondary" onclick="app.addEnrolledForgeLabFocusArea()">
                            <i class="fas fa-plus"></i> Add topic
                        </button>
                    </div>
                </div>

                <div class="forge-lab-dash-card forge-lab-dash-recent" style="margin-top: 1rem;">
                    <h4><i class="fas fa-history"></i> Recent sessions</h4>
                    ${recentHtml}
                </div>
            `;

            this.fillForgeLabCategorySelect('forge-lab-add-domain-category');
        },

        renderForgeLabPlan(forge) {
            const targetEl = document.getElementById('forge-lab-update-target-outcome');
            const skillsEl = document.getElementById('forge-lab-update-skills');
            const titleEl = document.getElementById('forge-lab-path-title');
            const objectiveEl = document.getElementById('forge-lab-path-objective');

            if (targetEl) targetEl.value = forge.targetOutcome || '';
            if (skillsEl) skillsEl.value = (forge.skillsToAcquire || []).join(', ');
            if (titleEl) titleEl.value = forge.path.title || '';
            if (objectiveEl) objectiveEl.value = forge.path.objective || '';

            const list = document.getElementById('forge-lab-milestones-list');
            if (!list) return;

            const milestones = forge.path.milestones || [];
            if (milestones.length === 0) {
                list.innerHTML = '<p class="empty-state">No milestones yet. Add one above.</p>';
                return;
            }

            list.innerHTML = milestones.map((m, idx) => {
                const statusClass = m.status === 'completed' ? 'milestone-done'
                    : m.status === 'in_progress' ? 'milestone-active' : 'milestone-pending';
                const statusLabel = m.status === 'completed' ? 'Done'
                    : m.status === 'in_progress' ? 'In progress' : 'To do';

                return `
                    <div class="forge-lab-milestone ${statusClass}" data-id="${escapeHtml(m.id)}">
                        <div class="forge-lab-milestone-header">
                            <span class="forge-lab-milestone-num">${idx + 1}</span>
                            <div class="forge-lab-milestone-info">
                                <h4>${escapeHtml(m.title)}</h4>
                                ${m.targetDate ? `<small><i class="fas fa-calendar"></i> ${escapeHtml(m.targetDate)}</small>` : ''}
                            </div>
                            <span class="forge-lab-milestone-status">${statusLabel}</span>
                        </div>
                        <div class="forge-lab-milestone-actions">
                            ${m.status !== 'completed' ? `
                                <button type="button" class="btn btn-sm btn-primary"
                                    onclick="app.updateForgeLabMilestoneStatus('${escapeHtml(m.id)}', 'completed')">
                                    <i class="fas fa-check"></i> Done
                                </button>
                            ` : ''}
                            <button type="button" class="btn btn-sm btn-danger"
                                onclick="app.deleteForgeLabMilestone('${escapeHtml(m.id)}')">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        },

        async saveForgeLabPath() {
            const title = document.getElementById('forge-lab-path-title')?.value.trim() || '';
            const objective = document.getElementById('forge-lab-path-objective')?.value.trim() || '';

            const data = await app.getUserData();
            if (!data) return;
            const forge = this.ensureForgeLab(data);

            if (!forge.path.createdAt) forge.path.createdAt = new Date().toISOString();
            forge.path.title = title;
            forge.path.objective = objective;
            forge.path.updatedAt = new Date().toISOString();
            forge.updatedAt = new Date().toISOString();

            await app.saveUserData(data);
            alert('Plan saved!');
            await this.loadForgeLab();
        },

        async addForgeLabMilestone() {
            const title = document.getElementById('forge-lab-milestone-title')?.value.trim() || '';
            const targetDate = document.getElementById('forge-lab-milestone-date')?.value || '';

            if (!title) {
                alert('Enter a milestone name.');
                return;
            }

            const data = await app.getUserData();
            if (!data) return;
            const forge = this.ensureForgeLab(data);

            forge.path.milestones.push({
                id: `ms_${Date.now()}`,
                title,
                description: '',
                targetDate,
                linkedDomainId: null,
                linkedSkill: null,
                status: 'pending',
                completedAt: null,
                createdAt: new Date().toISOString()
            });
            forge.path.updatedAt = new Date().toISOString();
            forge.updatedAt = new Date().toISOString();

            await app.saveUserData(data);

            document.getElementById('forge-lab-milestone-title').value = '';
            document.getElementById('forge-lab-milestone-date').value = '';

            await this.loadForgeLab();
        },

        async updateForgeLabMilestoneStatus(milestoneId, status) {
            const data = await app.getUserData();
            if (!data) return;
            const forge = this.ensureForgeLab(data);

            const milestone = forge.path.milestones.find(m => m.id === milestoneId);
            if (!milestone) return;

            milestone.status = status;
            if (status === 'completed') milestone.completedAt = new Date().toISOString();
            forge.path.updatedAt = new Date().toISOString();
            forge.updatedAt = new Date().toISOString();

            await app.saveUserData(data);
            await this.loadForgeLab();
        },

        async deleteForgeLabMilestone(milestoneId) {
            if (!confirm('Remove this milestone?')) return;

            const data = await app.getUserData();
            if (!data) return;
            const forge = this.ensureForgeLab(data);

            forge.path.milestones = forge.path.milestones.filter(m => m.id !== milestoneId);
            forge.path.updatedAt = new Date().toISOString();
            forge.updatedAt = new Date().toISOString();

            await app.saveUserData(data);
            await this.loadForgeLab();
        },

        async logForgeLabSession() {
            const date = document.getElementById('forge-lab-log-date')?.value;
            const slotId = document.getElementById('forge-lab-log-slot')?.value;
            const duration = parseInt(document.getElementById('forge-lab-log-duration')?.value, 10);
            const whatWorkedOn = document.getElementById('forge-lab-log-work')?.value.trim() || '';
            const notes = document.getElementById('forge-lab-log-notes')?.value.trim() || '';

            if (!date || !slotId) {
                alert('Pick the date and lab slot.');
                return;
            }

            const data = await app.getUserData();
            if (!data) return;
            const forge = this.ensureForgeLab(data);
            const assigned = getAssignedSlots(forge);

            if (assigned.length === 0) {
                alert('Your lab slots are not assigned yet. Ask your admin.');
                return;
            }

            const matchedSlot = findAssignedSlot(forge, slotId);

            if (!matchedSlot) {
                alert('Pick one of your assigned lab slots.');
                return;
            }

            if (isNaN(duration) || duration < 1) {
                alert('Enter how many minutes you worked.');
                return;
            }
            if (!whatWorkedOn) {
                alert('Write what you did in this session.');
                return;
            }

            forge.sessionLogs.push({
                id: `log_${Date.now()}`,
                date,
                slotId: matchedSlot.id,
                durationMinutes: duration,
                focusArea: '',
                whatWorkedOn,
                learnings: notes,
                blockers: '',
                nextSteps: '',
                milestoneId: null,
                selfRating: null,
                timestamp: new Date().toISOString()
            });
            forge.updatedAt = new Date().toISOString();

            await app.saveUserData(data);

            const workEl = document.getElementById('forge-lab-log-work');
            const notesEl = document.getElementById('forge-lab-log-notes');
            if (workEl) workEl.value = '';
            if (notesEl) notesEl.value = '';

            alert('Session saved!');
            await this.loadForgeLab();
            this.showForgeLabTab('home');
        },

        initForgeLabLogForm(forge) {
            const dateEl = document.getElementById('forge-lab-log-date');
            if (dateEl && !dateEl.value) {
                dateEl.value = new Date().toISOString().split('T')[0];
            }

            const assigned = sortSlotsByDateTime(getAssignedSlots(forge));
            const slotSelect = document.getElementById('forge-lab-log-slot');
            const slotHint = document.getElementById('forge-lab-log-slot-hint');

            if (slotSelect) {
                const loggable = assigned.filter(isLoggableSlot);
                const previous = slotSelect.value;

                if (loggable.length === 0) {
                    slotSelect.innerHTML = '<option value="">No slots assigned yet</option>';
                    slotSelect.disabled = true;
                    if (slotHint) {
                        slotHint.textContent = 'Ask your admin to assign your lab slots first.';
                    }
                } else {
                    slotSelect.disabled = false;
                    slotSelect.removeAttribute('disabled');
                    slotSelect.innerHTML = '<option value="">Choose your slot...</option>' +
                        loggable.map(s => {
                            const id = String(s.id).replace(/"/g, '');
                            return `<option value="${id}">${escapeHtml(formatCustomSlotLabel(s))}</option>`;
                        }).join('');
                    if (previous && loggable.some(s => s.id === previous)) {
                        slotSelect.value = previous;
                    }
                    if (slotHint) {
                        slotHint.textContent = loggable.length === 1
                            ? 'Your assigned lab slot is selected below.'
                            : '';
                    }
                }
            }
        }
    };
}
