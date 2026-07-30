// Seminar module — config, defaults, and helpers

export const SEMINAR_SCHEDULE_FIELDS = [
    { key: 'topicSubmissionToGuide', label: 'Topic submission to Guide', step: 1 },
    { key: 'topicApproval', label: 'Approval of topic(s)', step: 2 },
    { key: 'topicLockByGuide', label: 'Lock on topics by Guide', step: 3 },
    { key: 'referencePapersUpload', label: 'Reference papers upload', step: 4 },
    { key: 'titleAbstractSubmission', label: 'Title and abstract submission', step: 5 },
    { key: 'abstractApprovalByGuide', label: 'Approval of abstract by Guide', step: 6 },
    { key: 'pptSubmission', label: 'PPT submission', step: 7 },
    { key: 'pptApprovalByGuide', label: 'PPT approval by Guide', step: 8 },
    { key: 'draftReportSubmission', label: 'Draft report submission', step: 9 },
    { key: 'draftReportVerification', label: 'Draft report verification', step: 10 },
    { key: 'draftReportCommitteeApproval', label: 'Draft report approval by Committee', step: 11 },
    { key: 'finalReportSubmission', label: 'Final report submission', step: 12 }
];

export const DEFAULT_PRESENTER_PARAMS = [
    { id: 'content', label: 'Content organisation & insights', maxMarks: 15, description: 'Logical flow, depth of analysis, key takeaways' },
    { id: 'delivery', label: 'Presentation delivery', maxMarks: 10, description: 'Clarity, pace, confidence, audience engagement' },
    { id: 'visuals', label: 'Slides & visual structure', maxMarks: 10, description: 'Slide design, diagrams, readability' },
    { id: 'time', label: 'Time management', maxMarks: 5, description: 'Within allotted slot, balanced sections' }
];

export const DEFAULT_QUESTIONER_PARAMS = [
    { id: 'relevance', label: 'Relevance to topic', maxMarks: 5, description: 'Question connects to the presentation theme' },
    { id: 'depth', label: 'Depth of understanding', maxMarks: 5, description: 'Shows grasp of concepts, not surface-level' },
    { id: 'clarity', label: 'Clarity of question', maxMarks: 3, description: 'Well-formed, specific, easy to understand' },
    { id: 'engagement', label: 'Engagement & originality', maxMarks: 2, description: 'Thought-provoking, builds discussion' }
];

export function getDefaultSeminarSettings() {
    return {
        enabled: true,
        schedule: Object.fromEntries(SEMINAR_SCHEDULE_FIELDS.map(f => [f.key, ''])),
        scoringParams: {
            presenter: DEFAULT_PRESENTER_PARAMS.map(p => ({ ...p })),
            questioner: DEFAULT_QUESTIONER_PARAMS.map(p => ({ ...p }))
        },
        presentationSlots: [],
        guideAssignments: {},
        presentationAssignments: {},
        presentations: [],
        questionSettings: {
            questionsPerPresentation: 3
        },
        questionFairness: {},
        guideAllottedAt: null,
        presentationAllottedAt: null,
        updatedAt: null
    };
}

export const MIN_SEMINAR_TOPICS = 5;

export function getDefaultSeminar() {
    return {
        guideId: null,
        topics: [],
        lockedTopicId: null,
        topicsLockedAt: null,
        // Stays true after first final-topic lock so papers/title/PPT remain open if guide unlocks topics for edit
        postTopicWorkflowOpen: false,
        // Legacy single-topic field kept for older data; prefer topics[]
        topic: {
            title: '',
            abstract: '',
            status: 'draft',
            guideFeedback: '',
            submittedAt: null
        },
        papers: [],
        titleAbstract: {
            title: '',
            abstract: '',
            status: 'draft',
            guideFeedback: '',
            submittedAt: null,
            reviewedAt: null
        },
        ppt: {
            url: '',
            title: '',
            status: 'draft',
            guideFeedback: '',
            submittedAt: null,
            reviewedAt: null
        },
        draftReport: { url: '', status: 'draft', guideFeedback: '', submittedAt: null },
        finalReport: { url: '', status: 'draft', guideFeedback: '', submittedAt: null },
        presentationSlotId: null,
        totals: { presentationMarks: 0, questionMarks: 0 },
        questionHistory: []
    };
}

/** Normalize topics array; migrate legacy single topic if needed. */
export function ensureSeminarTopics(seminar) {
    if (!seminar.topics) seminar.topics = [];
    if (seminar.lockedTopicId === undefined) seminar.lockedTopicId = null;
    if (seminar.topicsLockedAt === undefined) seminar.topicsLockedAt = null;
    if (seminar.postTopicWorkflowOpen === undefined) seminar.postTopicWorkflowOpen = false;

    if (!seminar.topics.length && seminar.topic?.title) {
        const legacyStatus = seminar.topic.status;
        let status = 'submitted';
        if (legacyStatus === 'guide_approved' || legacyStatus === 'final_approved') status = 'approved';
        else if (legacyStatus === 'guide_rejected' || legacyStatus === 'final_rejected') status = 'rejected';
        else if (legacyStatus === 'submitted') status = 'submitted';

        seminar.topics.push({
            id: `topic_migrated_${Date.now()}`,
            title: seminar.topic.title,
            description: seminar.topic.abstract || '',
            status,
            guideFeedback: seminar.topic.guideFeedback || '',
            submittedAt: seminar.topic.submittedAt || null,
            reviewedAt: null
        });
    }
    return seminar.topics;
}

export function getLockedTopic(seminar) {
    if (!seminar?.lockedTopicId) return null;
    const topics = seminar.topics || [];
    return topics.find(t => t.id === seminar.lockedTopicId) || null;
}

export function getSeminarDisplayTopic(seminar) {
    const locked = getLockedTopic(seminar);
    if (locked) return locked;
    const topics = seminar?.topics || [];
    if (topics.length) return topics[0];
    if (seminar?.topic?.title) {
        return {
            id: null,
            title: seminar.topic.title,
            description: seminar.topic.abstract || '',
            status: seminar.topic.status || 'draft',
            guideFeedback: seminar.topic.guideFeedback || ''
        };
    }
    return null;
}

export function isSeminarTopicsLocked(seminar) {
    return Boolean(seminar?.lockedTopicId);
}

/**
 * Papers / title-abstract / PPT open after the first final-topic lock.
 * Remains open if the guide later unlocks topics for editing.
 */
export function isSeminarPostTopicOpen(seminar) {
    if (!seminar) return false;
    if (seminar.lockedTopicId || seminar.postTopicWorkflowOpen) return true;
    // Backfill: students unlocked before postTopicWorkflowOpen existed
    if ((seminar.papers || []).length > 0) return true;
    if (hasTitleAbstractSubmission(seminar.titleAbstract)) return true;
    if (hasPptSubmission(seminar.ppt)) return true;
    return false;
}

export function formatTime12h(time24) {
    if (!time24) return '';
    const [h, m] = time24.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return time24;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatSlotDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T12:00:00`);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
}

/** Days until deadline (0 = today). Negative = overdue. Null if no date. */
export function getDaysUntilDeadline(dateStr) {
    if (!dateStr) return null;
    const target = new Date(`${dateStr}T12:00:00`);
    if (isNaN(target.getTime())) return null;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    target.setHours(12, 0, 0, 0);
    return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

export function formatRemainingDays(days) {
    if (days === null || days === undefined) return 'Date TBA';
    if (days === 0) return 'Due today';
    if (days === 1) return '1 day left';
    if (days > 1) return `${days} days left`;
    if (days === -1) return '1 day overdue';
    return `${Math.abs(days)} days overdue`;
}

/** Urgency class for deadline colour coding */
export function getDeadlineUrgencyClass(days) {
    if (days === null || days === undefined) return 'deadline-tba';
    if (days < 0) return 'deadline-overdue';
    if (days === 0) return 'deadline-today';
    if (days <= 3) return 'deadline-soon';
    if (days <= 7) return 'deadline-week';
    return 'deadline-ok';
}

export function formatPresentationSlot(slot) {
    if (!slot) return '';
    if (slot.date && slot.startTime && slot.endTime) {
        return `${formatSlotDate(slot.date)}, ${formatTime12h(slot.startTime)} – ${formatTime12h(slot.endTime)}`;
    }
    return slot.label || slot.id || 'Slot';
}

export function statusBadge(status) {
    const map = {
        draft: 'Draft',
        submitted: 'Submitted',
        approved: 'Approved',
        rejected: 'Rejected',
        needs_revision: 'Needs edit',
        locked: 'Locked (final)',
        guide_approved: 'Approved',
        guide_rejected: 'Rejected',
        final_approved: 'Final approved',
        final_rejected: 'Rejected',
        scheduled: 'Scheduled',
        completed: 'Completed'
    };
    return map[status] || status || '—';
}

/** Normalize paper status (maps legacy guide_* values). */
export function normalizePaperStatus(status) {
    if (status === 'guide_approved') return 'approved';
    if (status === 'guide_rejected') return 'rejected';
    return status || 'submitted';
}

export function isPaperEditable(status) {
    return isSeminarSubmissionEditable(status);
}

/** Student may update & resubmit after reject or when guide opens for edit. */
export function isSeminarSubmissionEditable(status) {
    const s = normalizePaperStatus(status);
    return s === 'needs_revision' || s === 'rejected' || s === 'draft';
}

export function isPaperPendingReview(status) {
    const s = normalizePaperStatus(status);
    return s === 'submitted';
}

export function getDefaultTitleAbstract() {
    return {
        title: '',
        abstract: '',
        status: 'draft',
        guideFeedback: '',
        submittedAt: null,
        reviewedAt: null
    };
}

/** Ensure titleAbstract object exists on seminar. */
export function ensureTitleAbstract(seminar) {
    if (!seminar.titleAbstract || typeof seminar.titleAbstract !== 'object') {
        seminar.titleAbstract = getDefaultTitleAbstract();
    } else {
        const d = getDefaultTitleAbstract();
        seminar.titleAbstract = { ...d, ...seminar.titleAbstract };
    }
    return seminar.titleAbstract;
}

export function hasTitleAbstractSubmission(ta) {
    return Boolean(ta?.title?.trim() && ta?.abstract?.trim() && normalizePaperStatus(ta.status) !== 'draft');
}

export function getDefaultPpt() {
    return {
        url: '',
        title: '',
        status: 'draft',
        guideFeedback: '',
        submittedAt: null,
        reviewedAt: null
    };
}

/** Ensure ppt object exists on seminar. */
export function ensureSeminarPpt(seminar) {
    if (!seminar.ppt || typeof seminar.ppt !== 'object') {
        seminar.ppt = getDefaultPpt();
    } else {
        const d = getDefaultPpt();
        seminar.ppt = { ...d, ...seminar.ppt };
    }
    return seminar.ppt;
}

export function hasPptSubmission(ppt) {
    return Boolean(ppt?.url?.trim() && normalizePaperStatus(ppt.status) !== 'draft');
}

export function sumParamScores(scores, params) {
    if (!scores || !params) return 0;
    return params.reduce((s, p) => s + (parseFloat(scores[p.id]) || 0), 0);
}

/** Fair questioner pick: prefer students asked fewer times, then longest gap */
export function pickFairQuestioners(eligibleIds, fairness, presentationIndex, count) {
    const pool = [...eligibleIds];
    const picked = [];
    while (picked.length < count && pool.length > 0) {
        pool.sort((a, b) => {
            const fa = fairness[a] || { times: 0, lastIndex: -999 };
            const fb = fairness[b] || { times: 0, lastIndex: -999 };
            if (fa.times !== fb.times) return fa.times - fb.times;
            return fa.lastIndex - fb.lastIndex;
        });
        const tier = pool.filter(id => {
            const f = fairness[id] || { times: 0, lastIndex: -999 };
            const top = fairness[pool[0]] || { times: 0, lastIndex: -999 };
            return f.times === top.times && f.lastIndex === top.lastIndex;
        });
        const choice = tier[Math.floor(Math.random() * tier.length)];
        picked.push(choice);
        pool.splice(pool.indexOf(choice), 1);
    }
    return picked;
}

export function updateFairnessAfterPick(fairness, studentIds, presentationIndex) {
    const next = { ...fairness };
    studentIds.forEach(id => {
        const prev = next[id] || { times: 0, lastIndex: -999 };
        next[id] = { times: prev.times + 1, lastIndex: presentationIndex };
    });
    return next;
}

/** Assign students to guides with equal load (difference of at most 1 per guide). */
export function equallyAllotGuidesToStudents(students, guides) {
    if (!students.length || !guides.length) {
        return { guideAssignments: {}, loadByGuide: {} };
    }

    const shuffledStudents = [...students].sort(() => Math.random() - 0.5);
    const loadByGuide = Object.fromEntries(guides.map(g => [g.id, 0]));
    const guideAssignments = {};

    for (const student of shuffledStudents) {
        const minLoad = Math.min(...guides.map(g => loadByGuide[g.id]));
        const leastLoaded = guides.filter(g => loadByGuide[g.id] === minLoad);
        const guide = leastLoaded[Math.floor(Math.random() * leastLoaded.length)];
        guideAssignments[student.id] = guide.id;
        loadByGuide[guide.id]++;
    }

    return { guideAssignments, loadByGuide };
}

export function buildSeminarGuideAllotmentGroups(students, guides, guideAssignments) {
    const groups = guides.map(g => ({
        guideId: g.id,
        guideName: g.name || g.email || 'Guide',
        guideEmail: g.email || '',
        students: []
    }));
    const groupMap = Object.fromEntries(groups.map(g => [g.guideId, g]));

    for (const student of students) {
        const guideId = guideAssignments[student.id] || student.seminar?.guideId;
        if (guideId && groupMap[guideId]) {
            groupMap[guideId].students.push(student);
        }
    }

    groups.sort((a, b) => a.guideName.localeCompare(b.guideName));
    groups.forEach(g => g.students.sort((a, b) => a.name.localeCompare(b.name)));
    return groups;
}

/**
 * Create one date-free presentation slot and assign up to `studentsPerSlot`
 * students from the provided (typically unassigned) list.
 */
export function appendPresentationSlot(unassignedStudents, studentsPerSlot, existingSlots = []) {
    const capacity = Math.max(1, parseInt(studentsPerSlot, 10) || 1);
    const available = [...(unassignedStudents || [])];
    if (!available.length) {
        return { slot: null, assignedStudents: [], capacity };
    }

    const takeCount = Math.min(capacity, available.length);
    const shuffled = available.sort(() => Math.random() - 0.5);
    const assignedStudents = shuffled.slice(0, takeCount);
    const nextNumber = (existingSlots?.length || 0) + 1;
    const slot = {
        id: `pslot_${Date.now()}_${nextNumber}`,
        label: `Slot ${nextNumber}`,
        capacity: takeCount,
        date: '',
        startTime: '',
        endTime: ''
    };

    return { slot, assignedStudents, capacity };
}

/** Group students by presentation slot for summary / reports. */
export function buildPresentationSlotGroups(students, slots, presentationAssignments) {
    const groups = (slots || []).map((slot, idx) => ({
        slotId: slot.id,
        slotLabel: slot.label || `Slot ${idx + 1}`,
        capacity: slot.capacity || null,
        students: []
    }));
    const groupMap = Object.fromEntries(groups.map(g => [g.slotId, g]));

    for (const student of students) {
        const slotId = presentationAssignments?.[student.id]
            || student.seminar?.presentationSlotId;
        if (slotId && groupMap[slotId]) {
            groupMap[slotId].students.push(student);
        }
    }

    groups.forEach(g => g.students.sort((a, b) => a.name.localeCompare(b.name)));
    return groups;
}
