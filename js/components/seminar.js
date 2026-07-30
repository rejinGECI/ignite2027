// Seminar — student module
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
    SEMINAR_SCHEDULE_FIELDS,
    MIN_SEMINAR_TOPICS,
    getDefaultSeminar,
    ensureSeminarTopics,
    getLockedTopic,
    isSeminarTopicsLocked,
    isSeminarPostTopicOpen,
    formatPresentationSlot,
    formatSlotDate,
    formatRemainingDays,
    getDaysUntilDeadline,
    getDeadlineUrgencyClass,
    statusBadge,
    sumParamScores,
    normalizePaperStatus,
    isPaperEditable,
    isSeminarSubmissionEditable,
    ensureTitleAbstract,
    hasTitleAbstractSubmission,
    ensureSeminarPpt,
    hasPptSubmission
} from '../utils/seminarConfig.js?v=unlock1';

export function createSeminarModule(app) {
    return {
        ensureSeminar(data) {
            if (!data.seminar) data.seminar = getDefaultSeminar();
            const s = data.seminar;
            ensureSeminarTopics(s);
            ensureTitleAbstract(s);
            ensureSeminarPpt(s);
            if (!s.papers) s.papers = [];
            if (!s.totals) s.totals = { presentationMarks: 0, questionMarks: 0 };
            if (!s.questionHistory) s.questionHistory = [];
            if (s.postTopicWorkflowOpen === undefined) s.postTopicWorkflowOpen = false;
            // Soft-migrate: keep papers/title/PPT open after prior lock or existing submissions
            if (!s.postTopicWorkflowOpen && (
                s.lockedTopicId
                || s.papers.length > 0
                || hasTitleAbstractSubmission(s.titleAbstract)
                || hasPptSubmission(s.ppt)
            )) {
                s.postTopicWorkflowOpen = true;
            }
            return s;
        },

        async fetchSeminarSettings() {
            try {
                const snap = await getDoc(doc(window.firebaseDb, 'settings', 'seminar'));
                return snap.exists() ? snap.data() : null;
            } catch (e) {
                console.error(e);
                return null;
            }
        },

        async loadSeminar() {
            const settings = await this.fetchSeminarSettings();
            // Only hide when explicitly disabled; missing enabled defaults to on
            if (settings && settings.enabled === false) {
                const el = document.getElementById('seminar-content');
                if (el) el.innerHTML = '<p class="empty-state">Seminar module is not enabled yet.</p>';
                return;
            }

            const data = await app.getUserData();
            if (!data) return;
            const seminar = this.ensureSeminar(data);
            app.seminarSettings = settings;

            this.renderSeminarStudent(seminar, settings);
        },

        async getGuideName(guideId) {
            if (!guideId) return null;
            try {
                const snap = await getDoc(doc(window.firebaseDb, 'users', guideId));
                if (snap.exists()) {
                    const d = snap.data();
                    return d.name || d.email || 'Guide';
                }
            } catch (e) { /* ignore */ }
            return null;
        },

        topicStatusLabel(topic, lockedTopicId) {
            if (lockedTopicId && topic.id === lockedTopicId) return 'Locked (final)';
            return statusBadge(topic.status);
        },

        async renderSeminarStudent(seminar, settings) {
            const el = document.getElementById('seminar-content');
            if (!el) return;

            const guideId = seminar.guideId || settings?.guideAssignments?.[app.currentUser?.uid];
            const guideName = guideId ? await this.getGuideName(guideId) : null;
            const slotId = seminar.presentationSlotId || settings?.presentationAssignments?.[app.currentUser?.uid];
            const slot = (settings?.presentationSlots || []).find(s => s.id === slotId);
            const pres = (settings?.presentations || []).find(p => p.studentId === app.currentUser?.uid);

            const topics = ensureSeminarTopics(seminar);
            const locked = isSeminarTopicsLocked(seminar);
            const postTopicOpen = isSeminarPostTopicOpen(seminar);
            const lockedTopic = getLockedTopic(seminar);
            const topicHintDate = settings?.schedule?.topicSubmissionToGuide;

            const scheduleHtml = SEMINAR_SCHEDULE_FIELDS.map(f => {
                const val = settings?.schedule?.[f.key];
                const days = getDaysUntilDeadline(val);
                const urgency = getDeadlineUrgencyClass(days);
                const remaining = formatRemainingDays(days);
                return `
                    <div class="seminar-timeline-step ${urgency}">
                        <span class="seminar-timeline-num">${f.step}</span>
                        <div class="seminar-timeline-body">
                            <span class="seminar-timeline-label">${escapeHtml(f.label)}</span>
                            <strong class="seminar-timeline-date">${val ? escapeHtml(formatSlotDate(val)) : 'TBA'}</strong>
                            <span class="seminar-timeline-remaining">${escapeHtml(remaining)}</span>
                        </div>
                    </div>`;
            }).join('');

            const topicsHtml = topics.length
                ? topics.map((t, idx) => {
                    if ((t.status === 'needs_revision' || t.status === 'rejected') && !locked) {
                        const badgeLabel = t.status === 'rejected' ? 'Rejected — update & resubmit' : 'Needs edit';
                        const badgeClass = t.status === 'rejected' ? 'rejected' : 'needs_revision';
                        return `
                            <div class="seminar-topic-card seminar-topic-status-${escapeHtml(badgeClass)}" data-topic-id="${escapeHtml(t.id)}">
                                <div class="seminar-topic-card-header">
                                    <strong>${idx + 1}. Edit topic</strong>
                                    <span class="badge badge-${escapeHtml(badgeClass)}">${escapeHtml(badgeLabel)}</span>
                                </div>
                                ${t.guideFeedback ? `<p class="seminar-topic-feedback"><i class="fas fa-comment"></i> <strong>Guide:</strong> ${escapeHtml(t.guideFeedback)}</p>` : ''}
                                <div class="seminar-edit-topic-form">
                                    <div class="form-group">
                                        <label><strong>Topic title</strong></label>
                                        <input type="text" class="form-input seminar-edit-title" value="${escapeHtml(t.title)}" data-topic-id="${escapeHtml(t.id)}">
                                    </div>
                                    <div class="form-group">
                                        <label><strong>Description</strong></label>
                                        <textarea class="form-input seminar-edit-description" rows="3" data-topic-id="${escapeHtml(t.id)}">${escapeHtml(t.description || '')}</textarea>
                                    </div>
                                    <button type="button" class="btn btn-primary btn-sm" onclick="app.resubmitSeminarTopic('${escapeHtml(t.id)}')">
                                        <i class="fas fa-paper-plane"></i> Save &amp; resubmit
                                    </button>
                                </div>
                            </div>`;
                    }
                    return `
                    <div class="seminar-topic-card ${lockedTopic?.id === t.id ? 'seminar-topic-locked' : ''} seminar-topic-status-${escapeHtml(t.status)}">
                        <div class="seminar-topic-card-header">
                            <strong>${idx + 1}. ${escapeHtml(t.title)}</strong>
                            <span class="badge">${escapeHtml(this.topicStatusLabel(t, seminar.lockedTopicId))}</span>
                        </div>
                        <p class="seminar-topic-desc">${escapeHtml(t.description || '')}</p>
                        ${t.guideFeedback ? `<p class="form-hint"><strong>Guide:</strong> ${escapeHtml(t.guideFeedback)}</p>` : ''}
                    </div>`;
                }).join('')
                : '<p class="form-hint">No topics submitted yet. Add at least 5 seminar topics with a short description.</p>';

            const presenterParams = settings?.scoringParams?.presenter || [];
            const presScore = pres?.presenterScores ? sumParamScores(pres.presenterScores, presenterParams) : seminar.totals?.presentationMarks || 0;
            const qScore = seminar.totals?.questionMarks || 0;
            const totalScore = presScore + qScore;
            const topicProgressPct = Math.min(100, Math.round((topics.length / MIN_SEMINAR_TOPICS) * 100));

            const addTopicForm = locked
                ? `<p class="form-hint seminar-lock-notice"><i class="fas fa-lock"></i> Topics are locked. Your final topic is <strong>${escapeHtml(lockedTopic?.title || '—')}</strong>. You cannot add more topics.</p>`
                : `
                    <div class="seminar-add-topic-form">
                        <div class="form-group">
                            <label><strong>Topic title</strong></label>
                            <input type="text" id="seminar-topic-title" class="form-input" placeholder="Proposed seminar topic">
                        </div>
                        <div class="form-group">
                            <label><strong>Description</strong></label>
                            <textarea id="seminar-topic-description" class="form-input" rows="3" placeholder="Brief description of the topic"></textarea>
                        </div>
                        <button type="button" class="btn btn-primary" onclick="app.submitSeminarTopic()">
                            <i class="fas fa-plus"></i> Add topic
                        </button>
                    </div>
                `;

            const papers = seminar.papers || [];
            const papersHintDate = settings?.schedule?.referencePapersUpload;
            const papersHtml = papers.length
                ? papers.map((p, idx) => this.renderStudentPaperCard(p, idx)).join('')
                : '<p class="form-hint">No reference papers yet. Add paper / article / resource links for guide review.</p>';

            const addPaperForm = postTopicOpen
                ? `
                    <div class="seminar-add-paper-form">
                        <div class="form-group">
                            <label><strong>Paper / resource title</strong></label>
                            <input type="text" id="seminar-paper-title" class="form-input" placeholder="e.g. Attention Is All You Need">
                        </div>
                        <div class="form-group">
                            <label><strong>Link (URL)</strong></label>
                            <input type="url" id="seminar-paper-url" class="form-input" placeholder="https://...">
                        </div>
                        <div class="form-group">
                            <label><strong>Type</strong></label>
                            <select id="seminar-paper-type" class="form-input">
                                <option value="paper">Research paper</option>
                                <option value="article">Article / blog</option>
                                <option value="docs">Documentation</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                        <button type="button" class="btn btn-primary" onclick="app.submitSeminarPaper()">
                            <i class="fas fa-link"></i> Add reference link
                        </button>
                    </div>
                `
                : `<p class="form-hint seminar-lock-notice"><i class="fas fa-info-circle"></i> Reference paper uploads open after your guide locks a final topic.</p>`;

            const titleAbstract = ensureTitleAbstract(seminar);
            const titleAbstractHintDate = settings?.schedule?.titleAbstractSubmission;
            const titleAbstractHtml = this.renderStudentTitleAbstract(titleAbstract, postTopicOpen, lockedTopic, seminar);

            const ppt = ensureSeminarPpt(seminar);
            const pptHintDate = settings?.schedule?.pptSubmission;
            const pptHtml = this.renderStudentPpt(ppt, postTopicOpen);

            el.innerHTML = `
                <div class="seminar-student-page">
                    <div class="seminar-overview-strip">
                        <div class="seminar-overview-item">
                            <span class="seminar-overview-label"><i class="fas fa-user-tie"></i> Guide</span>
                            <strong>${guideName ? escapeHtml(guideName) : 'Not assigned'}</strong>
                        </div>
                        <div class="seminar-overview-item">
                            <span class="seminar-overview-label"><i class="fas fa-microphone"></i> Presentation</span>
                            <strong>${slot ? escapeHtml(formatPresentationSlot(slot)) : 'Slot not assigned'}</strong>
                            ${pres ? `<span class="badge">${escapeHtml(statusBadge(pres.status))}</span>` : ''}
                        </div>
                        <div class="seminar-overview-item seminar-overview-scores">
                            <span class="seminar-overview-label"><i class="fas fa-star"></i> Scores</span>
                            <div class="seminar-score-pills">
                                <span>Presentation <strong>${presScore}</strong></span>
                                <span>Questions <strong>${qScore}</strong></span>
                                <span class="seminar-score-total">Total <strong>${totalScore}</strong></span>
                            </div>
                        </div>
                    </div>

                    <details class="seminar-schedule-panel" open>
                        <summary>
                            <span><i class="fas fa-calendar-alt"></i> Tentative schedule</span>
                        </summary>
                        <div class="seminar-deadline-legend">
                            <span class="deadline-ok"><i class="fas fa-circle"></i> &gt; 7 days</span>
                            <span class="deadline-week"><i class="fas fa-circle"></i> ≤ 7 days</span>
                            <span class="deadline-soon"><i class="fas fa-circle"></i> ≤ 3 days</span>
                            <span class="deadline-today"><i class="fas fa-circle"></i> Today</span>
                            <span class="deadline-overdue"><i class="fas fa-circle"></i> Overdue</span>
                        </div>
                        <div class="seminar-timeline-grid">${scheduleHtml}</div>
                    </details>

                    <section class="seminar-section seminar-section-primary">
                        <div class="seminar-section-header">
                            <div>
                                <h3><i class="fas fa-lightbulb"></i> Seminar topics</h3>
                                <p class="form-hint">
                                    Submit at least <strong>${MIN_SEMINAR_TOPICS}</strong> topics. You can add more until your guide locks a final topic.
                                    ${topicHintDate ? ` Suggested: <strong>${escapeHtml(formatSlotDate(topicHintDate))}</strong>.` : ''}
                                </p>
                            </div>
                            <div class="seminar-progress-block">
                                <div class="seminar-progress-meta">
                                    <strong>${topics.length}/${MIN_SEMINAR_TOPICS}</strong>
                                    ${topics.length >= MIN_SEMINAR_TOPICS ? '<span class="badge">Minimum met</span>' : '<span class="form-hint">minimum</span>'}
                                    ${locked ? '<span class="badge">Locked</span>' : ''}
                                </div>
                                <div class="seminar-progress-bar" aria-hidden="true">
                                    <div class="seminar-progress-fill" style="width:${topicProgressPct}%"></div>
                                </div>
                            </div>
                        </div>
                        ${lockedTopic ? `
                            <div class="seminar-final-topic-banner">
                                <i class="fas fa-lock"></i>
                                <div>
                                    <strong>Final selected topic</strong>
                                    <p>${escapeHtml(lockedTopic.title)}</p>
                                </div>
                            </div>
                        ` : ''}
                        <div id="seminar-topics-list" class="seminar-topics-list">${topicsHtml}</div>
                        ${addTopicForm}
                    </section>

                    <section class="seminar-section seminar-section-primary" id="seminar-title-abstract-section">
                        <div class="seminar-section-header">
                            <div>
                                <h3><i class="fas fa-align-left"></i> Title &amp; abstract</h3>
                                <p class="form-hint">
                                    Submit the seminar title and abstract for guide approval.
                                    ${titleAbstractHintDate ? ` Suggested: <strong>${escapeHtml(formatSlotDate(titleAbstractHintDate))}</strong>.` : ''}
                                </p>
                            </div>
                            <div class="seminar-progress-meta">
                                <span class="badge badge-${escapeHtml(normalizePaperStatus(titleAbstract.status))}">${escapeHtml(statusBadge(normalizePaperStatus(titleAbstract.status)))}</span>
                            </div>
                        </div>
                        <div id="seminar-title-abstract">${titleAbstractHtml}</div>
                    </section>

                    <section class="seminar-section">
                        <div class="seminar-section-header">
                            <div>
                                <h3><i class="fas fa-book"></i> Reference papers</h3>
                                <p class="form-hint">
                                    Upload links to research papers or resources your guide can verify.
                                    ${papersHintDate ? ` Suggested: <strong>${escapeHtml(formatSlotDate(papersHintDate))}</strong>.` : ''}
                                </p>
                            </div>
                            <div class="seminar-progress-meta">
                                <strong>${papers.length}</strong> link${papers.length === 1 ? '' : 's'}
                            </div>
                        </div>
                        <div id="seminar-papers-list" class="seminar-papers-list">${papersHtml}</div>
                        ${addPaperForm}
                    </section>

                    <section class="seminar-section seminar-section-primary" id="seminar-ppt-section">
                        <div class="seminar-section-header">
                            <div>
                                <h3><i class="fas fa-file-powerpoint"></i> PPT submission</h3>
                                <p class="form-hint">
                                    Upload a link to your presentation (Google Drive, OneDrive, etc.) for guide verification.
                                    ${pptHintDate ? ` Suggested: <strong>${escapeHtml(formatSlotDate(pptHintDate))}</strong>.` : ''}
                                </p>
                            </div>
                            <div class="seminar-progress-meta">
                                <span class="badge badge-${escapeHtml(normalizePaperStatus(ppt.status))}">${escapeHtml(statusBadge(normalizePaperStatus(ppt.status)))}</span>
                            </div>
                        </div>
                        <div id="seminar-ppt">${pptHtml}</div>
                    </section>
                </div>
            `;
        },

        renderStudentPpt(ppt, postTopicOpen) {
            if (!postTopicOpen) {
                return `<p class="form-hint seminar-lock-notice"><i class="fas fa-info-circle"></i> PPT upload opens after your guide locks a final topic.</p>`;
            }

            const status = normalizePaperStatus(ppt.status);

            if (status === 'needs_revision' || status === 'rejected') {
                const badgeLabel = status === 'rejected' ? 'Rejected — update & resubmit' : 'Needs edit';
                const badgeClass = status === 'rejected' ? 'rejected' : 'needs_revision';
                return `
                    <div class="seminar-paper-card seminar-topic-status-${escapeHtml(badgeClass)}">
                        <div class="seminar-topic-card-header">
                            <strong>Update PPT link</strong>
                            <span class="badge badge-${escapeHtml(badgeClass)}">${escapeHtml(badgeLabel)}</span>
                        </div>
                        ${ppt.guideFeedback ? `<p class="seminar-topic-feedback"><i class="fas fa-comment"></i> <strong>Guide:</strong> ${escapeHtml(ppt.guideFeedback)}</p>` : ''}
                        <div class="seminar-edit-ppt-form">
                            <div class="form-group">
                                <label><strong>PPT title (optional)</strong></label>
                                <input type="text" id="seminar-ppt-title" class="form-input" value="${escapeHtml(ppt.title || '')}" placeholder="Presentation title">
                            </div>
                            <div class="form-group">
                                <label><strong>PPT link (URL)</strong></label>
                                <input type="url" id="seminar-ppt-url" class="form-input" value="${escapeHtml(ppt.url || '')}" placeholder="https://...">
                            </div>
                            <button type="button" class="btn btn-primary btn-sm" onclick="app.resubmitSeminarPpt()">
                                <i class="fas fa-paper-plane"></i> Save &amp; resubmit
                            </button>
                        </div>
                    </div>`;
            }

            if (status === 'draft' || !ppt.url?.trim()) {
                return `
                    <div class="seminar-add-paper-form">
                        <div class="form-group">
                            <label><strong>PPT title (optional)</strong></label>
                            <input type="text" id="seminar-ppt-title" class="form-input" placeholder="Presentation title">
                        </div>
                        <div class="form-group">
                            <label><strong>PPT link (URL)</strong></label>
                            <input type="url" id="seminar-ppt-url" class="form-input" placeholder="https://drive.google.com/...">
                        </div>
                        <button type="button" class="btn btn-primary" onclick="app.submitSeminarPpt()">
                            <i class="fas fa-upload"></i> Submit PPT link
                        </button>
                    </div>`;
            }

            return `
                <div class="seminar-paper-card seminar-topic-status-${escapeHtml(status)}">
                    <div class="seminar-topic-card-header">
                        <strong>${escapeHtml(ppt.title || 'Presentation')}</strong>
                        <span class="badge badge-${escapeHtml(status)}">${escapeHtml(statusBadge(status))}</span>
                    </div>
                    <p class="seminar-paper-meta">
                        <a href="${escapeHtml(ppt.url)}" target="_blank" rel="noopener noreferrer">
                            <i class="fas fa-external-link-alt"></i> ${escapeHtml(ppt.url)}
                        </a>
                    </p>
                    ${ppt.guideFeedback ? `<p class="form-hint"><strong>Guide:</strong> ${escapeHtml(ppt.guideFeedback)}</p>` : ''}
                    ${ppt.submittedAt ? `<p class="form-hint">Submitted: ${escapeHtml(new Date(ppt.submittedAt).toLocaleDateString())}</p>` : ''}
                </div>`;
        },

        renderStudentTitleAbstract(ta, postTopicOpen, lockedTopic, seminar) {
            if (!postTopicOpen) {
                return `<p class="form-hint seminar-lock-notice"><i class="fas fa-info-circle"></i> Title and abstract open after your guide locks a final topic.</p>`;
            }

            const status = normalizePaperStatus(ta.status);
            const suggestedTitle = lockedTopic?.title || seminar?.topic?.title || '';

            if (status === 'needs_revision' || status === 'rejected') {
                const badgeLabel = status === 'rejected' ? 'Rejected — update & resubmit' : 'Needs edit';
                const badgeClass = status === 'rejected' ? 'rejected' : 'needs_revision';
                return `
                    <div class="seminar-paper-card seminar-topic-status-${escapeHtml(badgeClass)}">
                        <div class="seminar-topic-card-header">
                            <strong>Update title &amp; abstract</strong>
                            <span class="badge badge-${escapeHtml(badgeClass)}">${escapeHtml(badgeLabel)}</span>
                        </div>
                        ${ta.guideFeedback ? `<p class="seminar-topic-feedback"><i class="fas fa-comment"></i> <strong>Guide:</strong> ${escapeHtml(ta.guideFeedback)}</p>` : ''}
                        <div class="seminar-edit-title-abstract-form">
                            <div class="form-group">
                                <label><strong>Title</strong></label>
                                <input type="text" id="seminar-ta-title" class="form-input" value="${escapeHtml(ta.title || '')}">
                            </div>
                            <div class="form-group">
                                <label><strong>Abstract</strong></label>
                                <textarea id="seminar-ta-abstract" class="form-input" rows="5">${escapeHtml(ta.abstract || '')}</textarea>
                            </div>
                            <button type="button" class="btn btn-primary btn-sm" onclick="app.resubmitSeminarTitleAbstract()">
                                <i class="fas fa-paper-plane"></i> Save &amp; resubmit
                            </button>
                        </div>
                    </div>`;
            }

            if (status === 'draft' || !ta.title?.trim()) {
                return `
                    <div class="seminar-add-paper-form">
                        <div class="form-group">
                            <label><strong>Title</strong></label>
                            <input type="text" id="seminar-ta-title" class="form-input" placeholder="Seminar title"
                                value="${escapeHtml(suggestedTitle)}">
                        </div>
                        <div class="form-group">
                            <label><strong>Abstract</strong></label>
                            <textarea id="seminar-ta-abstract" class="form-input" rows="5" placeholder="Write a short abstract for your seminar"></textarea>
                        </div>
                        <button type="button" class="btn btn-primary" onclick="app.submitSeminarTitleAbstract()">
                            <i class="fas fa-paper-plane"></i> Submit title &amp; abstract
                        </button>
                    </div>`;
            }

            return `
                <div class="seminar-paper-card seminar-topic-status-${escapeHtml(status)}">
                    <div class="seminar-topic-card-header">
                        <strong>${escapeHtml(ta.title)}</strong>
                        <span class="badge badge-${escapeHtml(status)}">${escapeHtml(statusBadge(status))}</span>
                    </div>
                    <p class="seminar-topic-desc">${escapeHtml(ta.abstract || '')}</p>
                    ${ta.guideFeedback ? `<p class="form-hint"><strong>Guide:</strong> ${escapeHtml(ta.guideFeedback)}</p>` : ''}
                    ${ta.submittedAt ? `<p class="form-hint">Submitted: ${escapeHtml(new Date(ta.submittedAt).toLocaleDateString())}</p>` : ''}
                </div>`;
        },

        paperTypeLabel(type) {
            const map = { paper: 'Research paper', article: 'Article', docs: 'Documentation', other: 'Other' };
            return map[type] || 'Resource';
        },

        renderStudentPaperCard(paper, idx) {
            const status = normalizePaperStatus(paper.status);
            const editable = isPaperEditable(status);

            if (editable) {
                const badgeLabel = status === 'rejected'
                    ? 'Rejected — update & resubmit'
                    : status === 'draft'
                        ? 'Draft'
                        : 'Open for upload';
                const badgeClass = status === 'rejected' ? 'rejected' : 'needs_revision';
                return `
                    <div class="seminar-paper-card seminar-topic-status-${escapeHtml(badgeClass)}" data-paper-id="${escapeHtml(paper.id)}">
                        <div class="seminar-topic-card-header">
                            <strong>${idx + 1}. Update reference link</strong>
                            <span class="badge badge-${escapeHtml(badgeClass)}">${escapeHtml(badgeLabel)}</span>
                        </div>
                        ${paper.guideFeedback ? `<p class="seminar-topic-feedback"><i class="fas fa-comment"></i> <strong>Guide:</strong> ${escapeHtml(paper.guideFeedback)}</p>` : ''}
                        <div class="seminar-edit-paper-form">
                            <div class="form-group">
                                <label><strong>Title</strong></label>
                                <input type="text" class="form-input seminar-edit-paper-title" value="${escapeHtml(paper.title || '')}" data-paper-id="${escapeHtml(paper.id)}">
                            </div>
                            <div class="form-group">
                                <label><strong>Link (URL)</strong></label>
                                <input type="url" class="form-input seminar-edit-paper-url" value="${escapeHtml(paper.url || '')}" data-paper-id="${escapeHtml(paper.id)}">
                            </div>
                            <div class="form-group">
                                <label><strong>Type</strong></label>
                                <select class="form-input seminar-edit-paper-type" data-paper-id="${escapeHtml(paper.id)}">
                                    <option value="paper" ${!paper.type || paper.type === 'paper' ? 'selected' : ''}>Research paper</option>
                                    <option value="article" ${paper.type === 'article' ? 'selected' : ''}>Article / blog</option>
                                    <option value="docs" ${paper.type === 'docs' ? 'selected' : ''}>Documentation</option>
                                    <option value="other" ${paper.type === 'other' ? 'selected' : ''}>Other</option>
                                </select>
                            </div>
                            <button type="button" class="btn btn-primary btn-sm" onclick="app.resubmitSeminarPaper('${escapeHtml(paper.id)}')">
                                <i class="fas fa-paper-plane"></i> Save &amp; resubmit
                            </button>
                        </div>
                    </div>`;
            }

            return `
                <div class="seminar-paper-card seminar-topic-status-${escapeHtml(status)}">
                    <div class="seminar-topic-card-header">
                        <strong>${idx + 1}. ${escapeHtml(paper.title || 'Untitled')}</strong>
                        <span class="badge badge-${escapeHtml(status)}">${escapeHtml(statusBadge(status))}</span>
                    </div>
                    <p class="seminar-paper-meta">
                        <span class="seminar-paper-type">${escapeHtml(this.paperTypeLabel(paper.type))}</span>
                        · <a href="${escapeHtml(paper.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(paper.url)}</a>
                    </p>
                    ${paper.guideFeedback ? `<p class="form-hint"><strong>Guide:</strong> ${escapeHtml(paper.guideFeedback)}</p>` : ''}
                </div>`;
        },

        async submitSeminarTopic() {
            const title = document.getElementById('seminar-topic-title')?.value.trim();
            const description = document.getElementById('seminar-topic-description')?.value.trim();
            if (!title) { alert('Enter a topic title.'); return; }
            if (!description) { alert('Enter a short description for the topic.'); return; }

            const data = await app.getUserData();
            if (!data) return;
            const seminar = this.ensureSeminar(data);

            if (isSeminarTopicsLocked(seminar)) {
                alert('Topics are locked by your guide. You cannot add more topics.');
                await this.loadSeminar();
                return;
            }

            ensureSeminarTopics(seminar);
            seminar.topics.push({
                id: `topic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                title,
                description,
                status: 'submitted',
                guideFeedback: '',
                submittedAt: new Date().toISOString(),
                reviewedAt: null
            });

            // Keep legacy field in sync with latest submission for older views
            seminar.topic = {
                title,
                abstract: description,
                status: 'submitted',
                guideFeedback: '',
                submittedAt: new Date().toISOString()
            };

            await app.saveUserData(data);

            const count = seminar.topics.length;
            if (count < MIN_SEMINAR_TOPICS) {
                alert(`Topic added (${count}/${MIN_SEMINAR_TOPICS}). Please submit at least ${MIN_SEMINAR_TOPICS} topics.`);
            } else {
                alert(`Topic added. You have ${count} topics submitted for guide review.`);
            }
            await this.loadSeminar();
        },

        async resubmitSeminarTopic(topicId) {
            const card = document.querySelector(`.seminar-topic-card[data-topic-id="${topicId}"]`);
            const title = (card?.querySelector('.seminar-edit-title')?.value
                || document.querySelector(`.seminar-edit-title[data-topic-id="${topicId}"]`)?.value
                || '').trim();
            const description = (card?.querySelector('.seminar-edit-description')?.value
                || document.querySelector(`.seminar-edit-description[data-topic-id="${topicId}"]`)?.value
                || '').trim();

            if (!title) { alert('Enter a topic title.'); return; }
            if (!description) { alert('Enter a short description.'); return; }

            const data = await app.getUserData();
            if (!data) return;
            const seminar = this.ensureSeminar(data);

            if (isSeminarTopicsLocked(seminar) && seminar.lockedTopicId === topicId) {
                alert('This topic is locked. Contact your guide if you need changes.');
                return;
            }

            ensureSeminarTopics(seminar);
            const topic = seminar.topics.find(t => t.id === topicId);
            if (!topic) { alert('Topic not found.'); return; }
            if (topic.status !== 'needs_revision' && topic.status !== 'rejected') {
                alert('This topic is not open for editing.');
                return;
            }

            topic.title = title;
            topic.description = description;
            topic.status = 'submitted';
            topic.submittedAt = new Date().toISOString();
            topic.reviewedAt = null;

            await app.saveUserData(data);
            alert('Topic updated and resubmitted for guide review.');
            await this.loadSeminar();
        },

        async submitSeminarPaper() {
            const title = document.getElementById('seminar-paper-title')?.value.trim();
            const url = document.getElementById('seminar-paper-url')?.value.trim();
            const type = document.getElementById('seminar-paper-type')?.value || 'paper';
            if (!title) { alert('Enter a paper / resource title.'); return; }
            if (!url) { alert('Enter a link (URL).'); return; }
            try {
                new URL(url);
            } catch (e) {
                alert('Enter a valid URL (include https://).');
                return;
            }

            const data = await app.getUserData();
            if (!data) return;
            const seminar = this.ensureSeminar(data);

            if (!isSeminarPostTopicOpen(seminar)) {
                alert('Reference papers unlock after your guide locks a final topic.');
                await this.loadSeminar();
                return;
            }

            if (!seminar.papers) seminar.papers = [];
            seminar.papers.push({
                id: `paper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                title,
                url,
                type,
                status: 'submitted',
                guideFeedback: '',
                submittedAt: new Date().toISOString(),
                reviewedAt: null
            });
            await app.saveUserData(data);
            alert('Reference link submitted for guide review.');
            await this.loadSeminar();
        },

        async resubmitSeminarPaper(paperId) {
            const card = document.querySelector(`.seminar-paper-card[data-paper-id="${paperId}"]`);
            const title = (card?.querySelector('.seminar-edit-paper-title')?.value
                || document.querySelector(`.seminar-edit-paper-title[data-paper-id="${paperId}"]`)?.value
                || '').trim();
            const url = (card?.querySelector('.seminar-edit-paper-url')?.value
                || document.querySelector(`.seminar-edit-paper-url[data-paper-id="${paperId}"]`)?.value
                || '').trim();
            const type = (card?.querySelector('.seminar-edit-paper-type')?.value
                || document.querySelector(`.seminar-edit-paper-type[data-paper-id="${paperId}"]`)?.value
                || 'paper');

            if (!title) { alert('Enter a title.'); return; }
            if (!url) { alert('Enter a link (URL).'); return; }
            try {
                new URL(url);
            } catch (e) {
                alert('Enter a valid URL (include https://).');
                return;
            }

            const data = await app.getUserData();
            if (!data) return;
            const seminar = this.ensureSeminar(data);
            if (!seminar.papers) seminar.papers = [];
            const paper = seminar.papers.find(p => p.id === paperId);
            if (!paper) { alert('Paper not found.'); return; }
            if (!isPaperEditable(paper.status)) {
                alert('This link is not open for editing. If it was rejected, refresh the page; otherwise ask your guide to open it for a new upload.');
                return;
            }

            paper.title = title;
            paper.url = url;
            paper.type = type;
            paper.status = 'submitted';
            paper.submittedAt = new Date().toISOString();
            paper.reviewedAt = null;

            await app.saveUserData(data);
            alert('Reference link updated and resubmitted for guide review.');
            await this.loadSeminar();
        },

        async submitSeminarTitleAbstract() {
            const title = document.getElementById('seminar-ta-title')?.value.trim();
            const abstract = document.getElementById('seminar-ta-abstract')?.value.trim();
            if (!title) { alert('Enter the seminar title.'); return; }
            if (!abstract) { alert('Enter the abstract.'); return; }

            const data = await app.getUserData();
            if (!data) return;
            const seminar = this.ensureSeminar(data);

            if (!isSeminarPostTopicOpen(seminar)) {
                alert('Title and abstract unlock after your guide locks a final topic.');
                await this.loadSeminar();
                return;
            }

            const ta = ensureTitleAbstract(seminar);
            const status = normalizePaperStatus(ta.status);
            if (status !== 'draft' && hasTitleAbstractSubmission(ta) && !isSeminarSubmissionEditable(status)) {
                alert('Title and abstract already submitted. Ask your guide to open them for edit if you need changes.');
                return;
            }

            ta.title = title;
            ta.abstract = abstract;
            ta.status = 'submitted';
            ta.guideFeedback = '';
            ta.submittedAt = new Date().toISOString();
            ta.reviewedAt = null;

            await app.saveUserData(data);
            alert('Title and abstract submitted for guide review.');
            await this.loadSeminar();
        },

        async resubmitSeminarTitleAbstract() {
            const title = document.getElementById('seminar-ta-title')?.value.trim();
            const abstract = document.getElementById('seminar-ta-abstract')?.value.trim();
            if (!title) { alert('Enter the seminar title.'); return; }
            if (!abstract) { alert('Enter the abstract.'); return; }

            const data = await app.getUserData();
            if (!data) return;
            const seminar = this.ensureSeminar(data);
            const ta = ensureTitleAbstract(seminar);

            const taStatus = normalizePaperStatus(ta.status);
            if (taStatus !== 'needs_revision' && taStatus !== 'rejected') {
                alert('Title and abstract are not open for editing.');
                return;
            }

            ta.title = title;
            ta.abstract = abstract;
            ta.status = 'submitted';
            ta.submittedAt = new Date().toISOString();
            ta.reviewedAt = null;

            await app.saveUserData(data);
            alert('Title and abstract updated and resubmitted for guide review.');
            await this.loadSeminar();
        },

        async submitSeminarPpt() {
            const title = document.getElementById('seminar-ppt-title')?.value.trim() || '';
            const url = document.getElementById('seminar-ppt-url')?.value.trim();
            if (!url) { alert('Enter the PPT link (URL).'); return; }
            try {
                new URL(url);
            } catch (e) {
                alert('Enter a valid URL (include https://).');
                return;
            }

            const data = await app.getUserData();
            if (!data) return;
            const seminar = this.ensureSeminar(data);

            if (!isSeminarPostTopicOpen(seminar)) {
                alert('PPT upload unlocks after your guide locks a final topic.');
                await this.loadSeminar();
                return;
            }

            const ppt = ensureSeminarPpt(seminar);
            const status = normalizePaperStatus(ppt.status);
            if (status !== 'draft' && hasPptSubmission(ppt) && !isSeminarSubmissionEditable(status)) {
                alert('PPT already submitted. Ask your guide to open it for edit if you need to update the link.');
                return;
            }

            ppt.title = title;
            ppt.url = url;
            ppt.status = 'submitted';
            ppt.guideFeedback = '';
            ppt.submittedAt = new Date().toISOString();
            ppt.reviewedAt = null;

            await app.saveUserData(data);
            alert('PPT link submitted for guide review.');
            await this.loadSeminar();
        },

        async resubmitSeminarPpt() {
            const title = document.getElementById('seminar-ppt-title')?.value.trim() || '';
            const url = document.getElementById('seminar-ppt-url')?.value.trim();
            if (!url) { alert('Enter the PPT link (URL).'); return; }
            try {
                new URL(url);
            } catch (e) {
                alert('Enter a valid URL (include https://).');
                return;
            }

            const data = await app.getUserData();
            if (!data) return;
            const seminar = this.ensureSeminar(data);
            const ppt = ensureSeminarPpt(seminar);

            const pptStatus = normalizePaperStatus(ppt.status);
            if (pptStatus !== 'needs_revision' && pptStatus !== 'rejected') {
                alert('PPT is not open for editing.');
                return;
            }

            ppt.title = title;
            ppt.url = url;
            ppt.status = 'submitted';
            ppt.submittedAt = new Date().toISOString();
            ppt.reviewedAt = null;

            await app.saveUserData(data);
            alert('PPT link updated and resubmitted for guide review.');
            await this.loadSeminar();
        },

        async submitSeminarDraftReport() {
            const url = document.getElementById('seminar-draft-url')?.value.trim();
            if (!url) { alert('Enter draft report link.'); return; }
            const data = await app.getUserData();
            if (!data) return;
            const seminar = this.ensureSeminar(data);
            seminar.draftReport = { url, status: 'submitted', guideFeedback: '', submittedAt: new Date().toISOString() };
            await app.saveUserData(data);
            alert('Draft report submitted.');
            await this.loadSeminar();
        },

        async submitSeminarFinalReport() {
            const url = document.getElementById('seminar-final-url')?.value.trim();
            if (!url) { alert('Enter final report link.'); return; }
            const data = await app.getUserData();
            if (!data) return;
            const seminar = this.ensureSeminar(data);
            seminar.finalReport = { url, status: 'submitted', guideFeedback: '', submittedAt: new Date().toISOString() };
            await app.saveUserData(data);
            alert('Final report submitted.');
            await this.loadSeminar();
        }
    };
}
