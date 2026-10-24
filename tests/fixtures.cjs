'use strict';
// Synthetic registrations for the registration review screens. No real participant data.
const PERMS = ['dashboard_view', 'registrations_view', 'registrations_edit', 'dupr_review', 'issues_manage', 'waitlist_manage', 'reports_view', 'reports_export', 'audit_view'];

const snapshot = {
  me: { email: 'organizer@example.test', roleKey: 'owner', roleName: 'Owner', permissions: PERMS },
  summary: { activeAdmins: 1, roles: 1 },
  permissions: PERMS.map(key => ({ key, name: key, description: key })),
  roles: [{ id: 'r1', key: 'owner', name: 'Owner', description: '', is_system: true, is_protected: true, active: true, permissions: PERMS }],
  users: [{ user_id: 'u1', display_name: 'Organizer', email: 'organizer@example.test', mobile: '', title: '', notes: '', role: { key: 'owner' }, role_id: 'r1', active: true }]
};

const D14 = { id: 'div14', code: 'D14', name: 'DUPR 14', team_rating_cap: 14, player_rating_cap: 3.99, nr_equivalent: 3.5, registration_fee: 7000, is_open: true, team_capacity: 16, reserved: 1, remaining: 15 };
const D16 = { id: 'div16', code: 'D16', name: 'DUPR 16', team_rating_cap: 16, player_rating_cap: 4.49, nr_equivalent: 4, registration_fee: 7000, is_open: true, team_capacity: 4, reserved: 0, remaining: 4 };

/**
 * One member. `rating` is the submitted rating, or 'NR'. `verified` is the verified rating (or true for a verified NR).
 */
function member(slot, gender, rating, verified, extra = {}) {
  const nr = rating === 'NR';
  const isVerified = verified !== undefined && verified !== null && verified !== false;
  return {
    id: 'm' + slot, registration_id: 'reg1', player_id: 'p' + slot, slot, shirt_size: 'M', is_captain: slot === 1, active_entry: true,
    submitted_dupr: nr ? null : Number(rating), is_nr: nr,
    verified_dupr: isVerified && !nr ? Number(verified) : null, locked_dupr: null, dupr_locked_at: null,
    dupr_verification_status: isVerified ? 'verified' : 'pending',
    player: { full_name: 'Player ' + slot, email: `p${slot}@example.test`, mobile: '09170000000', gender, dupr_id: 'TST00' + slot },
    ...extra
  };
}

function registration(members, division = D14, extra = {}) {
  return {
    id: 'reg1', reference: 'AOPL-TEST-1', team_name: 'Synthetic Team', status: 'under_review', payment_status: 'not_requested',
    division_id: division.id, division, players: members, captain: members[0].player, holds_slot: true, source: 'public',
    submitted_at: '2026-01-01T00:00:00Z', eligibility_locked_at: null, metadata: {},
    issues: [], payment_windows: [], payments: [], status_history: [], roster_changes: [],
    team_dupr_submitted: members.reduce((s, m) => s + (m.is_nr ? division.nr_equivalent : m.submitted_dupr), 0),
    ...extra
  };
}

const GENDERS = ['Male', 'Female', 'Male', 'Female'];
function team(ratings, verified, division = D14) {
  return registration(ratings.map((r, i) => member(i + 1, GENDERS[i], r, verified ? verified[i] : undefined)), division);
}

function handlersFor(reg, division = D14, more = {}) {
  return {
    snapshot,
    registrations_snapshot: { registrations: [reg], divisions: [D14, D16], summary: { total: 1, statusCounts: { under_review: 1 } }, event: { id: 'ev' }, warnings: [] },
    ...more
  };
}

module.exports = { snapshot, D14, D16, member, registration, team, handlersFor };
