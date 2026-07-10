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
    formatPresentationSlot,
    formatSlotDate,
    formatRemainingDays,
    getDaysUntilDeadline,
    getDeadlineUrgencyClass,
    statusBadge,
    sumParamScores
} from '../utils/seminarConfig.js';

export function createSeminarModule(app) {
    return {
        ensureSeminar(data) {
            if (!data.seminar) data.seminar = getDefaultSeminar();
            const s = data.seminar;
            ensureSeminarTopics(s);
            if (!s.papers) s.papers = [];
            if (!s.totals) s.totals = { presentationMarks: 0, questionMarks: 0 };
            if (!s.questionHistory) s.questionHistory = [];
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
                    if (t.status === 'needs_revision' && !locked) {
                        return `
                            <div class="seminar-topic-card seminar-topic-status-needs_revision" data-topic-id="${escapeHtml(t.id)}">
                                <div class="seminar-topic-card-header">
                                    <strong>${idx + 1}. Edit topic</strong>
                                    <span class="badge badge-needs_revision">Needs edit</span>
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
                </div>
            `;
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
            if (topic.status !== 'needs_revision') {
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
            if (!title || !url) { alert('Enter title and link.'); return; }

            const data = await app.getUserData();
            if (!data) return;
            const seminar = this.ensureSeminar(data);
            seminar.papers.push({
                id: `paper_${Date.now()}`,
                title, url, type,
                status: 'submitted',
                guideFeedback: '',
                submittedAt: new Date().toISOString()
            });
            await app.saveUserData(data);
            alert('Paper added for guide review.');
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
