// Forge Lab — domain catalog and lab session slots

/** @deprecated Legacy weekly presets — kept for old session log labels */
export const FORGE_LAB_SLOTS = [
    { id: 'mon-09-11', day: 'Monday', time: '9:00 AM – 11:00 AM' },
    { id: 'mon-11-13', day: 'Monday', time: '11:00 AM – 1:00 PM' },
    { id: 'mon-14-16', day: 'Monday', time: '2:00 PM – 4:00 PM' },
    { id: 'mon-16-18', day: 'Monday', time: '4:00 PM – 6:00 PM' },
    { id: 'tue-09-11', day: 'Tuesday', time: '9:00 AM – 11:00 AM' },
    { id: 'tue-11-13', day: 'Tuesday', time: '11:00 AM – 1:00 PM' },
    { id: 'tue-14-16', day: 'Tuesday', time: '2:00 PM – 4:00 PM' },
    { id: 'tue-16-18', day: 'Tuesday', time: '4:00 PM – 6:00 PM' },
    { id: 'wed-09-11', day: 'Wednesday', time: '9:00 AM – 11:00 AM' },
    { id: 'wed-11-13', day: 'Wednesday', time: '11:00 AM – 1:00 PM' },
    { id: 'wed-14-16', day: 'Wednesday', time: '2:00 PM – 4:00 PM' },
    { id: 'wed-16-18', day: 'Wednesday', time: '4:00 PM – 6:00 PM' },
    { id: 'thu-09-11', day: 'Thursday', time: '9:00 AM – 11:00 AM' },
    { id: 'thu-11-13', day: 'Thursday', time: '11:00 AM – 1:00 PM' },
    { id: 'thu-14-16', day: 'Thursday', time: '2:00 PM – 4:00 PM' },
    { id: 'thu-16-18', day: 'Thursday', time: '4:00 PM – 6:00 PM' },
    { id: 'fri-09-11', day: 'Friday', time: '9:00 AM – 11:00 AM' },
    { id: 'fri-11-13', day: 'Friday', time: '11:00 AM – 1:00 PM' },
    { id: 'fri-14-16', day: 'Friday', time: '2:00 PM – 4:00 PM' },
    { id: 'fri-16-18', day: 'Friday', time: '4:00 PM – 6:00 PM' },
    { id: 'sat-09-11', day: 'Saturday', time: '9:00 AM – 11:00 AM' },
    { id: 'sat-11-13', day: 'Saturday', time: '11:00 AM – 1:00 PM' },
    { id: 'sat-14-16', day: 'Saturday', time: '2:00 PM – 4:00 PM' }
];

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
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

export function formatCustomSlotLabel(slot) {
    if (!slot) return '';
    if (slot.date && slot.startTime && slot.endTime) {
        return `${formatSlotDate(slot.date)}, ${formatTime12h(slot.startTime)} – ${formatTime12h(slot.endTime)}`;
    }
    if (slot.legacyPreset) {
        return `${slot.legacyPreset.day} ${slot.legacyPreset.time}`;
    }
    const preset = FORGE_LAB_SLOTS.find(s => s.id === slot.id);
    if (preset) return `${preset.day} ${preset.time}`;
    return slot.id || 'Lab slot';
}

function stableSlotId(slot, index) {
    if (typeof slot === 'string') return slot;
    if (slot.id) return String(slot.id);
    if (slot.date && slot.startTime) {
        return `slot_${slot.date}_${slot.startTime.replace(/:/g, '')}`;
    }
    return `slot_${index}`;
}

function normalizeSlotEntry(slot, index) {
    if (typeof slot === 'string') {
        const preset = FORGE_LAB_SLOTS.find(s => s.id === slot);
        return {
            id: slot,
            date: '',
            startTime: '',
            endTime: '',
            legacyPreset: preset || null
        };
    }
    const date = slot.date || '';
    const startTime = (slot.startTime || '').slice(0, 5);
    const endTime = (slot.endTime || '').slice(0, 5);
    return {
        id: stableSlotId(slot, index),
        date,
        startTime,
        endTime
    };
}

export function toSlotList(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'object') return Object.values(raw);
    return [];
}

export function normalizeAssignedSlots(raw) {
    const list = toSlotList(raw);
    if (!list.length) return [];
    return list.map((slot, i) => normalizeSlotEntry(slot, i));
}

export function isLoggableSlot(slot) {
    if (!slot) return false;
    if (slot.date && slot.startTime && slot.endTime) return true;
    if (slot.legacyPreset) return true;
    return !!FORGE_LAB_SLOTS.find(s => s.id === slot.id);
}

export function findAssignedSlot(forge, slotId, commonSlots = undefined) {
    if (!slotId) return null;
    return getAssignedSlots(forge, commonSlots).find(s => s.id === slotId) || null;
}

export function sortSlotsByDateTime(slots) {
    return [...slots].sort((a, b) => {
        const aKey = a.date ? `${a.date}T${a.startTime || '00:00'}` : `z_${a.id}`;
        const bKey = b.date ? `${b.date}T${b.startTime || '00:00'}` : `z_${b.id}`;
        return aKey.localeCompare(bKey);
    });
}

export const FORGE_LAB_DOMAINS = {
    placement: {
        label: 'Placement Preparation',
        icon: 'fa-briefcase',
        description: 'Get interview-ready with structured placement prep',
        subDomains: [
            { id: 'aptitude-quant', label: 'Aptitude — Quantitative Ability' },
            { id: 'aptitude-lr', label: 'Aptitude — Logical Reasoning' },
            { id: 'aptitude-verbal', label: 'Aptitude — Verbal Ability' },
            { id: 'dsa-coding', label: 'DSA & Coding Interviews' },
            { id: 'system-design', label: 'System Design Fundamentals' },
            { id: 'hr-softskills', label: 'HR & Soft Skills' },
            { id: 'resume-portfolio', label: 'Resume, LinkedIn & Portfolio' },
            { id: 'mock-interviews', label: 'Mock Interview Practice' },
            { id: 'company-specific', label: 'Company-Specific Preparation' }
        ]
    },
    technology: {
        label: 'Technology & Programming',
        icon: 'fa-code',
        description: 'Build deep technical skills through hands-on practice',
        subDomains: [
            { id: 'web-frontend', label: 'Web Development — Frontend (HTML/CSS/JS/React)' },
            { id: 'web-backend', label: 'Web Development — Backend (Node/Python/Java)' },
            { id: 'mobile-dev', label: 'Mobile App Development (Android/iOS/Flutter)' },
            { id: 'dsa-advanced', label: 'Data Structures & Algorithms (Advanced)' },
            { id: 'cloud-devops', label: 'Cloud & DevOps (AWS/Azure/Docker/K8s)' },
            { id: 'cybersecurity', label: 'Cybersecurity & Ethical Hacking' },
            { id: 'iot-embedded', label: 'IoT & Embedded Systems' },
            { id: 'ai-ml', label: 'AI / Machine Learning' },
            { id: 'databases', label: 'Databases & SQL/NoSQL' },
            { id: 'opensource', label: 'Open Source Contribution' },
            { id: 'programming-language', label: 'New Programming Language Mastery' }
        ]
    },
    academic: {
        label: 'Academic Excellence',
        icon: 'fa-graduation-cap',
        description: 'Excel in academics and competitive exams',
        subDomains: [
            { id: 'gate-prep', label: 'GATE Preparation' },
            { id: 'higher-studies', label: 'Higher Studies (GRE/TOEFL/IELTS)' },
            { id: 'core-subjects', label: 'Core Subject Mastery (OS, DBMS, CN, etc.)' },
            { id: 'research-papers', label: 'Research & Technical Paper Writing' },
            { id: 'semester-exams', label: 'Semester Exam Preparation' },
            { id: 'lab-projects', label: 'Academic Lab Projects & Reports' }
        ]
    },
    creative: {
        label: 'Creative & Professional Skills',
        icon: 'fa-palette',
        description: 'Develop design, communication, and leadership skills',
        subDomains: [
            { id: 'ui-ux', label: 'UI/UX Design (Figma, Prototyping)' },
            { id: 'technical-writing', label: 'Technical Writing & Documentation' },
            { id: 'communication', label: 'Communication & Presentation Skills' },
            { id: 'entrepreneurship', label: 'Entrepreneurship & Startup Skills' },
            { id: 'video-content', label: 'Video Editing & Content Creation' },
            { id: 'leadership', label: 'Leadership & Team Management' }
        ]
    },
    custom: {
        label: 'Custom Focus Area',
        icon: 'fa-compass',
        description: 'Define your own unique learning path',
        subDomains: [
            { id: 'self-defined', label: 'Custom Goal' }
        ]
    }
};

export function getSlotLabel(slotId, forge = null) {
    if (!slotId) return '';
    if (forge) {
        const slot = getAssignedSlots(forge).find(s => s.id === slotId);
        if (slot) return formatCustomSlotLabel(slot);
    }
    const preset = FORGE_LAB_SLOTS.find(s => s.id === slotId);
    return preset ? `${preset.day} ${preset.time}` : slotId;
}

export function getDomainLabel(categoryId, subDomainId) {
    const category = FORGE_LAB_DOMAINS[categoryId];
    if (!category) return categoryId || 'Unknown';
    const sub = category.subDomains.find(s => s.id === subDomainId);
    return sub ? `${category.label} → ${sub.label}` : category.label;
}

export const FORGE_LAB_COMMITMENT = {
    title: 'The Forge Lab Promise',
    intro: 'By enrolling, you commit to making Forge Lab a serious part of your growth journey:',
    points: [
        'I will attend my admin-assigned lab sessions with focus, discipline, and respect for the space.',
        'I will work consistently toward my learning path, milestones, and overall target outcome.',
        'I will log every session honestly — what I did, what I learned, what blocked me, and what comes next.',
        'I understand Forge Lab is a personal commitment to growth, not just attendance for the record.'
    ]
};

export function getAssignedSlots(forge, commonSlots = undefined) {
    if (commonSlots !== undefined && commonSlots !== null) {
        return sortSlotsByDateTime(normalizeAssignedSlots(commonSlots));
    }
    if (!forge) return [];
    const assigned = toSlotList(forge.assignedSlots);
    const raw = assigned.length ? assigned : toSlotList(forge.preferredSlots);
    return sortSlotsByDateTime(normalizeAssignedSlots(raw));
}

export function getDefaultForgeLab() {
    return {
        enrolled: false,
        enrolledAt: null,
        commitmentAcceptedAt: null,
        domains: [],
        targetOutcome: '',
        skillsToAcquire: [],
        assignedSlots: [],
        slotsAssignedAt: null,
        path: {
            title: '',
            objective: '',
            milestones: [],
            createdAt: null,
            updatedAt: null
        },
        sessionLogs: [],
        updatedAt: null
    };
}

/** Normalize legacy single-domain data into domains array */
export function getForgeLabDomains(forge) {
    if (forge.domains?.length) return forge.domains;
    if (forge.domain?.category) {
        return [{
            id: 'legacy_1',
            category: forge.domain.category,
            subDomain: forge.domain.subDomain || '',
            specificFocus: forge.domain.specificFocus || ''
        }];
    }
    return [];
}
