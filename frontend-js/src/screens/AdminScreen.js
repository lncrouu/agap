import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import ActionDialog from '../components/ActionDialog';
import { formatTicketReference } from '../utils/ticketNumber';
import { getEffectiveVerificationStatus, getModerationRestriction } from '../utils/moderation';

// Hoisted Helper Functions (TDZ Safe & Production Ready)
function parsePhotos(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === 'string') return item;
      if (item && item.base64) return item.base64;
      if (item && item.url) return item.url;
      return null;
    }).filter(Boolean);
  }
  if (typeof raw === 'object') {
    if (raw.base64) return [raw.base64];
    if (raw.url) return [raw.url];
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => {
            if (typeof item === 'string') return item;
            if (item && item.base64) return item.base64;
            if (item && item.url) return item.url;
            return null;
          }).filter(Boolean);
        }
      } catch (e) {}
    }
    return [trimmed];
  }
  return [];
}

function getMemoEvidencePhotos(report) {
  return [
    ...parsePhotos(report?.proof_photos || report?.photos),
    ...(report?.response_photo ? [report.response_photo] : [])
  ];
}

function getSubmitterInfo(reportObj, profiles = []) {
  if (!reportObj) return { username: 'Device User', deviceId: 'N/A', status: 'GUEST', profile: null, phone: null };
  const matchedProfile = profiles.find((p) => p.device_id && p.device_id === reportObj.device_id);
  if (matchedProfile) {
    return {
      username: matchedProfile.username || `Device ID: ${matchedProfile.device_id}`,
      deviceId: matchedProfile.device_id,
      status: matchedProfile.verification_status || 'GUEST',
      phone: matchedProfile.phone_number || matchedProfile.phone || null,
      profile: matchedProfile
    };
  }
  return {
    username: `Device ID: ${reportObj.device_id || 'DEV-UNKNOWN'}`,
    deviceId: reportObj.device_id || 'DEV-UNKNOWN',
    status: 'GUEST',
    phone: null,
    profile: { device_id: reportObj.device_id || 'DEV-UNKNOWN', verification_status: 'GUEST', phone_number: null }
  };
}

function getUserSubmissions(userObj, reports = []) {
  if (!userObj) return [];
  return reports.filter((r) => 
    (userObj.device_id && r.device_id === userObj.device_id) ||
    (userObj.username && (r.sender_name === userObj.username || r.username === userObj.username))
  );
}

function getAdminCategory(report) {
  const category = (report?.category || '').trim();
  const hazardType = (report?.hazard_type || '').trim();
  if (!category || ['OTHER', 'UNCATEGORIZED'].includes(category.toUpperCase())) return '';
  return category.toLowerCase() === hazardType.toLowerCase() ? '' : category;
}

// SMS Notification Dispatcher Utility
function dispatchSmsNotification(profile, messageText) {
  if (!profile) {
    return { sent: false, reason: 'GUEST_DEVICE', notice: 'In-app update sent to guest device.' };
  }
  const status = (profile.verification_status || '').toUpperCase();
  if (status === 'VERIFIED') {
    const phone = profile.phone_number || 'Registered Mobile';
    return {
      sent: true,
      reason: 'VERIFIED_CITIZEN',
      notice: `SMS Alert Dispatched to Verified Citizen (${phone})`
    };
  }
  return {
    sent: false,
    reason: 'UNVERIFIED_GUEST',
    notice: 'In-app update sent to resident device tracker.'
  };
}

export default function AdminScreen({ onBack }) {
  const [currentView, setCurrentView] = useState('DASHBOARD'); 
  const [submittedSubTab, setSubmittedSubTab] = useState('QUEUE'); 
  const [activeSubTab, setActiveSubTab] = useState('TRACKER'); 
  const [userSubTab, setUserSubTab] = useState('VERIFIED'); 
  const [memoSubTab, setMemoSubTab] = useState('PART1'); 
  const [resolvedSubTab, setResolvedSubTab] = useState('ALL'); 

  // Collapsible Filter States
  const [showSubmittedFilter, setShowSubmittedFilter] = useState(false);

  // Accordion Expand States
  const [expandedTicketId, setExpandedTicketId] = useState(null);
  const [expandedArchiveTicketId, setExpandedArchiveTicketId] = useState(null);
  const [expandedUserReportId, setExpandedUserReportId] = useState(null);
  const [expandedGroupId, setExpandedGroupId] = useState(null);
  const [resolvingTicketId, setResolvingTicketId] = useState(null);
  const [dispatchingReportId, setDispatchingReportId] = useState(null);

  // Database Data States
  const [reports, setReports] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [inspectImage, setInspectImage] = useState(null);
  const [moderationTarget, setModerationTarget] = useState(null);
  const [moderationAction, setModerationAction] = useState('PENALIZED');
  const [moderationMessage, setModerationMessage] = useState('');
  const [penaltyDays, setPenaltyDays] = useState('');
  const [isUpdatingModeration, setIsUpdatingModeration] = useState(false);

  // Active Operations & Categorization States
  const [tagInputMap, setTagInputMap] = useState({});
  const [selectedBulkCategory, setSelectedBulkCategory] = useState('');
  const [bulkStatus, setBulkStatus] = useState('IN_PROGRESS');
  const [bulkNotice, setBulkNotice] = useState('');
  const [bulkPhoto, setBulkPhoto] = useState(null);

  // Single Dispatch & Transmittal Memo Selection
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [selectedResponderTeam, setSelectedResponderTeam] = useState('CDRRMO Rescue Alpha Team');
  const [selectedMemoReport, setSelectedMemoReport] = useState(null);
  const [selectedMemoCategoryGroup, setSelectedMemoCategoryGroup] = useState(null);

  // Severity Filters
  const [submittedSeverityFilter, setSubmittedSeverityFilter] = useState('ALL');

  // Analytics & Date Range States
  const [customStartDate, setCustomStartDate] = useState('2026-10-24');
  const [customEndDate, setCustomEndDate] = useState('2026-10-31');

  // SMS Notification Audit Log State
  const [smsLogs, setSmsLogs] = useState([]);
  const [dialog, setDialog] = useState(null);
  const dialogResolverRef = useRef(null);

  const showMessage = (message, tone = 'info', title) => {
    dialogResolverRef.current = null;
    setDialog({ type: 'message', message, tone, title });
  };

  const confirmAction = (message) => new Promise((resolve) => {
    dialogResolverRef.current = resolve;
    setDialog({ type: 'confirm', message, tone: 'warning', title: 'Please confirm' });
  });

  const closeDialog = (confirmed = false) => {
    const resolveConfirmation = dialogResolverRef.current;
    dialogResolverRef.current = null;
    setDialog(null);
    if (resolveConfirmation) resolveConfirmation(confirmed);
  };

  const responderTeams = [
    { id: 'CDRRMO_ALPHA', name: 'CDRRMO Rescue Alpha Team', category: 'Medical & Disaster Rescue' },
    { id: 'BFP_FIRE_UNIT1', name: 'BFP Fire Station Unit 1', category: 'Fire & Explosion Hazards' },
    { id: 'PNP_PATROL3', name: 'Batangas PNP Patrol Unit 3', category: 'Crime & Security Interventions' },
    { id: 'RED_CROSS_AMB', name: 'Philippine Red Cross Ambulance', category: 'Medical Transport & First Aid' }
  ];

  useEffect(() => {
    fetchAdminData();
    const subscription = supabase
      .channel('admin_reports_and_profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => {
        fetchAdminData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        fetchAdminData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  const fetchAdminData = async () => {
    setIsLoading(true);
    try {
      const { data: repData, error: repErr } = await supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false });

      if (repErr) throw repErr;

      const { data: profData, error: profErr } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profErr) throw profErr;

      if (repData) setReports(repData);
      if (profData) setProfiles(profData);
    } catch (err) {
      console.error('Error fetching admin data:', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // 1. Single Report Operational Progress Update Handler
  const handleUpdateReportStatus = async (reportId, newStatus, extraPayload = {}) => {
    const actionLabels = {
      APPROVED: 'accept',
      REJECTED: 'reject',
      IN_PROGRESS: 'mark as in progress',
      RESOLVED: 'mark as resolved'
    };
    const currentReport = reports.find((report) => report.id === reportId);
    const currentStatus = (currentReport?.status || '').trim().toUpperCase();
    if (newStatus === 'IN_PROGRESS' && !['APPROVED', 'DISPATCHED'].includes(currentStatus)) {
      return showMessage('Accept the investigated ticket before marking it In Progress.', 'error');
    }
    if (newStatus === 'APPROVED' && currentStatus !== 'FIELD_CONFIRMED') {
      return showMessage('Only a responder-confirmed ticket can be accepted into Active Operations.', 'error');
    }
    if (newStatus === 'APPROVED' && !currentReport?.response_photo) {
      return showMessage('Responder site-verification photo evidence is required before accepting this ticket.', 'error');
    }
    if (newStatus === 'RESOLVED') {
      if (currentStatus !== 'IN_PROGRESS') {
        return showMessage('Mark this ticket In Progress before resolving it.', 'error');
      }
      if (!extraPayload.progress_photo) {
        return showMessage('A resolution proof photo is required before resolving this ticket.', 'error');
      }
    }
    const actionLabel = actionLabels[newStatus];
    if (actionLabel && !(await confirmAction(`Confirm ${actionLabel} for ticket ${formatTicketReference(reportId)}?`))) return;

    try {
      const payload = { status: newStatus, ...extraPayload };
      const { data: updatedReports, error } = await supabase
        .from('reports')
        .update(payload)
        .eq('id', reportId)
        .select('id, status');

      if (error) throw error;
      if (!updatedReports || updatedReports.length === 0) {
        throw new Error('The ticket was not updated. Refresh the page and check your admin permissions.');
      }

      setReports((prev) => prev.map((report) => (
        report.id === reportId ? { ...report, ...payload } : report
      )));

      const targetRep = reports.find((r) => r.id === reportId);
      const submitterProf = profiles.find((p) => p.device_id && p.device_id === targetRep?.device_id);
      
      const smsResult = dispatchSmsNotification(
        submitterProf,
        "Progress Update for Report " + formatTicketReference(reportId) + ": Status changed to " + newStatus + "."
      );

      setSmsLogs((prev) => [
        {
          id: Date.now(),
          timestamp: new Date().toLocaleTimeString(),
          text: "[Report " + formatTicketReference(reportId) + "] " + smsResult.notice,
          type: smsResult.sent ? 'SUCCESS' : 'SKIPPED'
        },
        ...prev
      ]);

      showMessage(`Report update saved.\nTicket ${formatTicketReference(reportId)} status: ${newStatus.replace(/_/g, ' ')}\n\n${smsResult.notice}`, 'success');

      if (selectedReport && selectedReport.id === reportId) {
        setSelectedReport({ ...selectedReport, ...payload });
      }
      if (newStatus === 'RESOLVED') {
        setResolvingTicketId(null);
      }
      fetchAdminData();
    } catch (err) {
      showMessage("Update failed: " + err.message, 'error');
    }
  };

  // 2. Responder Assignment & Dispatch Handler
  const handleAssignResponder = async (reportId) => {
    if (!selectedResponderTeam) return showMessage('Please select a response team.', 'error');
    if (!dispatchNotes.trim()) return showMessage('Please enter dispatch instructions for the response team.', 'error');
    if (!(await confirmAction(`Confirm dispatch of ticket ${formatTicketReference(reportId)} to ${selectedResponderTeam}?`))) return;
    try {
      const payload = {
        status: 'FIELD_DISPATCHED',
        assigned_responder: selectedResponderTeam,
        dispatch_notes: dispatchNotes.trim()
      };
      const { data: updatedReports, error } = await supabase
        .from('reports')
        .update(payload)
        .eq('id', reportId)
        .select('id');

      if (error) throw error;
      if (!updatedReports || updatedReports.length === 0) {
        throw new Error('The ticket was not dispatched. Refresh the page and check your admin permissions.');
      }

      const targetRep = reports.find((r) => r.id === reportId);
      const submitterProf = profiles.find((p) => p.device_id && p.device_id === targetRep?.device_id);

      const smsResult = dispatchSmsNotification(
        submitterProf,
        "DISPATCH ALERT: Response unit " + selectedResponderTeam + " deployed for Report " + formatTicketReference(reportId) + "."
      );

      setSmsLogs((prev) => [
        {
          id: Date.now(),
          timestamp: new Date().toLocaleTimeString(),
          text: "[Report " + formatTicketReference(reportId) + " Dispatch] " + smsResult.notice,
          type: smsResult.sent ? 'SUCCESS' : 'SKIPPED'
        },
        ...prev
      ]);

      showMessage(`Responder team assigned.\nUnit ${selectedResponderTeam} assigned to ticket ${formatTicketReference(reportId)}.\n\n${smsResult.notice}`, 'success');

      if (selectedReport && selectedReport.id === reportId) {
        setSelectedReport({ ...selectedReport, ...payload });
      }
      setDispatchNotes('');
      setDispatchingReportId(null);
      setSubmittedSubTab('INVESTIGATED');
      fetchAdminData();
    } catch (err) {
      showMessage("Assignment failed: " + err.message, 'error');
    }
  };

  const handleStartInvestigation = async (reportId) => {
    if (!(await confirmAction(`Start field investigation for ticket ${formatTicketReference(reportId)}? Choose the team and enter its dispatch message below.`))) return;
    setExpandedTicketId(reportId);
    setDispatchingReportId(reportId);
    setDispatchNotes('');
  };

  // 3. Category Tagging Handler
  const handleCategorizeReport = async (reportId, categoryName) => {
    if (typeof categoryName !== 'string') return showMessage('Enter a category name or clear the field to keep this ticket individual.', 'error');
    const category = categoryName.trim();
    const confirmation = category
      ? `Save "${category}" as the category for ticket ${formatTicketReference(reportId)}?`
      : `Keep ticket ${formatTicketReference(reportId)} as an individual ticket with no category?`;
    if (!(await confirmAction(confirmation))) return;

    try {
      const { error } = await supabase
        .from('reports')
        .update({ category })
        .eq('id', reportId);

      if (error) throw error;

      showMessage(category
        ? 'Category tag saved: "' + category + '" for Report ' + formatTicketReference(reportId)
        : 'Category cleared. Ticket ' + formatTicketReference(reportId) + ' will be treated as an individual ticket.', 'success');
      setTagInputMap({ ...tagInputMap, [reportId]: '' });
      fetchAdminData();
    } catch (err) {
      showMessage("Tagging failed: " + err.message, 'error');
    }
  };

  // 4. Automated Directive Generator
  const generateAutomatedDirectiveNotice = (catName, status, count) => {
    const matching = activeTrackerReports.filter(
      (r) => getAdminCategory(r).toUpperCase() === (catName || '').trim().toUpperCase()
    );
    let highestSev = 'HIGH';
    if (matching.some(r => (r.severity || '').toUpperCase() === 'CRITICAL')) highestSev = 'CRITICAL';
    else if (matching.some(r => (r.severity || '').toUpperCase() === 'HIGH')) highestSev = 'HIGH';
    else if (matching.some(r => (r.severity || '').toUpperCase() === 'MEDIUM')) highestSev = 'MEDIUM';
    else if (matching.some(r => (r.severity || '').toUpperCase() === 'LOW')) highestSev = 'LOW';

    const locCount = count || matching.length || 1;
    const catUpper = (catName || 'HAZARD INCIDENT').toUpperCase();

    if (status === 'IN_PROGRESS') {
      return "[" + catUpper + " - " + highestSev + " SEVERITY]: The report has been received and is being followed up by the responsible government office. (" + locCount + " related report(s)).";
    } else if (status === 'RESOLVED') {
      return "[" + catUpper + " - " + highestSev + " SEVERITY]: The reported issue has been marked resolved. (" + locCount + " related report(s)).";
    }
    return "[" + catUpper + " - " + highestSev + " SEVERITY]: The report has been received and is being followed up by the responsible government office. (" + locCount + " related report(s)).";
  };

  useEffect(() => {
    if (selectedBulkCategory && bulkStatus) {
      const matchingCount = activeTrackerReports.filter(
        (r) => getAdminCategory(r).toUpperCase() === selectedBulkCategory.trim().toUpperCase()
      ).length;
      const autoText = generateAutomatedDirectiveNotice(selectedBulkCategory, bulkStatus, matchingCount);
      setBulkNotice(autoText);
    }
  }, [selectedBulkCategory, bulkStatus]);

  // 5. Category Bulk Operations Handler
  const handleBulkBroadcast = async () => {
    if (!selectedBulkCategory) return showMessage('Please select an active category group.', 'error');

    if (bulkStatus === 'RESOLVED' && !bulkPhoto) {
      return showMessage('Mandatory completion photo proof required.\nPlease attach an on-site completion photo before marking this category group as resolved.', 'error');
    }

    const matching = activeTrackerReports.filter(
      (r) => getAdminCategory(r).toUpperCase() === selectedBulkCategory.trim().toUpperCase()
    );

    if (matching.length === 0) return showMessage('No active reports found in the selected category.', 'error');
    if (bulkStatus === 'RESOLVED' && matching.some((report) => (report.status || '').toUpperCase() !== 'IN_PROGRESS')) {
      return showMessage('Move every ticket in this category to In Progress before resolving the group.', 'error');
    }
    if (!(await confirmAction(
      `Confirm ${bulkStatus === 'RESOLVED' ? 'marking as resolved' : 'updating progress and sending the message'} for ${matching.length} ticket(s) in "${selectedBulkCategory}"?`
    ))) return;

    try {
      const updatePayload = {
        status: bulkStatus,
        notice_text: bulkNotice || ''
      };

      if (bulkPhoto) {
        updatePayload.progress_photo = bulkPhoto;
      }

      const ids = matching.map((r) => r.id);
      const { error } = await supabase
        .from('reports')
        .update(updatePayload)
        .in('id', ids);

      if (error) throw error;

      let verifiedSentCount = 0;
      let guestSkippedCount = 0;

      matching.forEach((rep) => {
        const prof = profiles.find((p) => p.device_id && p.device_id === rep.device_id);
        const res = dispatchSmsNotification(
          prof,
          "BULK ADVISORY [" + selectedBulkCategory + "]: " + (bulkNotice || 'Operations active on site.')
        );
        if (res.sent) verifiedSentCount++;
        else guestSkippedCount++;
      });

      const bulkNoticeSummary = "Bulk SMS Broadcast: " + verifiedSentCount + " Verified Citizens notified via SMS. " + guestSkippedCount + " Guest Devices updated in-app.";

      setSmsLogs((prev) => [
        { id: Date.now(), timestamp: new Date().toLocaleTimeString(), text: bulkNoticeSummary, type: 'SUCCESS' },
        ...prev
      ]);

      showMessage(`Category bulk update completed.\nCategory: ${selectedBulkCategory}\nUpdated status: ${bulkStatus.replace(/_/g, ' ')}\n\n${bulkNoticeSummary}`, 'success');

      setBulkNotice('');
      setBulkPhoto(null);
      fetchAdminData();
    } catch (err) {
      showMessage("Bulk update failed: " + err.message, 'error');
    }
  };

  // Photo Upload Handler
  const handlePhotoUpload = (e, callback) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > h ? w > MAX : h > MAX) {
          if (w > h) { h *= MAX / w; w = MAX; } else { w *= MAX / h; h = MAX; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.75);
        if (callback) callback(compressedBase64);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  // User Account Moderation
  const handleUpdateUserStatus = async (deviceId, newStatus, reason = '') => {
    const targetUser = profiles.find((profile) => profile.device_id === deviceId);
    const displayName = targetUser?.username || deviceId || 'this user';
    const actionLabels = {
      PENALIZED: 'issue a penalty to',
      BANNED: 'ban',
      VERIFIED: 'approve and verify',
      REJECTED: 'reject the verification request for'
    };

    const actionLabel = actionLabels[newStatus] || 'change the status of';
    const reasonText = reason ? `\nReason: ${reason}` : '';
    if (!(await confirmAction(`Confirm that you want to ${actionLabel} ${displayName}?${reasonText}`))) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ verification_status: newStatus })
        .eq('device_id', deviceId);

      if (error) throw error;

      let msgText = "Account status updated to " + newStatus + ".";

      setSmsLogs((prev) => [
        { id: Date.now(), timestamp: new Date().toLocaleTimeString(), text: "[User " + deviceId + "] " + msgText, type: 'SUCCESS' },
        ...prev
      ]);

      showMessage(`User status updated.\nDevice ID: ${deviceId}\nNew status: ${newStatus}`, 'success');
      fetchAdminData();
    } catch (err) {
      showMessage("Moderation failed: " + err.message, 'error');
    }
  };

  const openModerationForm = (user, action) => {
    setModerationTarget(user);
    setModerationAction(action);
    setModerationMessage('');
    setPenaltyDays('');
  };

  const handleApplyModeration = async () => {
    if (!moderationTarget) return;
    const message = moderationMessage.trim();
    const days = Number(penaltyDays);
    if (!message) return showMessage('Enter the message the user will see for this moderation action.', 'error');
    if (moderationAction === 'PENALIZED' && (!Number.isSafeInteger(days) || days < 1)) {
      return showMessage('Enter a whole-number penalty duration of at least one day.', 'error');
    }

    const deviceId = moderationTarget.device_id;
    if (!deviceId) return showMessage('This profile does not have a device ID and cannot be moderated.', 'error');
    const actionName = moderationAction === 'BANNED' ? 'ban' : `${days}-day report penalty`;
    if (!(await confirmAction(`Confirm ${actionName} for ${moderationTarget.username || deviceId}?\n\nUser message: ${message}`))) return;
    const penaltyEnd = moderationAction === 'PENALIZED'
      ? new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      : null;
    if (penaltyEnd && !Number.isFinite(penaltyEnd.getTime())) {
      return showMessage('The penalty duration is too long. Enter a smaller number of days.', 'error');
    }

    const currentStatus = (moderationTarget.verification_status || 'GUEST').trim().toUpperCase();
    const previousStatus = ['PENALIZED', 'BANNED'].includes(currentStatus)
      ? moderationTarget.moderation_previous_status || 'GUEST'
      : getEffectiveVerificationStatus(moderationTarget);
    const payload = {
      verification_status: moderationAction,
      moderation_message: message,
      moderation_previous_status: previousStatus,
      penalty_until: penaltyEnd ? penaltyEnd.toISOString() : null
    };

    setIsUpdatingModeration(true);
    try {
      const { data: updatedProfile, error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('device_id', deviceId)
        .select('device_id')
        .maybeSingle();
      if (error) throw error;
      if (!updatedProfile) throw new Error('The profile was not updated. Refresh and verify your admin permissions.');

      setProfiles((prev) => prev.map((profile) => (
        profile.device_id === deviceId ? { ...profile, ...payload } : profile
      )));
      setModerationTarget(null);
      showMessage(
        moderationAction === 'BANNED'
          ? `Ban applied to ${moderationTarget.username || deviceId}. The app will remain locked on that device until the ban is lifted.`
          : `Report submissions paused for ${moderationTarget.username || deviceId} until ${new Date(payload.penalty_until).toLocaleString()}.`,
        'success'
      );
    } catch (err) {
      showMessage(`Moderation failed: ${err.message}`, 'error');
    } finally {
      setIsUpdatingModeration(false);
    }
  };

  const handleLiftModeration = async (user) => {
    const deviceId = user.device_id;
    if (!deviceId) return showMessage('This profile does not have a device ID.', 'error');
    const restoredStatus = user.moderation_previous_status || 'GUEST';
    const restrictionName = (user.verification_status || '').toUpperCase() === 'BANNED' ? 'ban' : 'penalty';
    if (!(await confirmAction(`Lift the ${restrictionName} for ${user.username || deviceId} and restore their ${restoredStatus} account status?`))) return;

    const payload = {
      verification_status: restoredStatus,
      moderation_message: null,
      moderation_previous_status: null,
      penalty_until: null
    };
    try {
      const { data: updatedProfile, error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('device_id', deviceId)
        .select('device_id')
        .maybeSingle();
      if (error) throw error;
      if (!updatedProfile) throw new Error('The profile was not updated. Refresh and verify your admin permissions.');
      setProfiles((prev) => prev.map((profile) => (
        profile.device_id === deviceId ? { ...profile, ...payload } : profile
      )));
      showMessage(`${restrictionName === 'ban' ? 'Ban' : 'Penalty'} lifted for ${user.username || deviceId}.`, 'success');
    } catch (err) {
      showMessage(`Could not lift moderation: ${err.message}`, 'error');
    }
  };

  // Restore one rejected report to the submitted queue
  const handleRestoreRejectedReport = async (reportId) => {
    if (!(await confirmAction(`Restore ticket ${formatTicketReference(reportId)} to the Submitted Queue?`))) return;
    try {
      const { error } = await supabase
        .from('reports')
        .update({ status: 'PENDING' })
        .eq('id', reportId);

      if (error) throw error;

      showMessage(`Ticket ${formatTicketReference(reportId)} has been restored to the Submitted Queue.`, 'success');
      fetchAdminData();
    } catch (err) {
      showMessage("Restore failed: " + err.message, 'error');
    }
  };

  // Batch Purge Rejected Data
  const handlePurgeAllRejectedData = async () => {
    const rejectedList = reports.filter((r) => ['REJECTED', 'REJECTED_FAKE', 'DELETED'].includes((r.status || '').toUpperCase()));
    if (rejectedList.length === 0) {
      showMessage('No rejected or deleted reports found in the database.', 'info');
      return;
    }

    if (await confirmAction("Permanently delete all " + rejectedList.length + " rejected report records? This action cannot be undone.")) {
      try {
        const { error } = await supabase
          .from('reports')
          .delete()
          .in('id', rejectedList.map((report) => report.id));

        if (error) throw error;

        showMessage('All rejected report records were permanently deleted from the database.', 'success');
        setSelectedReport(null);
        fetchAdminData();
      } catch (err) {
        showMessage("Purge failed: " + err.message, 'error');
      }
    }
  };

  const handlePrintDocument = () => {
    window.print();
  };

  const handleDownloadDocxTemplate = () => {
    const item = selectedMemoCategoryGroup || selectedMemoReport;
    if (!item) return showMessage('Please select a report or category group first.', 'error');

    const title = selectedMemoCategoryGroup
      ? "IMMEDIATE RESPONSE REQUEST: " + selectedMemoCategoryGroup.category
      : "IMMEDIATE RESPONSE REQUEST: " + (selectedMemoReport.hazard_type || selectedMemoReport.category);

    const content = `
================================================================================
REPUBLIC OF THE PHILIPPINES
PROVINCE OF BATANGAS • CITY OF BATANGAS
CITY DISASTER RISK REDUCTION AND MANAGEMENT OFFICE (CDRRMO)
BATANGAS COMMAND CENTER & INCIDENT ENDORSEMENT NETWORK
================================================================================

MEMORANDUM REF NO: MEMO-AGAP-2026-${(item.id || '001').toString().replace('#', '')}
DATE & TIMESTAMP: ${new Date().toLocaleString()}
SUBJECT: ${title}

I. INCIDENT SPECIFICATION & CITIZEN REPORT SUMMARY
Category Title: ${selectedMemoCategoryGroup ? selectedMemoCategoryGroup.category : (selectedMemoReport.hazard_type || selectedMemoReport.category)}
Report Count: ${selectedMemoCategoryGroup ? selectedMemoCategoryGroup.reports.length : 1} Report(s)
Severity / Urgency Level: HIGH / URGENT - Action Required Within 24 Hours
Location Sector: ${selectedMemoCategoryGroup ? selectedMemoCategoryGroup.locations.join(', ') : selectedMemoReport.location}
AGAP Investigation Status: Investigated, field-verified, and accepted for authority response

II. AGAP INVESTIGATION & INCIDENT DETAILS
${selectedMemoCategoryGroup ? selectedMemoCategoryGroup.reports.map((r) => `• Ticket ${formatTicketReference(r.id || r.ticket_no)} - [${r.hazard_type || r.category || 'Incident'}]: "${r.description || 'No additional citizen description was provided.'}" (Location: ${r.location || 'Not provided'})`).join('\n') : `• Ticket ${formatTicketReference(selectedMemoReport.id || selectedMemoReport.ticket_no)} - [${selectedMemoReport.hazard_type || selectedMemoReport.category}]: "${selectedMemoReport.description || 'No additional citizen description was provided.'}" (Location: ${selectedMemoReport.location || 'Not provided'})`}

III. CITIZEN AND FIELD-VERIFICATION PHOTOGRAPHIC EVIDENCE
Total Evidence Photos Attached: ${selectedMemoPhotos.length}

IV. MANDATED ACTION & TRANSMITTAL DIRECTIVE
Project AGAP has reviewed the citizen report, completed the investigation, and accepted the reported hazard for response. The attached citizen-submitted and responder field-verification photographs document the reported condition. We respectfully request an immediate on-site assessment and appropriate action by the responsible authority. Please acknowledge receipt and provide a response update for community safety.

________________________________________        ________________________________________
CDRRMO COMMAND OFFICER                          RECIPIENT RECEIVING OFFICER
Project AGAP Operations Portal                  Signature & Date / Time Received
`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `MEMO-AGAP-2026-${(item.id || '001').toString().replace('#', '')}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrepareMemo = async (item, isCategoryGroup = false) => {
    const subject = isCategoryGroup
      ? `category group "${item.category}"`
      : `ticket ${formatTicketReference(item.id || item.ticket_no)}`;
    if (!(await confirmAction(`Create a transmittal memo for ${subject}?`))) return;

    setSelectedMemoCategoryGroup(isCategoryGroup ? item : null);
    setSelectedMemoReport(isCategoryGroup ? null : item);
    setMemoSubTab('PART2');
  };

  
  // Data Filtering Variables
  const submittedQueueReports = reports.filter((r) =>
    ['PENDING', 'UNDER_INVESTIGATION'].includes((r.status || 'PENDING').trim().toUpperCase())
  );

  const investigatedReports = reports.filter((r) =>
    ['FIELD_DISPATCHED', 'DISPATCHED', 'EN_ROUTE', 'ON_SCENE', 'FIELD_CONFIRMED', 'FIELD_NOT_FOUND']
      .includes((r.status || '').toUpperCase())
  );

  const displayedSubmittedReports = submittedSubTab === 'INVESTIGATED'
    ? investigatedReports
    : submittedQueueReports;

  const activeTrackerReports = reports.filter((r) => 
    ['APPROVED', 'DISPATCHED', 'IN_PROGRESS'].includes((r.status || '').trim().toUpperCase())
  );

  const resolvedReports = reports.filter((r) => 
    (r.status || '').toUpperCase() === 'RESOLVED'
  );

  const rejectedDataReports = reports.filter((r) => 
    ['REJECTED', 'REJECTED_FAKE', 'DELETED'].includes((r.status || '').toUpperCase())
  );

  const filteredSubmittedReports = displayedSubmittedReports.filter((r) => {
    if (submittedSeverityFilter === 'ALL') return true;
    return (r.severity || 'HIGH').toUpperCase() === submittedSeverityFilter.toUpperCase();
  });

  const activeCategoriesList = Array.from(
    new Set(
      activeTrackerReports
        .map(getAdminCategory)
        .filter(Boolean)
    )
  );
  const selectedBulkReports = activeTrackerReports.filter(
    (report) => getAdminCategory(report).toUpperCase() === selectedBulkCategory.trim().toUpperCase()
  );
  const selectedBulkAllInProgress = selectedBulkReports.length > 0 &&
    selectedBulkReports.every((report) => (report.status || '').toUpperCase() === 'IN_PROGRESS');

  // Grouped Categories for Transmittal Memos
  const memoEligibleReports = reports.filter((report) =>
    ['APPROVED', 'DISPATCHED', 'IN_PROGRESS', 'RESOLVED']
      .includes((report.status || '').trim().toUpperCase())
  );
  const categoryGroupMap = {};
  memoEligibleReports.forEach((rep) => {
    const cat = getAdminCategory(rep);
    if (cat) {
      if (!categoryGroupMap[cat]) {
        categoryGroupMap[cat] = {
          id: `CAT-${cat.toUpperCase().replace(/\s+/g, '-')}`,
          category: cat,
          reports: [],
          locations: new Set(),
          photos: []
        };
      }
      categoryGroupMap[cat].reports.push(rep);
      if (rep.location) categoryGroupMap[cat].locations.add(rep.location);
      const repPhotos = getMemoEvidencePhotos(rep);
      repPhotos.forEach(p => categoryGroupMap[cat].photos.push(p));
    }
  });

  const categoryGroups = Object.values(categoryGroupMap).map(g => ({
    ...g,
    locations: Array.from(g.locations)
  }));

  const uncategorizedReports = memoEligibleReports.filter((r) => {
    return !getAdminCategory(r);
  });

  // Grouped Categories for Resolved Archive
  const resolvedCategoryGroupMap = {};
  resolvedReports.forEach((rep) => {
    const cat = (rep.category || '').trim();
    if (cat && cat.toUpperCase() !== 'OTHER' && cat.toUpperCase() !== 'UNCATEGORIZED') {
      if (!resolvedCategoryGroupMap[cat]) {
        resolvedCategoryGroupMap[cat] = {
          id: `RESOLVED-CAT-${cat.toUpperCase().replace(/\s+/g, '-')}`,
          category: cat,
          reports: [],
          locations: new Set(),
          photos: [],
          progressPhotos: []
        };
      }
      resolvedCategoryGroupMap[cat].reports.push(rep);
      if (rep.location) resolvedCategoryGroupMap[cat].locations.add(rep.location);
      const repPhotos = parsePhotos(rep.proof_photos || rep.photos);
      repPhotos.forEach(p => resolvedCategoryGroupMap[cat].photos.push(p));
      if (rep.progress_photo) resolvedCategoryGroupMap[cat].progressPhotos.push(rep.progress_photo);
    }
  });

  const resolvedCategoryGroups = Object.values(resolvedCategoryGroupMap).map(g => ({
    ...g,
    locations: Array.from(g.locations)
  }));

  const resolvedUncategorizedReports = resolvedReports.filter((r) => {
    const cat = (r.category || '').trim().toUpperCase();
    return !cat || cat === 'OTHER' || cat === 'UNCATEGORIZED';
  });

  const verifiedCitizens = profiles
    .filter((p) => getEffectiveVerificationStatus(p) === 'VERIFIED')
    .sort((a, b) => (a.username || a.full_name || '').localeCompare(b.username || b.full_name || ''));

  const guestUsers = profiles
    .filter((p) => ['GUEST', ''].includes(getEffectiveVerificationStatus(p)))
    .sort((a, b) => (a.device_id || '').localeCompare(b.device_id || ''));

  const moderatedUsers = profiles
    .filter((p) => ['PENALIZED', 'BANNED'].includes(getModerationRestriction(p)?.kind))
    .sort((a, b) => (a.username || a.device_id || '').localeCompare(b.username || b.device_id || ''));

  const pendingVerificationRequests = profiles
    .filter((p) => !['VERIFIED', 'GUEST'].includes(getEffectiveVerificationStatus(p))
      && !['PENALIZED', 'BANNED'].includes((p.verification_status || '').toUpperCase()))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  // Vector Line Analytics Data Generator
  const getVectorLineAnalyticsData = () => {
    const start = new Date(customStartDate);
    const end = new Date(customEndDate);
    const diffDays = Math.max(Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1, 3);
    const days = Math.min(diffDays, 14);

    const dateLabels = [];
    const validCounts = [];
    const falseCounts = [];

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dateLabels.push(label);

      let vCount = 0;
      let fCount = 0;

      reports.forEach((rep) => {
        if (rep.created_at) {
          const repDate = new Date(rep.created_at).toISOString().split('T')[0];
          if (repDate === dateStr) {
            const st = (rep.status || '').toUpperCase();
            if (st === 'REJECTED' || st === 'DELETED') {
              fCount++;
            } else {
              vCount++;
            }
          }
        }
      });

      validCounts.push(vCount);
      falseCounts.push(fCount);
    }

    const maxVal = Math.max(...validCounts, ...falseCounts, 4);
    const width = 360;
    const height = 110;
    const padding = 24;
    const yBaseline = height - padding - 8;

    const getCoords = (dataArr) => {
      return dataArr.map((val, idx) => {
        const x = padding + (idx / Math.max(days - 1, 1)) * (width - padding * 2);
        const y = yBaseline - (val / maxVal) * (yBaseline - padding);
        return { x, y, val };
      });
    };

    const validCoords = getCoords(validCounts);
    const falseCoords = getCoords(falseCounts);

    const makeSvgPath = (coords) => {
      return coords.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
    };

    return {
      dateLabels,
      validCounts,
      falseCounts,
      validPath: makeSvgPath(validCoords),
      falsePath: makeSvgPath(falseCoords),
      validCoords,
      falseCoords,
      maxVal,
      totalValid: validCounts.reduce((a, b) => a + b, 0),
      totalFalse: falseCounts.reduce((a, b) => a + b, 0)
    };
  };

  const analyticsData = getVectorLineAnalyticsData();
  const selectedUserReports = selectedUser ? getUserSubmissions(selectedUser, reports) : [];
  const selectedMemoPhotos = selectedMemoCategoryGroup
    ? selectedMemoCategoryGroup.photos
    : selectedMemoReport
      ? getMemoEvidencePhotos(selectedMemoReport)
      : [];
  const handleOpenUserDetails = (user) => {
    setExpandedUserReportId(null);
    setSelectedUser(user);
  };
  const handleCloseUserDetails = () => {
    setSelectedUser(null);
    setExpandedUserReportId(null);
  };

  const getSeverityBadgeStyle = (severity) => {
    const s = (severity || 'HIGH').toUpperCase();
    if (s === 'CRITICAL') return styles.badgeRed;
    if (s === 'HIGH') return styles.badgeOrange;
    if (s === 'MEDIUM') return styles.badgeYellow;
    return styles.badgeTeal;
  };

  const renderArchiveTicketDetails = (rep, submitter) => {
    const photoList = parsePhotos(rep.proof_photos || rep.photos);
    const mapQuery = rep.coordinates || rep.location;
    return (
      <>
        <div style={styles.detailGridPlain}>
          <div style={styles.detailRowPlain}>
            <span style={styles.fieldLabel}>Ticket number</span>
            <span style={styles.fieldValText}>{rep.ticket_no || rep.id}</span>
          </div>
          <div style={styles.detailRowPlain}>
            <span style={styles.fieldLabel}>Status</span>
            <span style={styles.fieldValText}>{(rep.status || '').replace(/_/g, ' ')}</span>
          </div>
          {rep.created_at && (
            <div style={styles.detailRowPlain}>
              <span style={styles.fieldLabel}>Submitted</span>
              <span style={styles.fieldValText}>{new Date(rep.created_at).toLocaleString()}</span>
            </div>
          )}
          <div style={styles.detailRowPlain}>
            <span style={styles.fieldLabel}>Type</span>
            <span style={styles.fieldValText}>{rep.hazard_type || rep.category || 'Hazard report'}</span>
          </div>
          <div style={styles.detailRowPlain}>
            <span style={styles.fieldLabel}>Severity</span>
            <span style={styles.fieldValText}>{(rep.severity || 'HIGH').toUpperCase()}</span>
          </div>
          {getAdminCategory(rep) && (
            <div style={styles.detailRowPlain}>
              <span style={styles.fieldLabel}>Category</span>
              <span style={styles.fieldValText}>{getAdminCategory(rep)}</span>
            </div>
          )}
          <div style={styles.detailRowPlain}>
            <span style={styles.fieldLabel}>Location</span>
            <span style={styles.fieldValText}>{rep.location || 'Not provided'}</span>
          </div>
          <div style={styles.detailRowPlain}>
            <span style={styles.fieldLabel}>Reporter</span>
            <span style={styles.fieldValText}>{submitter.username}</span>
          </div>
          <div style={styles.detailRowPlain}>
            <span style={styles.fieldLabel}>Device ID</span>
            <span style={styles.fieldValText}>{submitter.deviceId}</span>
          </div>
          {(rep.assigned_responder || rep.assigned_team) && (
            <div style={styles.detailRowPlain}>
              <span style={styles.fieldLabel}>Assigned team</span>
              <span style={styles.fieldValText}>{rep.assigned_responder || rep.assigned_team}</span>
            </div>
          )}
          {rep.coordinates && (
            <div style={styles.detailRowPlain}>
              <span style={styles.fieldLabel}>Coordinates</span>
              <span style={styles.fieldValText}>{rep.coordinates}</span>
            </div>
          )}
        </div>
        {mapQuery && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
            target="_blank"
            rel="noreferrer"
            style={styles.archiveMapLink}
          >
            View reported location in Google Maps
          </a>
        )}
        <div style={styles.detailSectionPlain}>
          <span style={styles.fieldLabel}>Description</span>
          <p style={styles.descTextPlain}>{rep.description || 'No description provided.'}</p>
        </div>
        {rep.dispatch_notes && (
          <div style={styles.detailSectionPlain}>
            <span style={styles.fieldLabel}>Dispatch message</span>
            <p style={styles.descTextPlain}>{rep.dispatch_notes}</p>
          </div>
        )}
        {rep.admin_notes && (
          <div style={styles.detailSectionPlain}>
            <span style={styles.fieldLabel}>Investigation / admin notes</span>
            <p style={styles.descTextPlain}>{rep.admin_notes}</p>
          </div>
        )}
        {photoList.length > 0 && (
          <div style={styles.detailSectionPlain}>
            <span style={styles.fieldLabel}>Submitted photos</span>
            <div style={styles.photoGalleryGrid}>
              {photoList.map((src, index) => (
                <img
                  key={index}
                  src={src}
                  alt={`Submitted report photo ${index + 1}`}
                  style={styles.thumbImgFixed}
                  onClick={() => setInspectImage(src)}
                />
              ))}
            </div>
          </div>
        )}
        {rep.response_photo && (
          <div style={styles.detailSectionPlain}>
            <span style={styles.fieldLabel}>Responder field evidence photo</span>
            <img
              src={rep.response_photo}
              alt="Responder hazard verification evidence"
              style={styles.fieldEvidenceImage}
              onClick={() => setInspectImage(rep.response_photo)}
            />
          </div>
        )}
      </>
    );
  };

  return (
    <div style={styles.container}>
      {/* Top Header Bar */}
      <div style={styles.navHeader}>
        <button 
          style={styles.backBtn} 
          onClick={currentView === 'DASHBOARD' ? onBack : () => setCurrentView('DASHBOARD')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0F766E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          {currentView === 'DASHBOARD' ? 'Exit Portal' : 'Main Dashboard'}
        </button>
        <div>
          <h2 style={styles.headerTitle}>CDRRMO Command Portal</h2>
          <div style={styles.headerSub}>Batangas Operations Center</div>
        </div>
      </div>

      {/* MAIN DASHBOARD VIEW */}
      {currentView === 'DASHBOARD' && (
        <div style={styles.dashboardContainer}>
          <div style={styles.welcomeBanner}>
            <div style={styles.welcomeTag}>CDRRMO COMMAND CENTER</div>
            <h3 style={styles.welcomeTitle}>Hello, Admin!</h3>
            <p style={styles.welcomeSubtext}>Welcome back to Project AGAP. Monitor hazards, dispatch rescue units & manage community safety.</p>
          </div>

          {/* SMS Notification Gateway Activity Status */}
          <div style={styles.smsStatusCard}>
            <div style={styles.smsStatusHeader}>
              <span style={styles.smsStatusTitle}>SMS NOTIFICATION DISPATCH GATEWAY</span>
              <span style={styles.smsBadgeActive}>ACTIVE</span>
            </div>
            <p style={styles.smsStatusSub}>
              External SMS alerts are dispatched exclusively to <strong>Verified Citizens</strong> with registered mobile numbers. Guest devices receive in-app tracker updates.
            </p>
            {smsLogs.length > 0 && (
              <div style={styles.smsLogBox}>
                <div style={styles.smsLogLabel}>RECENT DISPATCH AUDIT LOG:</div>
                {smsLogs.slice(0, 3).map((log) => (
                  <div key={log.id} style={styles.smsLogRow}>
                    <span style={styles.smsLogTime}>[{log.timestamp}]</span>
                    <span style={log.type === 'SUCCESS' ? styles.smsLogSuccess : styles.smsLogSkipped}>{log.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={styles.moduleSectionTitle}>CORE ADMIN FUNCTIONS</div>
          
          {/* Table-Like 5 Module List */}
          <div style={styles.tableCardContainer}>
            <div style={styles.tableHeaderRow}>
              <span></span>
              <span>FEATURE</span>
              <span style={styles.tableHeaderStatus}>STATUS</span>
            </div>
            {/* Module 1: Submitted and Investigated Tickets */}
            <div style={styles.tableRow} onClick={() => setCurrentView('SUBMITTED_REPORTS')}>
              <div style={styles.tableColIcon}>
                <div style={styles.iconBoxAmber}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                </div>
              </div>
              <div style={styles.tableColContent}>
                <div style={styles.tableTitle}>Submitted & Investigated Tickets</div>
                <div style={styles.tableDesc}>Review new submissions and track field investigations</div>
              </div>
              <div style={styles.tableColBadge}>
                <span style={styles.badgeOrange}>{submittedQueueReports.length} Submitted</span>
              </div>
            </div>

            {/* Module 2: Active Operations */}
            <div style={styles.tableRow} onClick={() => setCurrentView('ACTIVE_OPERATIONS')}>
              <div style={styles.tableColIcon}>
                <div style={styles.iconBoxTeal}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0F766E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                    <polyline points="2 17 12 22 22 17"/>
                    <polyline points="2 12 12 17 22 12"/>
                  </svg>
                </div>
              </div>
              <div style={styles.tableColContent}>
                <div style={styles.tableTitle}>Active Operations</div>
                <div style={styles.tableDesc}>Track progress and broadcast category updates</div>
              </div>
              <div style={styles.tableColBadge}>
                <span style={styles.badgeTeal}>{activeTrackerReports.length} Active</span>
              </div>
            </div>

            {/* Module 3: User Management */}
            <div style={styles.tableRow} onClick={() => setCurrentView('USER_HANDLING')}>
              <div style={styles.tableColIcon}>
                <div style={styles.iconBoxPurple}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
              </div>
              <div style={styles.tableColContent}>
                <div style={styles.tableTitle}>User Management</div>
                <div style={styles.tableDesc}>Directory, ID verification, DEV ID moderation & banning</div>
              </div>
              <div style={styles.tableColBadge}>
                <span style={styles.badgeBlue}>{profiles.length} Accounts</span>
              </div>
            </div>

            {/* Module 4: Transmittal Memos */}
            <div style={styles.tableRow} onClick={() => setCurrentView('DOCUMENT_GENERATOR')}>
              <div style={styles.tableColIcon}>
                <div style={styles.iconBoxEmerald}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <path d="M9 15l2 2 4-4"/>
                  </svg>
                </div>
              </div>
              <div style={styles.tableColContent}>
                <div style={styles.tableTitle}>Transmittal Memos</div>
                <div style={styles.tableDesc}>Export official inter-agency escalation PDFs & .doc files</div>
              </div>
              <div style={styles.tableColBadge}>
                <span style={styles.badgeGreen}>Official Memo</span>
              </div>
            </div>

            {/* Module 5: Resolved Incident Archive */}
            <div style={styles.tableRowLast} onClick={() => setCurrentView('RESOLVED_ARCHIVE')}>
              <div style={styles.tableColIcon}>
                <div style={styles.iconBoxSlate}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0F766E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                </div>
              </div>
              <div style={styles.tableColContent}>
                <div style={styles.tableTitle}>Resolved Incident Archive</div>
                <div style={styles.tableDesc}>Review resolved and rejected tickets with submitted details and evidence</div>
              </div>
              <div style={styles.tableColBadge}>
                <span style={styles.badgeTeal}>{resolvedReports.length} Resolved</span>
              </div>
            </div>
          </div>

          {/* Section Divider */}
          <div style={styles.dividerRow}>
            <span style={styles.dividerLabel}>INCIDENT SUBMISSION STATISTICS & ANALYTICS</span>
          </div>

          {/* Vector Line Graph Analytics */}
          <div style={styles.chartCard}>
            <div style={styles.chartControlRow}>
              <div style={styles.chartTitleTag}>CUSTOM DATE RANGE ANALYTICS</div>
              <div style={styles.dateRangeGroup}>
                <input
                  type="date"
                  style={styles.datePickerInput}
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                />
                <span style={styles.toText}>to</span>
                <input
                  type="date"
                  style={styles.datePickerInput}
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                />
              </div>
            </div>

            {/* SVG Vector Line Graph */}
            <div style={styles.svgGraphBox}>
              <svg width="100%" height="120" viewBox="0 0 360 120" style={{ overflow: 'visible' }}>
                <defs>
                  <linearGradient id="tealArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0F766E" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#0F766E" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Y-Axis Line */}
                <line x1="24" y1="10" x2="24" y2="92" stroke="#334155" strokeWidth="1.5" />
                <text x="18" y="16" fontSize="7" fontWeight="700" fill="#64748B" textAnchor="end">{analyticsData.maxVal}</text>
                <text x="18" y="54" fontSize="7" fontWeight="700" fill="#64748B" textAnchor="end">{Math.round(analyticsData.maxVal / 2)}</text>
                <text x="18" y="92" fontSize="7" fontWeight="700" fill="#64748B" textAnchor="end">0</text>

                {/* X-Axis Baseline */}
                <line x1="24" y1="92" x2="345" y2="92" stroke="#334155" strokeWidth="1.5" />
                <line x1="24" y1="52" x2="345" y2="52" stroke="#E2E8F0" strokeWidth="1" strokeDasharray="3,3" />
                <line x1="24" y1="14" x2="345" y2="14" stroke="#E2E8F0" strokeWidth="1" strokeDasharray="3,3" />

                {analyticsData.validCoords.length > 0 && (
                  <path
                    d={`${analyticsData.validPath} L ${analyticsData.validCoords[analyticsData.validCoords.length - 1].x} 92 L ${analyticsData.validCoords[0].x} 92 Z`}
                    fill="url(#tealArea)"
                  />
                )}

                <path d={analyticsData.validPath} fill="none" stroke="#0F766E" strokeWidth="2.5" strokeLinecap="round" />
                <path d={analyticsData.falsePath} fill="none" stroke="#DC2626" strokeWidth="2" strokeDasharray="4,3" strokeLinecap="round" />

                {analyticsData.validCoords.map((pt, idx) => (
                  <g key={idx}>
                    <circle cx={pt.x} cy={pt.y} r="3.5" fill="#0F766E" stroke="#FFFFFF" strokeWidth="1.5" />
                    {pt.val > 0 && (
                      <text x={pt.x} y={pt.y - 6} fontSize="7" fontWeight="800" fill="#0F766E" textAnchor="middle">
                        {pt.val}
                      </text>
                    )}
                    <text x={pt.x} y="104" fontSize="6.5" fontWeight="700" fill="#64748B" textAnchor="middle">
                      {analyticsData.dateLabels[idx]}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            <div style={styles.chartLegendRow}>
              <span style={styles.legendValid}>— Valid Incidents ({analyticsData.totalValid})</span>
              <span style={styles.legendFalse}>- - False/Rejected ({analyticsData.totalFalse})</span>
            </div>
          </div>
        </div>
      )}

      {/* MODULE 1: SUBMITTED AND INVESTIGATED TICKETS */}
      {currentView === 'SUBMITTED_REPORTS' && (
        <div style={styles.sectionStack}>
          <div style={styles.subTabContainer}>
            <button
              style={submittedSubTab === 'QUEUE' ? styles.subTabBtnActive : styles.subTabBtnInactive}
              onClick={() => setSubmittedSubTab('QUEUE')}
            >
              Submitted Queue ({submittedQueueReports.length})
            </button>
            <button
              style={submittedSubTab === 'INVESTIGATED' ? styles.subTabBtnActive : styles.subTabBtnInactive}
              onClick={() => setSubmittedSubTab('INVESTIGATED')}
            >
              Investigated Tickets ({investigatedReports.length})
            </button>
          </div>

          {/* Sub-Tab 1: Pending Queue */}
          {['QUEUE', 'INVESTIGATED'].includes(submittedSubTab) && (
            <div style={styles.sectionStack}>
              {/* Collapsible Filter Bar Toggle */}
              <div style={{ marginBottom: '8px' }}>
                <button
                  style={styles.btnToggleFilter}
                  onClick={() => setShowSubmittedFilter(!showSubmittedFilter)}
                >
                  Filter by Severity {showSubmittedFilter ? '▲' : '▼'} {submittedSeverityFilter !== 'ALL' ? `(${submittedSeverityFilter})` : ''}
                </button>

                {showSubmittedFilter && (
                  <div style={styles.filterBarRow}>
                    <span style={styles.filterLabel}>SEVERITY LEVEL:</span>
                    {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((sev) => (
                      <button
                        key={sev}
                        style={submittedSeverityFilter === sev ? styles.filterBtnActive : styles.filterBtnInactive}
                        onClick={() => setSubmittedSeverityFilter(sev)}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {filteredSubmittedReports.length === 0 ? (
                <div style={styles.emptyCard}>
                  {submittedSubTab === 'QUEUE'
                    ? 'No new submitted tickets match this filter.'
                    : 'No investigated tickets match this filter.'}
                </div>
              ) : (
                filteredSubmittedReports.map((rep) => {
                  const isExpanded = expandedTicketId === rep.id;
                  const photoList = parsePhotos(rep.proof_photos || rep.photos);
                  const submitter = getSubmitterInfo(rep, profiles);
                  const reportStatus = (rep.status || 'PENDING').toUpperCase();
                  return (
                    <div key={rep.id} style={styles.itemCardAccordion} onClick={() => setExpandedTicketId(isExpanded ? null : rep.id)}>
                      <div style={styles.cardHeaderRow}>
                        <div style={styles.headerTitleGroup}>
                          <span style={styles.ticketBadge}>{formatTicketReference(rep.id || rep.ticket_no)}</span>
                          <span style={getSeverityBadgeStyle(rep.severity)}>{(rep.severity || 'HIGH').toUpperCase()}</span>
                        </div>
                        <span style={styles.userMetaText}>Device ID: {submitter.deviceId}</span>
                      </div>

                      <h4 style={styles.itemTitle}>{rep.hazard_type || rep.category || 'Hazard Incident Report'}</h4>

                      {!isExpanded ? (
                        <div style={styles.expandHintText}>Click to expand full details & process controls &rarr;</div>
                      ) : (
                        <div style={styles.accordionDetailBox} onClick={(e) => e.stopPropagation()}>
                          <div style={styles.detailGridPlain}>
                            <div style={styles.detailRowPlain}>
                              <span style={styles.fieldLabel}>Status</span>
                              <span style={styles.fieldValText}>{reportStatus.replace(/_/g, ' ')}</span>
                            </div>
                            <div style={styles.detailRowPlain}>
                              <span style={styles.fieldLabel}>Type</span>
                              <span style={styles.fieldValText}>{rep.hazard_type || rep.category}</span>
                            </div>
                            <div style={styles.detailRowPlain}>
                              <span style={styles.fieldLabel}>Severity</span>
                              <span style={getSeverityBadgeStyle(rep.severity)}>{(rep.severity || 'HIGH').toUpperCase()}</span>
                            </div>
                            <div style={styles.detailRowPlain}>
                              <span style={styles.fieldLabel}>Location</span>
                              <span style={styles.fieldValText}>{rep.location}</span>
                            </div>
                            <div style={styles.detailRowPlain}>
                              <span style={styles.fieldLabel}>Reporter</span>
                              <span style={styles.fieldValText}>Device ID: {submitter.deviceId}</span>
                            </div>
                          </div>

                          {/* Google Maps Preview */}
                          <div style={styles.mapContainerBox}>
                            <span style={styles.fieldLabel}>LOCATION MAP PREVIEW (Click to open Google Maps):</span>
                            <div 
                              style={styles.gpsMapBoxInteractive} 
                              onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rep.coordinates || rep.location || '13.7565,121.0583')}`, '_blank')}
                              title="Click to open in Google Maps"
                            >
                              <iframe
                                title="Report GPS Location"
                                width="100%"
                                height="130"
                                frameBorder="0"
                                scrolling="no"
                                src={`https://maps.google.com/maps?q=${encodeURIComponent(rep.coordinates || rep.location || '13.7565,121.0583')}&t=m&z=16&ie=UTF8&iwloc=&output=embed`}
                                style={{ borderRadius: '6px', pointerEvents: 'none' }}
                              ></iframe>
                              <div style={styles.mapOverlayBadge}>Open in Google Maps &rarr;</div>
                            </div>
                          </div>

                          <div style={styles.detailSectionPlain}>
                            <span style={styles.fieldLabel}>Description</span>
                            <p style={styles.descTextPlain}>{rep.description || 'No descriptive details provided by submitter.'}</p>
                          </div>

                          {photoList.length > 0 && (
                            <div style={styles.detailSectionPlain}>
                              <span style={styles.fieldLabel}>Photos ({photoList.length})</span>
                              <div style={styles.photoGalleryGrid}>
                                {photoList.map((src, idx) => (
                                  <img
                                    key={idx}
                                    src={src}
                                    alt={`Evidence ${idx + 1}`}
                                    style={styles.thumbImgFixed}
                                    onClick={() => setInspectImage(src)}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {reportStatus === 'PENDING' && dispatchingReportId !== rep.id && (
                            <div style={styles.actionRow}>
                              <button
                                style={styles.btnInvestigate}
                                onClick={() => handleStartInvestigation(rep.id)}
                              >
                                Start Investigation
                              </button>
                              <button
                                style={styles.btnReject}
                                onClick={() => handleUpdateReportStatus(rep.id, 'REJECTED')}
                              >
                                Reject Report
                              </button>
                            </div>
                          )}

                          {['PENDING', 'UNDER_INVESTIGATION'].includes(reportStatus)
                            && (reportStatus === 'UNDER_INVESTIGATION' || dispatchingReportId === rep.id) && (
                            <div style={styles.dispatchForm}>
                              <span style={styles.fieldLabel}>DISPATCH FOR FIELD VERIFICATION</span>
                              <select
                                style={styles.selectInput}
                                value={selectedResponderTeam}
                                onChange={(e) => setSelectedResponderTeam(e.target.value)}
                              >
                                {responderTeams.map((team) => (
                                  <option key={team.id} value={team.name}>{team.name}</option>
                                ))}
                              </select>
                              <textarea
                                style={styles.textareaInput}
                                rows="3"
                                placeholder="Instructions for the assigned response team..."
                                value={dispatchNotes}
                                onChange={(e) => setDispatchNotes(e.target.value)}
                              />
                              <div style={styles.actionRow}>
                                <button
                                  style={styles.btnDispatch}
                                  onClick={() => handleAssignResponder(rep.id)}
                                >
                                  Dispatch Team & Message
                                </button>
                                {reportStatus === 'PENDING' && (
                                  <button
                                    style={styles.btnCancelAction}
                                    onClick={() => setDispatchingReportId(null)}
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                              <button
                                style={styles.btnRejectCompact}
                                onClick={() => handleUpdateReportStatus(rep.id, 'REJECTED')}
                              >
                                Reject Report
                              </button>
                            </div>
                          )}

                          {['FIELD_DISPATCHED', 'EN_ROUTE', 'ON_SCENE'].includes(reportStatus) && (
                            <div style={styles.dispatchOutcomeBox}>
                              <div style={styles.dispatchOutcomeTitle}>RESPONDER TEAM UPDATE</div>
                              <div style={styles.dispatchOutcomeMeta}>Team: {rep.assigned_responder || 'Assigned response team'}</div>
                              <div style={styles.dispatchOutcomeMeta}>
                                Progress: {reportStatus === 'FIELD_DISPATCHED' ? 'Dispatched — awaiting acknowledgement' : reportStatus === 'EN_ROUTE' ? 'Acknowledged — team en route' : 'Team has arrived on scene'}
                              </div>
                              {rep.dispatch_notes && <p style={styles.dispatchOutcomeNotes}>{rep.dispatch_notes}</p>}
                              <div style={styles.workflowHint}>
                                Admin accept/reject decisions will appear here after the responder submits a field verdict.
                              </div>
                            </div>
                          )}

                          {['FIELD_CONFIRMED', 'FIELD_NOT_FOUND'].includes(reportStatus) && (
                            <>
                              <div style={styles.dispatchOutcomeBox}>
                                <div style={styles.dispatchOutcomeTitle}>RESPONDER TEAM FIELD REPORT</div>
                                <div style={styles.dispatchOutcomeMeta}>Team: {rep.assigned_responder || 'Assigned response team'}</div>
                                <div style={reportStatus === 'FIELD_CONFIRMED' ? styles.dispatchVerdictConfirmed : styles.dispatchVerdictNotFound}>
                                  {reportStatus === 'FIELD_CONFIRMED' ? 'HAZARD CONFIRMED AT LOCATION' : 'HAZARD NOT FOUND AT LOCATION'}
                                </div>
                                {rep.admin_notes && <p style={styles.dispatchOutcomeNotes}>{rep.admin_notes}</p>}
                                {rep.response_photo && (
                                  <div style={styles.detailSectionPlain}>
                                    <span style={styles.dispatchOutcomeMeta}>Field evidence photo</span>
                                    <img
                                      src={rep.response_photo}
                                      alt="Responder field evidence"
                                      style={styles.fieldEvidenceImage}
                                      onClick={() => setInspectImage(rep.response_photo)}
                                    />
                                  </div>
                                )}
                                {!rep.response_photo && (
                                  <div style={styles.workflowHint}>
                                    No responder site photo is attached. This ticket cannot be accepted without field evidence.
                                  </div>
                                )}
                              </div>

                              <div style={styles.adminDecisionBox}>
                                <div style={styles.adminDecisionTitle}>ADMIN DECISION</div>
                                <p style={styles.adminDecisionText}>
                                  {reportStatus === 'FIELD_CONFIRMED'
                                    ? 'Review the responder findings and evidence, then accept the verified ticket into Active Operations or reject it.'
                                    : 'The responder could not verify the hazard at the reported location. Review the field report before rejecting this ticket.'}
                                </p>
                                <div style={styles.actionRow}>
                                  {reportStatus === 'FIELD_CONFIRMED' && (
                                    <button
                                      style={rep.response_photo ? styles.btnApprove : styles.btnStepDisabled}
                                      onClick={() => handleUpdateReportStatus(rep.id, 'APPROVED')}
                                      disabled={!rep.response_photo}
                                    >
                                      Accept & Move to Active Operations
                                    </button>
                                  )}
                                  <button
                                    style={styles.btnReject}
                                    onClick={() => handleUpdateReportStatus(rep.id, 'REJECTED')}
                                  >
                                    Reject Report
                                  </button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

        </div>
      )}

      {/* MODULE 2: ACTIVE OPERATIONS */}
      {currentView === 'ACTIVE_OPERATIONS' && (
        <div style={styles.sectionStack}>
          <div style={styles.subTabContainer}>
            <button
              style={activeSubTab === 'TRACKER' ? styles.subTabBtnActive : styles.subTabBtnInactive}
              onClick={() => setActiveSubTab('TRACKER')}
            >
              Active Incident Tracker ({activeTrackerReports.length})
            </button>
            <button
              style={activeSubTab === 'BULK' ? styles.subTabBtnActive : styles.subTabBtnInactive}
              onClick={() => setActiveSubTab('BULK')}
            >
              Category Bulk Operations
            </button>
          </div>

          {/* Sub-Tab 1: Incident Tracker */}
          {activeSubTab === 'TRACKER' && (
            <div style={styles.sectionStack}>
              {activeTrackerReports.length === 0 ? (
                <div style={styles.emptyCard}>No active incident reports in progress.</div>
              ) : (
                activeTrackerReports.map((rep) => {
                  const submitter = getSubmitterInfo(rep, profiles);
                  const isExpanded = expandedTicketId === rep.id;
                  const reportStatus = (rep.status || '').trim().toUpperCase();
                  const isInProgress = reportStatus === 'IN_PROGRESS';
                  const canStartProgress = ['APPROVED', 'DISPATCHED'].includes(reportStatus);
                  const isResolutionOpen = resolvingTicketId === rep.id;
                  const reportResolutionPhoto = tagInputMap[`photo_${rep.id}`];
                  const canMarkResolved = isInProgress && isResolutionOpen && Boolean(reportResolutionPhoto);
                  const photoList = parsePhotos(rep.proof_photos || rep.photos);
                  return (
                    <div key={rep.id} style={styles.itemCardAccordion} onClick={() => setExpandedTicketId(isExpanded ? null : rep.id)}>
                      <div style={styles.cardHeaderRow}>
                        <span style={styles.ticketBadge}>Ticket {formatTicketReference(rep.ticket_no || rep.id)}</span>
                        <span style={styles.userMetaText}>Device ID: {submitter.deviceId}</span>
                      </div>

                      <h4 style={styles.itemTitle}>{rep.hazard_type || 'Hazard report'}</h4>
                      {!isExpanded ? (
                        <div style={styles.expandHintText}>Open ticket details and updates &rarr;</div>
                      ) : (
                        <div style={styles.accordionDetailBox} onClick={(e) => e.stopPropagation()}>
                          <div style={styles.detailGridPlain}>
                            <div style={styles.detailRowPlain}>
                              <span style={styles.fieldLabel}>Status</span>
                              <span style={styles.fieldValText}>{(rep.status || '').replace(/_/g, ' ')}</span>
                            </div>

                            <div style={styles.detailRowPlain}>
                              <span style={styles.fieldLabel}>Type</span>
                              <span style={styles.fieldValText}>{rep.hazard_type || rep.category}</span>
                            </div>
                            <div style={styles.detailRowPlain}>
                              <span style={styles.fieldLabel}>Severity</span>
                              <span style={getSeverityBadgeStyle(rep.severity)}>{(rep.severity || 'HIGH').toUpperCase()}</span>
                            </div>
                            <div style={styles.detailRowPlain}>
                              <span style={styles.fieldLabel}>Location</span>
                              <span style={styles.fieldValText}>{rep.location}</span>
                            </div>
                          </div>

                          {/* Google Maps Preview */}
                          <div style={styles.mapContainerBox}>
                            <span style={styles.fieldLabel}>LOCATION MAP PREVIEW (Click to open Google Maps):</span>
                            <div 
                              style={styles.gpsMapBoxInteractive} 
                              onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rep.coordinates || rep.location || '13.7565,121.0583')}`, '_blank')}
                              title="Click to open in Google Maps"
                            >
                              <iframe
                                title="Report GPS Location"
                                width="100%"
                                height="130"
                                frameBorder="0"
                                scrolling="no"
                                src={`https://maps.google.com/maps?q=${encodeURIComponent(rep.coordinates || rep.location || '13.7565,121.0583')}&t=m&z=16&ie=UTF8&iwloc=&output=embed`}
                                style={{ borderRadius: '6px', pointerEvents: 'none' }}
                              ></iframe>
                              <div style={styles.mapOverlayBadge}>Open in Google Maps &rarr;</div>
                            </div>
                          </div>

                          <div style={styles.detailSectionPlain}>
                            <span style={styles.fieldLabel}>Description</span>
                            <p style={styles.descTextPlain}>{rep.description || 'No descriptive details provided by submitter.'}</p>
                          </div>

                          <div style={styles.tagFormRow}>
                            <input
                              type="text"
                              style={styles.textInputCompact}
                              placeholder="Optional group name — leave blank for an individual ticket"
                              value={tagInputMap[rep.id] !== undefined ? tagInputMap[rep.id] : getAdminCategory(rep)}
                              onChange={(e) => setTagInputMap({ ...tagInputMap, [rep.id]: e.target.value })}
                            />
                            <button
                              style={styles.btnTagAction}
                              onClick={() => handleCategorizeReport(rep.id, tagInputMap[rep.id] !== undefined ? tagInputMap[rep.id] : getAdminCategory(rep))}
                            >
                              {tagInputMap[rep.id] ? 'Save Category' : 'Keep Individual'}
                            </button>
                          </div>

                          {photoList.length > 0 && (
                            <div style={styles.detailSectionPlain}>
                              <span style={styles.fieldLabel}>Photos ({photoList.length})</span>
                              <div style={styles.photoGalleryGrid}>
                                {photoList.map((src, idx) => (
                                  <img
                                    key={idx}
                                    src={src}
                                    alt={`Evidence ${idx + 1}`}
                                    style={styles.thumbImgFixed}
                                    onClick={() => setInspectImage(src)}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {rep.response_photo && (
                            <div style={styles.detailSectionPlain}>
                              <span style={styles.fieldLabel}>Responder hazard verification photo</span>
                              <img
                                src={rep.response_photo}
                                alt="Responder hazard verification evidence"
                                style={styles.fieldEvidenceImage}
                                onClick={() => setInspectImage(rep.response_photo)}
                              />
                            </div>
                          )}

                          {!isInProgress && (
                            <div style={styles.workflowHint}>
                              {canStartProgress
                                ? 'Mark this accepted ticket In Progress before resolving it.'
                                : 'Finish the investigation and accept this ticket before starting an active operation.'}
                            </div>
                          )}
                          {isInProgress && isResolutionOpen && (
                            <>
                              <div style={styles.proofUploadBox}>
                                <span style={styles.fieldLabel}>Resolution proof photo (required to resolve):</span>
                                <label style={styles.photoUploadDropzoneCompact}>
                                  <span style={styles.uploadTextCompact}>
                                    {reportResolutionPhoto ? 'Replace resolution photo' : 'Select on-site resolution photo'}
                                  </span>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    onChange={(e) => handlePhotoUpload(e, (b64) => setTagInputMap({ ...tagInputMap, [`photo_${rep.id}`]: b64 }))}
                                  />
                                </label>
                                {reportResolutionPhoto && (
                                  <button
                                    type="button"
                                    style={styles.resolutionPhotoPreview}
                                    onClick={() => setInspectImage(reportResolutionPhoto)}
                                  >
                                    <img src={reportResolutionPhoto} alt="Resolution proof preview" style={styles.resolutionPhotoPreviewImage} />
                                    <span>Proof attached · Click to enlarge</span>
                                  </button>
                                )}
                              </div>
                              {!reportResolutionPhoto && (
                                <div style={styles.workflowHint}>
                                  Attach a resolution photo to enable the resolve action.
                                </div>
                              )}
                            </>
                          )}

                          <div style={styles.actionRow}>
                            <button
                              type="button"
                              style={isInProgress || !canStartProgress ? styles.btnStepDisabled : styles.btnInvestigate}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleUpdateReportStatus(rep.id, 'IN_PROGRESS');
                              }}
                              disabled={!canStartProgress || isInProgress}
                            >
                              {isInProgress ? 'In Progress ✓' : 'Mark In Progress'}
                            </button>
                            {!isResolutionOpen ? (
                              <button
                                style={isInProgress ? styles.btnResolve : styles.btnStepDisabled}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (isInProgress) setResolvingTicketId(rep.id);
                                }}
                                disabled={!isInProgress}
                              >
                                Mark Resolved
                              </button>
                            ) : (
                              <>
                                <button
                                  style={styles.btnCancelAction}
                                  onClick={() => setResolvingTicketId(null)}
                                >
                                  Cancel
                                </button>
                                <button
                                  style={canMarkResolved ? styles.btnResolve : styles.btnStepDisabled}
                                  onClick={() => {
                                    if (!reportResolutionPhoto) {
                                      return showMessage('Mandatory completion photo proof required.\nPlease attach an on-site completion photo before marking this report as resolved.', 'error');
                                    }
                                    handleUpdateReportStatus(rep.id, 'RESOLVED', { progress_photo: reportResolutionPhoto });
                                  }}
                                  disabled={!canMarkResolved}
                                >
                                  Confirm Resolution
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Sub-Tab 2: Category Bulk Broadcast */}
          {activeSubTab === 'BULK' && (
            <div style={styles.sectionStack}>
              <div style={styles.bulkBoxCardCenter}>
                <h4 style={styles.bulkFormTitle}>Category Bulk Operations & Broadcast</h4>
                <p style={styles.bulkFormSub}>Send the same update to all active tickets in a category. Tickets without an admin-assigned category remain individual.</p>

                <label style={styles.fieldLabel}>1. SELECT ACTIVE CATEGORY GROUP:</label>
                {activeCategoriesList.length === 0 ? (
                  <div style={styles.noticeTextSmall}>
                    No active categories tagged yet. Tag active reports in the Active Tracker to enable bulk updates.
                  </div>
                ) : (
                  <select
                    style={styles.selectInput}
                    value={selectedBulkCategory}
                    onChange={(e) => setSelectedBulkCategory(e.target.value)}
                  >
                    <option value="">-- Choose Category Group --</option>
                    {activeCategoriesList.map((cat) => {
                      const count = activeTrackerReports.filter(
                        (r) => getAdminCategory(r).toUpperCase() === cat.toUpperCase()
                      ).length;
                      return (
                        <option key={cat} value={cat}>
                          {cat} ({count} active reports)
                        </option>
                      );
                    })}
                  </select>
                )}

                <label style={styles.fieldLabel}>2. SET PROGRESS STAGE FOR GROUP:</label>
                <select
                  style={styles.selectInput}
                  value={bulkStatus}
                  onChange={(e) => {
                    setBulkStatus(e.target.value);
                    if (e.target.value !== 'RESOLVED') setBulkPhoto(null);
                  }}
                >
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="RESOLVED">Resolved</option>
                </select>

                <div style={styles.labelRowBetween}>
                  <label style={styles.fieldLabel}>Message to affected devices</label>
                  <button
                    type="button"
                    style={styles.btnAutoNotice}
                    onClick={() => {
                      if (selectedBulkCategory && bulkStatus) {
                        const matchingCount = activeTrackerReports.filter(
                          (r) => getAdminCategory(r).toUpperCase() === selectedBulkCategory.trim().toUpperCase()
                        ).length;
                        const autoText = generateAutomatedDirectiveNotice(selectedBulkCategory, bulkStatus, matchingCount);
                        setBulkNotice(autoText);
                      }
                    }}
                  >
                    Auto-Generate Direct Notice
                  </button>
                </div>

                <textarea
                  style={styles.textareaInput}
                  rows="3"
                  placeholder="Write the update to send to reporters in this category..."
                  value={bulkNotice}
                  onChange={(e) => setBulkNotice(e.target.value)}
                ></textarea>

                {bulkStatus === 'RESOLVED' && (
                  <>
                    <label style={styles.fieldLabel}>Resolution proof photo (required)</label>
                    <label style={styles.photoUploadDropzone}>
                      <span style={styles.uploadText}>{bulkPhoto ? '✓ Resolution Photo Attached' : '+ Upload Resolution Photo'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => handlePhotoUpload(e, (b64) => setBulkPhoto(b64))}
                      />
                    </label>

                    {bulkPhoto && (
                      <div style={styles.previewPhotoBox}>
                        <img src={bulkPhoto} alt="Resolution proof preview" style={styles.previewThumbImg} />
                      </div>
                    )}
                  </>
                )}

                {bulkStatus === 'RESOLVED' && selectedBulkCategory && !selectedBulkAllInProgress && (
                  <div style={styles.workflowHint}>
                    Move every ticket in this category to In Progress before resolving the group.
                  </div>
                )}
                {bulkStatus === 'RESOLVED' && selectedBulkAllInProgress && !bulkPhoto && (
                  <div style={styles.workflowHint}>
                    Upload a resolution proof photo to enable group resolution.
                  </div>
                )}

                <button
                  style={bulkStatus === 'RESOLVED' && (!selectedBulkAllInProgress || !bulkPhoto) ? styles.btnBulkDisabled : styles.btnBulkSubmit}
                  onClick={handleBulkBroadcast}
                  disabled={!selectedBulkCategory || (bulkStatus === 'RESOLVED' && (!selectedBulkAllInProgress || !bulkPhoto))}
                >
                  Broadcast Update to Category Group
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODULE 3: USER MANAGEMENT & MODERATION */}
      {currentView === 'USER_HANDLING' && (
        <div style={styles.sectionStack}>
          <div style={styles.subTabContainer}>
            <button
              style={userSubTab === 'VERIFIED' ? styles.subTabBtnActive : styles.subTabBtnInactive}
              onClick={() => setUserSubTab('VERIFIED')}
            >
              Verified Citizens ({verifiedCitizens.length})
            </button>
            <button
              style={userSubTab === 'GUEST' ? styles.subTabBtnActive : styles.subTabBtnInactive}
              onClick={() => setUserSubTab('GUEST')}
            >
              Guest Devices ({guestUsers.length})
            </button>
            <button
              style={userSubTab === 'REQUESTS' ? styles.subTabBtnActive : styles.subTabBtnInactive}
              onClick={() => setUserSubTab('REQUESTS')}
            >
              Unverified Profiles ({pendingVerificationRequests.length})
            </button>
            <button
              style={userSubTab === 'MODERATED' ? styles.subTabBtnActive : styles.subTabBtnInactive}
              onClick={() => setUserSubTab('MODERATED')}
            >
              Restricted Users ({moderatedUsers.length})
            </button>
          </div>

          {/* Sub-Tab 1: Verified Citizens */}
          {userSubTab === 'VERIFIED' && (
            <div style={styles.sectionStack}>
              {verifiedCitizens.length === 0 ? (
                <div style={styles.emptyCard}>No verified citizen accounts found.</div>
              ) : (
                verifiedCitizens.map((user) => {
                  return (
                    <div key={user.id || user.device_id} style={styles.userCardRow}>
                      <div style={styles.userLeftBox}>
                        <div style={styles.userIdentity}>
                          <div style={styles.userIdentityTop}>
                            <div style={styles.userNameText}>@{user.username || user.full_name || 'Verified Resident'}</div>
                            <span style={styles.badgeGreen}>SMS ELIGIBLE</span>
                          </div>
                          <div style={styles.userSummaryDevice}>Device ID: {user.device_id || 'Not provided'}</div>
                        </div>
                      </div>
                      <div style={styles.userRightActionRow}>
                        <button style={styles.btnViewUser} onClick={() => handleOpenUserDetails(user)}>View Details</button>
                        <div style={styles.userModerationActions}>
                          <button style={styles.btnWarn} onClick={() => openModerationForm(user, 'PENALIZED')}>Penalty</button>
                          <button style={styles.btnBan} onClick={() => openModerationForm(user, 'BANNED')}>Ban</button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Sub-Tab 2: Guest Devices */}
          {userSubTab === 'GUEST' && (
            <div style={styles.sectionStack}>
              {guestUsers.length === 0 ? (
                <div style={styles.emptyCard}>No guest device accounts found.</div>
              ) : (
                guestUsers.map((user) => {
                  return (
                    <div key={user.device_id || user.id} style={styles.userCardRow}>
                      <div style={styles.userLeftBox}>
                        <div style={styles.userIdentity}>
                          <div style={styles.userIdentityTop}>
                            <div style={styles.userNameText}>{user.username || 'Guest Device'}</div>
                            <span style={styles.badgeTeal}>GUEST</span>
                          </div>
                          <div style={styles.userSummaryDevice}>Device ID: {user.device_id || 'DEV-UNKNOWN'}</div>
                        </div>
                      </div>
                      <div style={styles.userRightActionRow}>
                        <button style={styles.btnViewUser} onClick={() => handleOpenUserDetails(user)}>View Details</button>
                        <div style={styles.userModerationActions}>
                          <button style={styles.btnWarn} onClick={() => openModerationForm(user, 'PENALIZED')}>Penalty</button>
                          <button style={styles.btnBan} onClick={() => openModerationForm(user, 'BANNED')}>Ban</button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {userSubTab === 'MODERATED' && (
            <div style={styles.sectionStack}>
              {moderatedUsers.length === 0 ? (
                <div style={styles.emptyCard}>No active penalties or bans.</div>
              ) : (
                moderatedUsers.map((user) => {
                  const restriction = getModerationRestriction(user);
                  const isBanned = restriction?.kind === 'BANNED';
                  return (
                    <div key={user.device_id || user.id} style={styles.userCardRow}>
                      <div style={styles.userIdentity}>
                        <div style={styles.userIdentityTop}>
                          <div style={styles.userNameText}>{user.username || user.full_name || 'Device User'}</div>
                          <span style={isBanned ? styles.badgeRed : styles.badgeOrange}>
                            {isBanned ? 'BANNED' : 'PENALIZED'}
                          </span>
                        </div>
                        <div style={styles.userSummaryDevice}>Device ID: {user.device_id || 'Not provided'}</div>
                        {!isBanned && user.penalty_until && (
                          <div style={styles.userSummaryDevice}>Report access resumes: {new Date(user.penalty_until).toLocaleString()}</div>
                        )}
                        {user.moderation_message && (
                          <div style={styles.dispatchOutcomeNotes}>{user.moderation_message}</div>
                        )}
                      </div>
                      <div style={styles.userRightActionRow}>
                        <button style={styles.btnViewUser} onClick={() => handleOpenUserDetails(user)}>View Details</button>
                        <div style={styles.userModerationActions}>
                          {!isBanned && (
                            <button style={styles.btnBan} onClick={() => openModerationForm(user, 'BANNED')}>Ban</button>
                          )}
                          <button style={styles.btnWarn} onClick={() => handleLiftModeration(user)}>
                            {isBanned ? 'Lift Ban' : 'Lift Penalty'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Sub-Tab 3: Verification Queue */}
          {userSubTab === 'REQUESTS' && (
            <div style={styles.sectionStack}>
              {pendingVerificationRequests.length === 0 ? (
                <div style={styles.emptyCard}>No pending identity verification requests in queue.</div>
              ) : (
                pendingVerificationRequests.map((req) => (
                  <div key={req.id || req.device_id} style={styles.verificationCard}>
                    <div style={styles.userIdentityTop}>
                      <h4 style={styles.userRequestName}>@{req.username || 'Resident Applicant'}</h4>
                      <span style={(req.verification_status || 'PENDING').toUpperCase() === 'PENDING' ? styles.badgeOrange : styles.badgeRed}>
                        {(req.verification_status || 'PENDING').toUpperCase()} VERIFICATION
                      </span>
                    </div>
                    <div style={styles.userSummaryDevice}>Device ID: {req.device_id || 'Not provided'}</div>

                    <div style={styles.userRightActionRow}>
                      <button
                        style={styles.btnViewUser}
                        onClick={() => handleOpenUserDetails(req)}
                      >
                        View Details
                      </button>
                      <div style={styles.userModerationActions}>
                        <button
                          style={styles.btnApproveUser}
                          onClick={() => handleUpdateUserStatus(req.device_id, 'VERIFIED')}
                        >
                          Approve & Verify
                        </button>
                        <button
                          style={styles.btnRejectUser}
                          onClick={() => handleUpdateUserStatus(req.device_id, 'REJECTED', 'ID Proof rejected')}
                        >
                          Reject
                        </button>
                        <button
                          style={styles.btnWarn}
                          onClick={() => openModerationForm(req, 'PENALIZED')}
                        >
                          Penalty
                        </button>
                        <button
                          style={styles.btnBan}
                          onClick={() => openModerationForm(req, 'BANNED')}
                        >
                          Ban
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* MODULE 4: TRANSMITTAL MEMOS */}
      {currentView === 'DOCUMENT_GENERATOR' && (
        <div style={styles.sectionStack}>
          <div style={styles.subTabContainer}>
            <button
              style={memoSubTab === 'PART1' ? styles.subTabBtnActive : styles.subTabBtnInactive}
              onClick={() => setMemoSubTab('PART1')}
            >
              1. Incident Tickets & Groups
            </button>
            <button
              style={memoSubTab === 'PART2' ? styles.subTabBtnActive : styles.subTabBtnInactive}
              onClick={() => setMemoSubTab('PART2')}
            >
              2. Memo Preview & Export
            </button>
          </div>

          {/* PART 1: Selection Lists */}
          {memoSubTab === 'PART1' && (
            <div style={styles.sectionStack}>
              {/* Section A: Categorized Groups */}
              <div style={styles.sectionSubTitle}>CATEGORIZED INCIDENT GROUPS ({categoryGroups.length})</div>
              {categoryGroups.length === 0 ? (
                <div style={styles.emptyCard}>No category groups created yet. Tag reports in Active Operations to form groups.</div>
              ) : (
                categoryGroups.map((group) => {
                  const isExpanded = expandedGroupId === group.id;
                  return (
                    <div key={group.id} style={styles.memoSelectionCard} onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}>
                      <div style={styles.memoSelectionHeader}>
                        <span style={styles.memoSelectionTitle}>{group.category}</span>
                        <span style={styles.badgeTeal}>{group.reports.length} Reports</span>
                      </div>
                      <p style={styles.memoSelectionMeta}>Locations: {group.locations.join(', ') || 'Batangas City'}</p>

                      {isExpanded && (
                        <div style={styles.accordionDetailBox} onClick={(e) => e.stopPropagation()}>
                          <div style={styles.subTitleSmall}>Tickets in this group</div>
                          {group.reports.map((r, i) => (
                            <div key={r.id} style={styles.memoTicketRow}>
                              <span style={styles.memoTicketLabel}>{group.category} #{i + 1}</span>
                              <span style={styles.memoTicketText}>Ticket {formatTicketReference(r.id || r.ticket_no)} · {r.hazard_type || r.category || 'Hazard'}</span>
                              <span style={styles.memoTicketLocation}>{r.location || 'Location not provided'}</span>
                            </div>
                          ))}
                          <div style={styles.memoActionBox}>
                            <button
                              style={styles.btnMakeMemoPrimary}
                              onClick={() => handlePrepareMemo(group, true)}
                            >
                              Make a Memo for {group.category}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {/* Section B: Uncategorized Individual Tickets */}
              <div style={styles.sectionSubTitle}>UNCATEGORIZED INDIVIDUAL TICKETS ({uncategorizedReports.length})</div>
              {uncategorizedReports.length === 0 ? (
                <div style={styles.emptyCard}>All incident reports have been categorized into groups.</div>
              ) : (
                uncategorizedReports.map((rep) => {
                  const isExpanded = expandedTicketId === rep.id;
                  return (
                    <div key={rep.id} style={styles.memoSelectionCard} onClick={() => setExpandedTicketId(isExpanded ? null : rep.id)}>
                      <div style={styles.memoSelectionHeader}>
                        <span style={styles.ticketBadge}>{formatTicketReference(rep.id || rep.ticket_no)}</span>
                        <span style={styles.badgeOrange}>{rep.status}</span>
                      </div>

                      <h4 style={styles.itemTitle}>{rep.hazard_type || rep.category}</h4>
                      <p style={styles.memoSelectionMeta}>Location: {rep.location || 'Not provided'}</p>

                      {isExpanded && (
                        <div style={styles.accordionDetailBox} onClick={(e) => e.stopPropagation()}>
                          <p style={styles.memoDescText}>"{rep.description || 'Verified hazard entry.'}"</p>
                          <div style={styles.memoActionBox}>
                            <button
                              style={styles.btnMakeMemoPrimary}
                              onClick={() => handlePrepareMemo(rep)}
                            >
                              Make a Memo for {formatTicketReference(rep.id || rep.ticket_no)}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* PART 2: Memo Document Preview & Export */}
          {memoSubTab === 'PART2' && (
            <div style={styles.memoPreviewStack}>
              {(selectedMemoCategoryGroup || selectedMemoReport) ? (
                <div>
                  <div style={styles.memoPrintHeaderAction}>
                    <span style={styles.memoPrintNoticeText}>
                      Formal Document Preview ready for official print/export ({selectedMemoCategoryGroup ? selectedMemoCategoryGroup.category : formatTicketReference(selectedMemoReport.id || selectedMemoReport.ticket_no)})
                    </span>
                    <div style={styles.iconBtnRow}>
                      <button style={styles.iconBtnPrint} title="Print / Export PDF Memorandum" onClick={handlePrintDocument}>Print / Export PDF</button>
                      <button style={styles.iconBtnDownloadDoc} title="Download Editable Document (.doc)" onClick={handleDownloadDocxTemplate}>Download .doc</button>
                    </div>
                  </div>

                  {/* Printable Memorandum Paper */}
                  <div style={styles.officialMemoPaper}>
                    <div style={styles.memoHeaderSeal}>
                      <div style={styles.memoRepTitle}>REPUBLIC OF THE PHILIPPINES</div>
                      <div style={styles.memoProvinceTitle}>PROVINCE OF BATANGAS • CITY OF BATANGAS</div>
                      <div style={styles.memoDeptTitle}>CITY DISASTER RISK REDUCTION AND MANAGEMENT OFFICE (CDRRMO)</div>
                      <div style={styles.memoCenterSub}>BATANGAS COMMAND CENTER • INCIDENT ENDORSEMENT NETWORK</div>
                      <div style={styles.memoDividerLine}></div>
                    </div>

                    <div style={styles.memoMetaTable}>
                      <div style={styles.memoMetaRow}><strong>MEMORANDUM REF NO</strong><span>MEMO-AGAP-2026-{(selectedMemoCategoryGroup ? selectedMemoCategoryGroup.id : (selectedMemoReport.id || '001')).toString().replace('#', '')}</span></div>
                      <div style={styles.memoMetaRow}><strong>DATE & TIMESTAMP</strong><span>{new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
                      <div style={styles.memoMetaRow}><strong>FROM</strong><span>CDRRMO Incident Operations Coordinator, Project AGAP Portal</span></div>
                      <div style={styles.memoMetaRow}><strong>SUBJECT</strong><span style={{ fontWeight: '700' }}>IMMEDIATE RESPONSE REQUEST: {selectedMemoCategoryGroup ? selectedMemoCategoryGroup.category : (selectedMemoReport.hazard_type || selectedMemoReport.category)}</span></div>
                    </div>

                    <div style={styles.memoSectionHeading}>I. INCIDENT SPECIFICATION & CITIZEN REPORT SUMMARY</div>
                    <table style={styles.formalTable}>
                      <tbody>
                        <tr><td style={styles.tableLabelCell}>Category / Hazard Title:</td><td style={styles.tableValCell}>{selectedMemoCategoryGroup ? selectedMemoCategoryGroup.category : (selectedMemoReport.hazard_type || selectedMemoReport.category)}</td></tr>
                        <tr><td style={styles.tableLabelCell}>Compiled Report Count:</td><td style={styles.tableValCell}>{selectedMemoCategoryGroup ? `${selectedMemoCategoryGroup.reports.length} Compiled Citizen Reports` : '1 Individual Report'}</td></tr>
                        <tr><td style={styles.tableLabelCell}>Severity & Action Window:</td><td style={styles.tableValCell}>HIGH / URGENT - Action Required Within 24 Hours</td></tr>
                        <tr><td style={styles.tableLabelCell}>Location Sector / Landmarks:</td><td style={styles.tableValCell}>{selectedMemoCategoryGroup ? selectedMemoCategoryGroup.locations.join(', ') : selectedMemoReport.location}</td></tr>
                        <tr><td style={styles.tableLabelCell}>AGAP Investigation Status:</td><td style={styles.tableValCell}>Investigated, field-verified, and accepted for authority response</td></tr>
                      </tbody>
                    </table>

                    <div style={styles.memoSectionHeading}>II. AGAP INVESTIGATION & INCIDENT DETAILS</div>
                    <div style={styles.memoDescriptionBox}>
                      {selectedMemoCategoryGroup ? (
                        selectedMemoCategoryGroup.reports.map((r) => (
                          <div key={r.id} style={styles.memoReportEntry}>
                            <div style={styles.memoReportEntryTitle}>Ticket {formatTicketReference(r.id || r.ticket_no)} · {r.hazard_type || r.category || 'Incident'}</div>
                            <div style={styles.memoReportEntryText}>{r.description || 'No additional citizen description was provided.'}</div>
                            <div style={styles.memoReportEntryLocation}>Location: {r.location || 'Not provided'}</div>
                          </div>
                        ))
                      ) : (
                        <div style={styles.memoReportEntry}>
                          <div style={styles.memoReportEntryTitle}>Ticket {formatTicketReference(selectedMemoReport.id || selectedMemoReport.ticket_no)} · {selectedMemoReport.hazard_type || selectedMemoReport.category}</div>
                          <div style={styles.memoReportEntryText}>{selectedMemoReport.description || 'No additional citizen description was provided.'}</div>
                          <div style={styles.memoReportEntryLocation}>Location: {selectedMemoReport.location || 'Not provided'}</div>
                        </div>
                      )}
                    </div>

                    {/* Section III: Exhibit Photos */}
                    <div style={styles.memoSectionHeading}>III. CITIZEN AND FIELD-VERIFICATION PHOTOGRAPHIC EVIDENCE</div>
                    {selectedMemoPhotos.length > 0 ? (
                      <div style={styles.memoPhotoGrid}>
                        {selectedMemoPhotos.map((src, i) => (
                          <div key={i} style={styles.exhibitPhotoCard}>
                            <img src={src} alt={`Exhibit ${i + 1}`} style={styles.memoThumbImgFixed} />
                            <div style={styles.exhibitTag}>EXHIBIT PROOF #{i + 1}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={styles.noPhotoNoticeBox}>[NOTICE: Incident report filed without initial photographic evidence.]</div>
                    )}

                    <div style={styles.memoSectionHeading}>IV. IMMEDIATE RESPONSE REQUEST</div>
                    <p style={styles.memoDirectiveText}>
                      Project AGAP has reviewed the citizen report, completed the investigation, and accepted the reported hazard for response. The attached citizen-submitted and responder field-verification photographs document the reported condition. We respectfully request an immediate on-site assessment and appropriate action by the responsible authority. Please acknowledge receipt and provide a response update for community safety.
                    </p>

                    <div style={styles.signatureRow}>
                      <div style={styles.sigBlock}>
                        <div style={styles.sigLine}></div>
                        <div style={styles.sigName}>CDRRMO COMMAND OFFICER</div>
                        <div style={styles.sigTitle}>Project AGAP Operations Portal</div>
                      </div>
                      <div style={styles.sigBlock}>
                        <div style={styles.sigLine}></div>
                        <div style={styles.sigName}>RECIPIENT RECEIVING OFFICER</div>
                        <div style={styles.sigTitle}>Signature & Date / Time Received</div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={styles.emptyCard}>
                  Please select a Category Group or Individual Ticket in Part 1 and click <strong>"Make a Memo"</strong> to view its formal document preview.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* MODULE 5: RESOLVED INCIDENT ARCHIVE */}
      {currentView === 'RESOLVED_ARCHIVE' && (
        <div style={styles.sectionStack}>
          <div style={styles.subTabContainer}>
            <button
              style={resolvedSubTab === 'ALL' ? styles.subTabBtnActive : styles.subTabBtnInactive}
              onClick={() => setResolvedSubTab('ALL')}
            >
              Resolved Tickets ({resolvedReports.length})
            </button>
            <button
              style={resolvedSubTab === 'REJECTED' ? styles.subTabBtnActive : styles.subTabBtnInactive}
              onClick={() => setResolvedSubTab('REJECTED')}
            >
              Rejected Archive ({rejectedDataReports.length})
            </button>
          </div>

          {resolvedSubTab === 'ALL' && (
            <div style={styles.sectionStack}>
              {resolvedReports.length === 0 ? (
                <div style={styles.emptyCard}>No resolved tickets have been archived yet.</div>
              ) : (
                resolvedReports.map((rep) => {
                  const submitter = getSubmitterInfo(rep, profiles);
                  const isExpanded = expandedArchiveTicketId === rep.id;
                  return (
                    <div key={rep.id} style={styles.itemCardAccordion} onClick={() => setExpandedArchiveTicketId(isExpanded ? null : rep.id)}>
                      <div style={styles.cardHeaderRow}>
                        <div style={styles.headerTitleGroup}>
                          <span style={styles.ticketBadge}>Ticket {formatTicketReference(rep.ticket_no || rep.id)}</span>
                          <span style={styles.badgeGreen}>Resolved</span>
                        </div>
                        <span style={styles.userMetaText}>Device ID: {submitter.deviceId}</span>
                      </div>
                      <h4 style={styles.itemTitle}>{rep.hazard_type || 'Hazard report'}</h4>
                      {!isExpanded ? (
                        <div style={styles.expandHintText}>Open ticket details and evidence &rarr;</div>
                      ) : (
                        <div style={styles.accordionDetailBox} onClick={(event) => event.stopPropagation()}>
                          {renderArchiveTicketDetails(rep, submitter)}
                          {rep.progress_photo && (
                            <div style={styles.detailSectionPlain}>
                              <span style={styles.fieldLabel}>Resolution photo</span>
                              <div style={styles.photoGalleryGrid}>
                                <img src={rep.progress_photo} alt="Resolution proof" style={styles.thumbImgFixed} onClick={() => setInspectImage(rep.progress_photo)} />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {resolvedSubTab === 'REJECTED' && (
            <div style={styles.sectionStack}>
              <div style={styles.archiveHeaderRow}>
                <span style={styles.archiveNoticeText}>Rejected reports remain stored until restored or permanently deleted.</span>
                <button style={styles.btnPurgeAll} onClick={handlePurgeAllRejectedData}>
                  Delete All Rejected Tickets
                </button>
              </div>
              {rejectedDataReports.length === 0 ? (
                <div style={styles.emptyCard}>No rejected tickets are archived.</div>
              ) : (
                rejectedDataReports.map((rep) => {
                  const submitter = getSubmitterInfo(rep, profiles);
                  const isExpanded = expandedArchiveTicketId === rep.id;
                  return (
                    <div key={rep.id} style={styles.itemCardAccordion} onClick={() => setExpandedArchiveTicketId(isExpanded ? null : rep.id)}>
                      <div style={styles.cardHeaderRow}>
                        <span style={styles.ticketBadge}>Ticket {formatTicketReference(rep.ticket_no || rep.id)}</span>
                        <span style={styles.badgeRed}>{(rep.status || 'REJECTED').replace(/_/g, ' ')}</span>
                      </div>
                      <h4 style={styles.itemTitle}>{rep.hazard_type || rep.category || 'Hazard Incident Report'}</h4>
                      {!isExpanded ? (
                        <div style={styles.expandHintText}>Open ticket details and submitted evidence &rarr;</div>
                      ) : (
                        <div style={styles.accordionDetailBox} onClick={(event) => event.stopPropagation()}>
                          {renderArchiveTicketDetails(rep, submitter)}
                          <div style={styles.actionRow}>
                            <button
                              style={styles.btnRestore}
                              onClick={() => handleRestoreRejectedReport(rep.id)}
                            >
                              Restore to Submitted Queue
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Sub-Tab 1: Categorized Resolved Groups */}
          {resolvedSubTab === 'GROUPS' && (
            <div style={styles.sectionStack}>
              {resolvedCategoryGroups.length === 0 ? (
                <div style={styles.emptyCard}>No categorized resolved hazard groups yet.</div>
              ) : (
                resolvedCategoryGroups.map((group) => {
                  const isExpanded = expandedGroupId === group.id;
                  return (
                    <div key={group.id} style={styles.itemCardAccordion} onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}>
                      <div style={styles.cardHeaderRow}>
                        <span style={styles.ticketBadge}>{group.category.toUpperCase()} GROUP</span>
                        <span style={styles.badgeGreen}>✓ {group.reports.length} Resolved Tickets</span>
                      </div>

                      <p style={styles.itemMeta}>Locations Sector: {group.locations.join(', ') || 'Batangas City'}</p>

                      {!isExpanded ? (
                        <div style={styles.expandHintText}>Click to expand compiled resolved tickets & photo proof &rarr;</div>
                      ) : (
                        <div style={styles.accordionDetailBox} onClick={(e) => e.stopPropagation()}>
                          <div style={styles.subTitleSmall}>RESOLVED TICKETS IN THIS CATEGORY:</div>
                          {group.reports.map((r, idx) => {
                            const submitter = getSubmitterInfo(r, profiles);
                            const rPhotos = parsePhotos(r.proof_photos || r.photos);
                            return (
                              <div key={r.id} style={styles.resolvedSubTicketCard}>
                                <div style={styles.cardHeaderRow}>
                                  <span style={styles.badgeTeal}>{group.category.toUpperCase()} #{idx + 1}</span>
                                  <span style={styles.ticketBadge}>#{r.id || r.ticket_no}</span>
                                </div>
                                <h4 style={styles.itemTitle}>{r.hazard_type || r.category}</h4>
                                <p style={styles.itemMeta}>Location: {r.location}</p>

                                <div style={styles.detailGridPlain}>
                                  <div style={styles.detailRowPlain}>
                                    <span style={styles.fieldLabel}>SUBMITTER IDENTIFICATION:</span>
                                    <span style={styles.fieldValText}>Device ID: {submitter.deviceId}</span>
                                  </div>
                                  <div style={styles.detailRowPlain}>
                                    <span style={styles.fieldLabel}>SITUATION DESCRIPTION:</span>
                                    <span style={styles.fieldValText}>{r.description || 'Verified hazard entry.'}</span>
                                  </div>
                                  {r.assigned_responder && (
                                    <div style={styles.detailRowPlain}>
                                      <span style={styles.fieldLabel}>RESOLVING RESPONDER UNIT:</span>
                                      <span style={styles.fieldValText}>{r.assigned_responder}</span>
                                    </div>
                                  )}
                                </div>

                                {rPhotos.length > 0 && (
                                  <div style={styles.detailSectionPlain}>
                                    <span style={styles.fieldLabel}>INITIAL EVIDENCE PHOTOS ({rPhotos.length}):</span>
                                    <div style={styles.photoGalleryGrid}>
                                      {rPhotos.map((src, i) => (
                                        <img key={i} src={src} alt="Initial Evidence" style={styles.thumbImgFixed} onClick={() => setInspectImage(src)} />
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {r.progress_photo && (
                                  <div style={styles.detailSectionPlain}>
                                    <span style={styles.fieldLabel}>✓ ON-SITE RESOLUTION PHOTO PROOF:</span>
                                    <div style={styles.photoGalleryGrid}>
                                      <img src={r.progress_photo} alt="Resolution Proof" style={styles.thumbImgFixed} onClick={() => setInspectImage(r.progress_photo)} />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Sub-Tab 2: Uncategorized Resolved Tickets */}
          {resolvedSubTab === 'UNCATEGORIZED' && (
            <div style={styles.sectionStack}>
              {resolvedUncategorizedReports.length === 0 ? (
                <div style={styles.emptyCard}>No uncategorized resolved tickets found.</div>
              ) : (
                resolvedUncategorizedReports.map((rep) => {
                  const isExpanded = expandedTicketId === rep.id;
                  const photoList = parsePhotos(rep.proof_photos || rep.photos);
                  const submitter = getSubmitterInfo(rep, profiles);
                  return (
                    <div key={rep.id} style={styles.itemCardAccordion} onClick={() => setExpandedTicketId(isExpanded ? null : rep.id)}>
                      <div style={styles.cardHeaderRow}>
                        <div style={styles.headerTitleGroup}>
                          <span style={styles.ticketBadge}>{rep.id || rep.ticket_no}</span>
                          <span style={styles.badgeGreen}>RESOLVED</span>
                        </div>
                        <span style={styles.userMetaText}>Device ID: {submitter.deviceId}</span>
                      </div>

                      <h4 style={styles.itemTitle}>{rep.hazard_type || rep.category || 'Hazard Incident Report'}</h4>

                      {!isExpanded ? (
                        <div style={styles.expandHintText}>Click to expand resolved ticket details & photo proof &rarr;</div>
                      ) : (
                        <div style={styles.accordionDetailBox} onClick={(e) => e.stopPropagation()}>
                          <div style={styles.detailGridPlain}>
                            <div style={styles.detailRowPlain}>
                              <span style={styles.fieldLabel}>HAZARD / ISSUE TYPE:</span>
                              <span style={styles.fieldValText}>{rep.hazard_type || rep.category}</span>
                            </div>
                            <div style={styles.detailRowPlain}>
                              <span style={styles.fieldLabel}>LOCATION LANDMARK:</span>
                              <span style={styles.fieldValText}>{rep.location}</span>
                            </div>
                            <div style={styles.detailRowPlain}>
                              <span style={styles.fieldLabel}>SUBMITTER IDENTIFICATION:</span>
                              <span style={styles.fieldValText}>Device ID: {submitter.deviceId}</span>
                            </div>
                            {rep.assigned_responder && (
                              <div style={styles.detailRowPlain}>
                                <span style={styles.fieldLabel}>RESOLVED BY UNIT:</span>
                                <span style={styles.fieldValText}>{rep.assigned_responder}</span>
                              </div>
                            )}
                          </div>

                          <div style={styles.detailSectionPlain}>
                            <span style={styles.fieldLabel}>SITUATION DESCRIPTION:</span>
                            <p style={styles.descTextPlain}>{rep.description || 'No descriptive details provided.'}</p>
                          </div>

                          {photoList.length > 0 && (
                            <div style={styles.detailSectionPlain}>
                              <span style={styles.fieldLabel}>ATTACHED EVIDENCE PHOTOS ({photoList.length}):</span>
                              <div style={styles.photoGalleryGrid}>
                                {photoList.map((src, idx) => (
                                  <img key={idx} src={src} alt="Evidence" style={styles.thumbImgFixed} onClick={() => setInspectImage(src)} />
                                ))}
                              </div>
                            </div>
                          )}

                          {rep.progress_photo && (
                            <div style={styles.detailSectionPlain}>
                              <span style={styles.fieldLabel}>✓ ON-SITE RESOLUTION PHOTO PROOF:</span>
                              <div style={styles.photoGalleryGrid}>
                                <img src={rep.progress_photo} alt="Resolution Proof" style={styles.thumbImgFixed} onClick={() => setInspectImage(rep.progress_photo)} />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {selectedUser && (
        <div style={styles.modalOverlay} onClick={handleCloseUserDetails}>
          <div style={styles.userDetailsModal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.userDetailsHeader}>
              <div style={styles.userIdentity}>
                <h3 style={styles.userDetailsTitle}>@{selectedUser.username || selectedUser.full_name || 'Guest Device'}</h3>
                <div style={styles.userMetaText}>Device ID: {selectedUser.device_id || 'Not provided'}</div>
              </div>
              <span style={(selectedUser.verification_status || 'GUEST').toUpperCase() === 'VERIFIED' ? styles.badgeGreen : styles.badgeTeal}>
                {(selectedUser.verification_status || 'GUEST').replace(/_/g, ' ')}
              </span>
              <button style={styles.modalCloseBtn} onClick={handleCloseUserDetails}>Close</button>
            </div>
            <div style={styles.userDetailsSection}>
              <div style={styles.userDetailsSectionTitle}>Profile details</div>
              <div style={styles.userDetailsGrid}>
                <div style={styles.userDetailsItem}><span style={styles.userDetailsLabel}>Username</span><span style={styles.userDetailsValue}>{selectedUser.username || 'Not provided'}</span></div>
                <div style={styles.userDetailsItem}><span style={styles.userDetailsLabel}>Full name</span><span style={styles.userDetailsValue}>{selectedUser.full_name || 'Not provided'}</span></div>
                <div style={styles.userDetailsItem}><span style={styles.userDetailsLabel}>Phone</span><span style={styles.userDetailsValue}>{selectedUser.phone_number || selectedUser.phone || 'Not provided'}</span></div>
                <div style={styles.userDetailsItem}><span style={styles.userDetailsLabel}>Barangay</span><span style={styles.userDetailsValue}>{selectedUser.barangay || 'Not provided'}</span></div>
                <div style={styles.userDetailsItem}><span style={styles.userDetailsLabel}>Device ID</span><span style={styles.userDetailsValue}>{selectedUser.device_id || 'Not provided'}</span></div>
                <div style={styles.userDetailsItem}><span style={styles.userDetailsLabel}>Verification status</span><span style={styles.userDetailsValue}>{selectedUser.verification_status || 'GUEST'}</span></div>
                <div style={styles.userDetailsItem}><span style={styles.userDetailsLabel}>Account role</span><span style={styles.userDetailsValue}>{selectedUser.user_role || 'Resident device'}</span></div>
                <div style={styles.userDetailsItem}><span style={styles.userDetailsLabel}>Submitted reports</span><span style={styles.userDetailsValue}>{selectedUserReports.length}</span></div>
              </div>
            </div>
            {selectedUser.id_proof_photo && (
              <div style={styles.idPhotoContainer}>
                <span style={styles.fieldLabel}>IDENTITY / RESIDENCY PROOF</span>
                <img
                  src={selectedUser.id_proof_photo}
                  alt="User identity proof"
                  style={styles.idProofImg}
                  onClick={() => {
                    handleCloseUserDetails();
                    setInspectImage(selectedUser.id_proof_photo);
                  }}
                />
              </div>
            )}
            <div style={styles.userReportsSection}>
              <div style={styles.userReportsSectionTitle}>Submitted reports ({selectedUserReports.length})</div>
              {selectedUserReports.length === 0 ? (
                <div style={styles.userReportEmpty}>No reports have been submitted from this account.</div>
              ) : (
                selectedUserReports.map((report, index) => {
                  const reportPhotos = parsePhotos(report.proof_photos || report.photos);
                  const reportKey = report.id || report.ticket_no || `user-report-${index}`;
                  const isReportExpanded = expandedUserReportId === reportKey;
                  return (
                    <div key={reportKey} style={styles.userReportCard}>
                      <button
                        type="button"
                        style={styles.userReportToggle}
                        aria-expanded={isReportExpanded}
                        onClick={() => setExpandedUserReportId(isReportExpanded ? null : reportKey)}
                      >
                        <span style={styles.userReportToggleHeader}>
                          <span style={styles.ticketBadge}>Ticket {formatTicketReference(report.ticket_no || report.id)}</span>
                          <span style={styles.userReportStatus}>{(report.status || 'PENDING').replace(/_/g, ' ')}</span>
                        </span>
                        <span style={styles.userReportTitle}>{report.hazard_type || 'Hazard report'}</span>
                        <span style={styles.userReportToggleHint}>{isReportExpanded ? 'Hide ticket details ↑' : 'View ticket details →'}</span>
                      </button>
                      {isReportExpanded && (
                        <>
                          <div style={styles.userReportFields}>
                            <div style={styles.userReportField}><span style={styles.userDetailsLabel}>Category</span><span style={styles.userDetailsValue}>{getAdminCategory(report) || 'Individual ticket'}</span></div>
                            <div style={styles.userReportField}><span style={styles.userDetailsLabel}>Severity</span><span style={styles.userDetailsValue}>{(report.severity || 'HIGH').toUpperCase()}</span></div>
                            <div style={styles.userReportField}><span style={styles.userDetailsLabel}>Location</span><span style={styles.userDetailsValue}>{report.location || 'Not provided'}</span></div>
                            <div style={styles.userReportField}><span style={styles.userDetailsLabel}>Coordinates</span><span style={styles.userDetailsValue}>{report.coordinates || 'Not provided'}</span></div>
                            <div style={styles.userReportField}><span style={styles.userDetailsLabel}>Submitted</span><span style={styles.userDetailsValue}>{report.created_at ? new Date(report.created_at).toLocaleString() : 'Not available'}</span></div>
                            <div style={styles.userReportField}><span style={styles.userDetailsLabel}>Reporter</span><span style={styles.userDetailsValue}>{report.sender_name || report.username || selectedUser.username || selectedUser.full_name || 'Not provided'}</span></div>
                            <div style={styles.userReportField}><span style={styles.userDetailsLabel}>Device ID</span><span style={styles.userDetailsValue}>{report.device_id || 'Not provided'}</span></div>
                            {(report.assigned_responder || report.assigned_team) && (
                              <div style={styles.userReportField}><span style={styles.userDetailsLabel}>Assigned team</span><span style={styles.userDetailsValue}>{report.assigned_responder || report.assigned_team}</span></div>
                            )}
                            {report.dispatch_notes && (
                              <div style={styles.userReportField}><span style={styles.userDetailsLabel}>Dispatch message</span><span style={styles.userDetailsValue}>{report.dispatch_notes}</span></div>
                            )}
                            {report.admin_notes && (
                              <div style={styles.userReportField}><span style={styles.userDetailsLabel}>Investigation / admin notes</span><span style={styles.userDetailsValue}>{report.admin_notes}</span></div>
                            )}
                          </div>
                          <div style={styles.userReportDescriptionTitle}>Description</div>
                          <p style={styles.userReportDescription}>{report.description || 'No description provided.'}</p>
                          {(report.coordinates || report.location) && (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(report.coordinates || report.location)}`}
                              target="_blank"
                              rel="noreferrer"
                              style={styles.archiveMapLink}
                            >
                              View reported location in Google Maps
                            </a>
                          )}
                          {reportPhotos.length > 0 && (
                            <div style={styles.userReportPhotoSection}>
                              <div style={styles.userDetailsLabel}>Submitted photos</div>
                              <div style={styles.photoGalleryGrid}>
                                {reportPhotos.map((src, index) => (
                                  <img
                                    key={index}
                                    src={src}
                                    alt={`Ticket ${report.ticket_no || report.id} photo ${index + 1}`}
                                    style={styles.thumbImgFixed}
                                    onClick={() => {
                                      handleCloseUserDetails();
                                      setInspectImage(src);
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                          {report.response_photo && (
                            <div style={styles.userReportPhotoSection}>
                              <div style={styles.userDetailsLabel}>Responder verification photo</div>
                              <img src={report.response_photo} alt="Responder verification" style={styles.fieldEvidenceImage} onClick={() => { handleCloseUserDetails(); setInspectImage(report.response_photo); }} />
                            </div>
                          )}
                          {report.progress_photo && (
                            <div style={styles.userReportPhotoSection}>
                              <div style={styles.userDetailsLabel}>Resolution proof photo</div>
                              <img src={report.progress_photo} alt="Resolution proof" style={styles.fieldEvidenceImage} onClick={() => { handleCloseUserDetails(); setInspectImage(report.progress_photo); }} />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {moderationTarget && (
        <div style={styles.modalBackdrop} onClick={() => setModerationTarget(null)}>
          <div
            style={{ ...styles.modalContent, textAlign: 'left', maxWidth: '440px' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>
                {moderationAction === 'BANNED' ? 'Ban User' : 'Set Report Penalty'}
              </span>
              <button
                type="button"
                style={styles.closeBtn}
                aria-label="Close moderation form"
                onClick={() => setModerationTarget(null)}
              >
                ✕
              </button>
            </div>
            <p style={styles.modalSubtext}>
              {moderationTarget.username || moderationTarget.full_name || 'Device user'} · Device ID: {moderationTarget.device_id}
            </p>
            {moderationAction === 'PENALIZED' && (
              <div style={{ marginBottom: '12px' }}>
                <label style={styles.fieldLabel}>REPORTING PENALTY DURATION (DAYS) *</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  style={styles.selectInput}
                  value={penaltyDays}
                  onChange={(event) => setPenaltyDays(event.target.value)}
                  placeholder="Enter number of days"
                  required
                />
              </div>
            )}
            <div style={{ marginBottom: '12px' }}>
              <label style={styles.fieldLabel}>MESSAGE SHOWN TO THE USER *</label>
              <textarea
                style={styles.textareaInput}
                rows="4"
                maxLength={500}
                placeholder="Explain why this action was taken and what the user should do next..."
                value={moderationMessage}
                onChange={(event) => setModerationMessage(event.target.value)}
                required
              />
            </div>
            <div style={styles.workflowHint}>
              {moderationAction === 'BANNED'
                ? 'A ban locks the entire app on this device until an administrator lifts it.'
                : 'A penalty blocks report submissions only. Other app features remain available, and reporting is restored when the penalty expires.'}
            </div>
            <div style={styles.modalBtnRow}>
              <button
                type="button"
                style={styles.cancelBtn}
                onClick={() => setModerationTarget(null)}
                disabled={isUpdatingModeration}
              >
                Cancel
              </button>
              <button
                type="button"
                style={moderationAction === 'BANNED' ? styles.btnBan : styles.btnWarn}
                onClick={handleApplyModeration}
                disabled={isUpdatingModeration || !moderationMessage.trim() || (moderationAction === 'PENALIZED' && !penaltyDays)}
              >
                {isUpdatingModeration ? 'Saving...' : moderationAction === 'BANNED' ? 'Confirm Ban' : 'Apply Penalty'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Inspector Modal */}
      {inspectImage && (
        <div style={styles.photoPreviewOverlay} onClick={() => setInspectImage(null)}>
          <div style={styles.photoPreviewModal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.photoPreviewHeader}>
              <span style={styles.photoPreviewTitle}>Photo evidence preview</span>
              <button
                type="button"
                style={styles.photoPreviewClose}
                aria-label="Close photo preview"
                onClick={() => setInspectImage(null)}
              >
                Close
              </button>
            </div>
            <img src={inspectImage} alt="Full Proof" style={styles.fullModalImg} />
            <span style={styles.photoPreviewHint}>Click outside the image to close</span>
          </div>
        </div>
      )}
      <ActionDialog
        dialog={dialog}
        onClose={() => closeDialog(false)}
        onConfirm={() => closeDialog(true)}
      />
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#F8FAFC', minHeight: '100vh', padding: '16px', fontFamily: "'Inter', sans-serif" },
  navHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0F766E', padding: '12px 16px', borderRadius: '10px', color: '#FFFFFF', marginBottom: '16px' },
  backBtn: { backgroundColor: '#F0FDF4', color: '#0F766E', border: 'none', padding: '8px 14px', borderRadius: '8px', fontSize: '11px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center' },
  headerTitle: { fontSize: '15px', fontWeight: 'bold', margin: 0, textAlign: 'right' },
  headerSub: { fontSize: '10px', color: '#CCFBF1', textAlign: 'right' },
  dashboardContainer: { display: 'flex', flexDirection: 'column', gap: '14px' },
  welcomeBanner: { backgroundColor: '#0F766E', color: '#FFFFFF', padding: '14px', borderRadius: '10px' },
  welcomeTag: { fontSize: '9px', fontWeight: '800', letterSpacing: '1px', opacity: 0.8, marginBottom: '2px' },
  welcomeTitle: { fontSize: '18px', fontWeight: '800', margin: '2px 0' },
  welcomeSubtext: { fontSize: '11px', opacity: 0.9, margin: 0 },
  smsStatusCard: { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '12px' },
  smsStatusHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
  smsStatusTitle: { fontSize: '10px', fontWeight: '800', color: '#0F766E' },
  smsBadgeActive: { backgroundColor: '#DCFCE7', color: '#15803D', fontSize: '9px', fontWeight: '800', padding: '2px 8px', borderRadius: '12px' },
  smsStatusSub: { fontSize: '10px', color: '#475569', margin: '2px 0 6px 0', lineHeight: '1.4' },
  smsLogBox: { backgroundColor: '#F1F5F9', borderRadius: '6px', padding: '8px', marginTop: '6px' },
  smsLogLabel: { fontSize: '9px', fontWeight: '800', color: '#334155', marginBottom: '4px' },
  smsLogRow: { fontSize: '9px', display: 'flex', gap: '6px', marginBottom: '2px' },
  smsLogTime: { color: '#64748B', fontWeight: '700' },
  smsLogSuccess: { color: '#15803D', fontWeight: '700' },
  smsLogSkipped: { color: '#D97706', fontWeight: '700' },
  moduleSectionTitle: { fontSize: '11px', fontWeight: '800', color: '#475569', letterSpacing: '0.8px', marginTop: '4px' },
  tableCardContainer: { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '10px', overflow: 'hidden' },
  tableHeaderRow: { display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) minmax(105px, max-content)', alignItems: 'center', gap: '12px', padding: '8px 12px', backgroundColor: '#F1F5F9', borderBottom: '1px solid #CBD5E1', color: '#64748B', fontSize: '9px', fontWeight: '700', letterSpacing: '0.6px' },
  tableHeaderStatus: { textAlign: 'right' },
  tableRow: { display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) minmax(105px, max-content)', alignItems: 'center', gap: '12px', padding: '12px', borderBottom: '1px solid #F1F5F9', cursor: 'pointer' },
  tableRowLast: { display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) minmax(105px, max-content)', alignItems: 'center', gap: '12px', padding: '12px', cursor: 'pointer' },
  tableColIcon: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  iconBoxAmber: { width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  iconBoxTeal: { width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#CCFBF1', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  iconBoxPurple: { width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#F3E8FF', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  iconBoxEmerald: { width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  iconBoxSlate: { width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  tableColContent: { minWidth: 0 },
  tableTitle: { fontSize: '13px', fontWeight: '800', color: '#0F172A' },
  tableDesc: { fontSize: '10px', color: '#64748B', marginTop: '2px' },
  tableColBadge: { display: 'flex', justifyContent: 'flex-end', marginLeft: '8px', textAlign: 'right' },
  dividerRow: { textAlign: 'center', margin: '10px 0 4px 0' },
  dividerLabel: { fontSize: '9px', fontWeight: '800', color: '#64748B', letterSpacing: '1px' },
  chartCard: { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '12px' },
  chartControlRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
  chartTitleTag: { fontSize: '10px', fontWeight: '800', color: '#0F766E' },
  dateRangeGroup: { display: 'flex', alignItems: 'center', gap: '6px' },
  datePickerInput: { padding: '4px 6px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '9px', fontFamily: "'Inter', sans-serif" },
  toText: { fontSize: '9px', color: '#64748B' },
  svgGraphBox: { padding: '8px 0', borderBottom: '1px solid #F1F5F9' },
  chartLegendRow: { display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '8px', fontSize: '9px', fontWeight: '700' },
  legendValid: { color: '#0F766E' },
  legendFalse: { color: '#DC2626' },
  sectionStack: { display: 'flex', flexDirection: 'column', gap: '12px' },
  subTabContainer: { display: 'flex', backgroundColor: '#E2E8F0', padding: '4px', borderRadius: '10px', gap: '6px', overflowX: 'auto' },
  subTabBtnActive: { flex: '1 0 auto', minWidth: '130px', padding: '10px 12px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: '800', cursor: 'pointer', textAlign: 'center' },
  subTabBtnInactive: { flex: '1 0 auto', minWidth: '130px', padding: '10px 12px', backgroundColor: 'transparent', color: '#475569', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', textAlign: 'center' },
  btnToggleFilter: { padding: '6px 12px', backgroundColor: '#E2E8F0', color: '#0F172A', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '10px', fontWeight: '800', cursor: 'pointer' },
  filterBarRow: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', padding: '8px', backgroundColor: '#F1F5F9', borderRadius: '6px' },
  filterLabel: { fontSize: '9px', fontWeight: '800', color: '#475569', letterSpacing: '0.5px' },
  filterBtnActive: { padding: '4px 10px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '4px', fontSize: '9.5px', fontWeight: '800', cursor: 'pointer' },
  filterBtnInactive: { padding: '4px 10px', backgroundColor: '#FFFFFF', color: '#475569', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '9.5px', fontWeight: '700', cursor: 'pointer' },
  emptyCard: { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '12px', padding: '24px 18px', textAlign: 'center', fontSize: '13px', color: '#64748B', lineHeight: '1.5' },
  itemCardAccordion: { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '12px', padding: '12px', cursor: 'pointer' },
  cardHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '8px' },
  headerTitleGroup: { display: 'flex', alignItems: 'center', gap: '6px' },
  ticketBadge: { fontSize: '11px', fontWeight: '400', color: '#0F766E', backgroundColor: '#CCFBF1', padding: '4px 8px', borderRadius: '5px' },
  badgeOrange: { backgroundColor: '#FEF3C7', color: '#D97706', fontSize: '10px', fontWeight: '400', padding: '4px 8px', borderRadius: '5px' },
  badgeRed: { backgroundColor: '#FEE2E2', color: '#DC2626', fontSize: '10px', fontWeight: '400', padding: '4px 8px', borderRadius: '5px' },
  badgeTeal: { backgroundColor: '#CCFBF1', color: '#0F766E', fontSize: '10px', fontWeight: '400', padding: '4px 8px', borderRadius: '5px' },
  badgeYellow: { backgroundColor: '#FEF3C7', color: '#92400E', fontSize: '10px', fontWeight: '400', padding: '4px 8px', borderRadius: '5px' },
  badgeGreen: { backgroundColor: '#DCFCE7', color: '#15803D', fontSize: '10px', fontWeight: '400', padding: '4px 8px', borderRadius: '5px' },
  badgeBlue: { backgroundColor: '#DBEAFE', color: '#1E40AF', fontSize: '9px', fontWeight: '400', padding: '2px 6px', borderRadius: '4px' },
  userMetaText: { fontSize: '11px', color: '#000000', lineHeight: '1.45' },
  itemTitle: { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden', fontSize: '14px', fontWeight: '700', lineHeight: '1.35', color: '#0F766E', margin: '4px 0' },
  itemMeta: { fontSize: '12px', color: '#000000', fontWeight: '400', margin: '3px 0', lineHeight: '1.45' },
  activeDescriptionPreview: { fontSize: '12px', color: '#000000', fontWeight: '400', margin: '4px 0', lineHeight: '1.45' },
  expandHintText: { fontSize: '11px', color: '#0F766E', fontWeight: '700', marginTop: '8px' },
  accordionDetailBox: { borderTop: '1px solid #E2E8F0', marginTop: '12px', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' },
  detailGridPlain: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px' },
  detailRowPlain: { display: 'grid', gridTemplateColumns: 'minmax(76px, 0.65fr) minmax(0, 1.35fr)', alignItems: 'start', gap: '10px', fontSize: '13px', lineHeight: '1.5', textAlign: 'left' },
  fieldLabel: { display: 'block', fontSize: '12px', fontWeight: '700', color: '#000000', lineHeight: '1.5', textAlign: 'left' },
  fieldValText: { maxWidth: '100%', color: '#000000', fontSize: '13px', fontWeight: '400', lineHeight: '1.5', textAlign: 'left', overflowWrap: 'anywhere' },
  mapContainerBox: { display: 'flex', flexDirection: 'column', gap: '4px' },
  gpsMapBoxInteractive: { position: 'relative', borderRadius: '6px', overflow: 'hidden', border: '1px solid #CBD5E1', cursor: 'pointer' },
  mapOverlayBadge: { position: 'absolute', bottom: '6px', right: '6px', backgroundColor: 'rgba(15, 118, 110, 0.9)', color: '#FFFFFF', fontSize: '10px', fontWeight: '800', padding: '4px 8px', borderRadius: '5px' },
  detailSectionPlain: { display: 'flex', flexDirection: 'column', gap: '4px' },
  descTextPlain: { fontSize: '13px', color: '#000000', fontWeight: '400', margin: 0, lineHeight: '1.5', backgroundColor: '#F8FAFC', padding: '10px', borderRadius: '8px', border: '1px solid #E2E8F0', overflowWrap: 'anywhere' },
  photoGalleryGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '4px' },
  thumbImgFixed: { width: '100%', height: '65px', objectFit: 'cover', borderRadius: '6px', cursor: 'pointer', border: '1px solid #CBD5E1' },
  tagFormRow: { display: 'flex', gap: '6px', marginTop: '4px' },
  textInputCompact: { flex: 1, minWidth: 0, padding: '9px 10px', borderRadius: '7px', border: '1px solid #CBD5E1', fontSize: '12px', fontFamily: "'Inter', sans-serif" },
  btnTagAction: { padding: '9px 12px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' },
  actionRow: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' },
  btnInvestigate: { flex: '1 1 140px', minHeight: '40px', padding: '9px 12px', backgroundColor: '#D97706', color: '#FFFFFF', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' },
  btnApprove: { flex: '1 1 140px', minHeight: '40px', padding: '9px 12px', backgroundColor: '#15803D', color: '#FFFFFF', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' },
  btnReject: { flex: '1 1 140px', minHeight: '40px', padding: '9px 12px', backgroundColor: '#DC2626', color: '#FFFFFF', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' },
  btnRejectCompact: { alignSelf: 'flex-start', padding: '7px 10px', backgroundColor: '#DC2626', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' },
  btnResolve: { flex: '1 1 140px', minHeight: '40px', padding: '9px 12px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' },
  btnCancelAction: { flex: '1 1 100px', minHeight: '40px', padding: '9px 12px', backgroundColor: '#F1F5F9', color: '#334155', border: '1px solid #CBD5E1', borderRadius: '7px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  btnStepDisabled: { flex: '1 1 140px', minHeight: '40px', padding: '9px 12px', backgroundColor: '#E2E8F0', color: '#64748B', border: '1px solid #CBD5E1', borderRadius: '7px', fontSize: '12px', fontWeight: '400', cursor: 'not-allowed' },
  btnBulkDisabled: { width: '100%', padding: '10px', backgroundColor: '#E2E8F0', color: '#64748B', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '11px', fontWeight: '500', cursor: 'not-allowed' },
  workflowHint: { padding: '8px 10px', backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #CBD5E1', borderRadius: '7px', fontSize: '11px', lineHeight: '1.45' },
  dispatchOutcomeBox: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', backgroundColor: '#ECFDF5', border: '1px solid #99F6E4', borderLeft: '4px solid #0F766E', borderRadius: '8px' },
  dispatchOutcomeTitle: { color: '#0F766E', fontSize: '11px', fontWeight: '700', letterSpacing: '0.4px' },
  dispatchOutcomeMeta: { color: '#334155', fontSize: '12px', fontWeight: '400', lineHeight: '1.45' },
  dispatchOutcomeNotes: { margin: '2px 0 0', padding: '9px', backgroundColor: '#FFFFFF', border: '1px solid #D1FAE5', borderRadius: '6px', color: '#000000', fontSize: '12px', fontWeight: '400', lineHeight: '1.5', whiteSpace: 'pre-wrap' },
  dispatchVerdictConfirmed: { color: '#166534', backgroundColor: '#DCFCE7', borderRadius: '6px', padding: '6px 8px', fontSize: '12px', fontWeight: '600' },
  dispatchVerdictNotFound: { color: '#991B1B', backgroundColor: '#FEE2E2', borderRadius: '6px', padding: '6px 8px', fontSize: '12px', fontWeight: '600' },
  fieldEvidenceImage: { width: '100%', maxWidth: '240px', maxHeight: '180px', objectFit: 'contain', borderRadius: '6px', border: '1px solid #CBD5E1', cursor: 'pointer' },
  adminDecisionBox: { padding: '12px', backgroundColor: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: '8px' },
  adminDecisionTitle: { color: '#0F766E', fontSize: '11px', fontWeight: '700', letterSpacing: '0.4px' },
  adminDecisionText: { margin: '6px 0 0', color: '#000000', fontSize: '12px', fontWeight: '400', lineHeight: '1.5' },
  archiveHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' },
  archiveTicketDetails: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' },
  archiveMapLink: { color: '#0F766E', fontSize: '12px', textDecoration: 'underline' },
  archiveNoticeText: { fontSize: '10.5px', fontWeight: '800', color: '#991B1B' },
  btnPurgeAll: { padding: '6px 12px', backgroundColor: '#DC2626', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '10px', fontWeight: '800', cursor: 'pointer' },
  btnRestore: { padding: '9px 12px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  assignedBadgeBox: { backgroundColor: '#F1F5F9', border: '1px solid #CBD5E1', padding: '6px 8px', borderRadius: '6px', fontSize: '10px', color: '#334155', margin: '4px 0' },
  trackerBar: { display: 'flex', backgroundColor: '#F1F5F9', borderRadius: '6px', padding: '4px', margin: '8px 0' },
  stepActive: { flex: 1, textAlign: 'center', fontSize: '9px', fontWeight: '800', color: '#0F766E', borderBottom: '2px solid #0F766E', padding: '4px' },
  stepDone: { flex: 1, textAlign: 'center', fontSize: '9px', color: '#94A3B8', padding: '4px' },
  dispatchInlineRow: { display: 'flex', gap: '6px', margin: '6px 0' },
  dispatchForm: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px' },
  selectInputCompact: { flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '10px', fontFamily: "'Inter', sans-serif" },
  btnDispatch: { minHeight: '40px', padding: '9px 12px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' },
  proofUploadBox: { display: 'flex', flexDirection: 'column', gap: '4px', margin: '6px 0' },
  photoUploadDropzoneCompact: { border: '1px dashed #0F766E', backgroundColor: '#CCFBF1', padding: '8px', borderRadius: '6px', textAlign: 'center', cursor: 'pointer' },
  uploadTextCompact: { fontSize: '10px', fontWeight: '800', color: '#0F766E' },
  resolutionPhotoPreview: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px', backgroundColor: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: '8px', color: '#334155', fontFamily: "'Inter', sans-serif", fontSize: '11px', fontWeight: '600', textAlign: 'left', cursor: 'zoom-in' },
  resolutionPhotoPreviewImage: { width: '96px', height: '72px', objectFit: 'contain', backgroundColor: '#E2E8F0', borderRadius: '5px' },
  bulkBoxCardCenter: { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '16px', maxWidth: '680px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '10px' },
  bulkFormTitle: { fontSize: '14px', fontWeight: '800', color: '#0F172A', margin: 0 },
  bulkFormSub: { fontSize: '10px', color: '#64748B', margin: 0, lineHeight: '1.4' },
  selectInput: { width: '100%', padding: '10px', borderRadius: '7px', border: '1px solid #CBD5E1', fontSize: '12px', fontFamily: "'Inter', sans-serif", boxSizing: 'border-box' },
  labelRowBetween: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  btnAutoNotice: { padding: '4px 8px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '4px', fontSize: '9px', fontWeight: '800', cursor: 'pointer' },
  textareaInput: { width: '100%', padding: '10px', borderRadius: '7px', border: '1px solid #CBD5E1', fontSize: '12px', lineHeight: '1.5', fontFamily: "'Inter', sans-serif", boxSizing: 'border-box' },
  photoUploadDropzone: { border: '1px dashed #0F766E', backgroundColor: '#CCFBF1', padding: '12px', borderRadius: '6px', textAlign: 'center', cursor: 'pointer' },
  uploadText: { fontSize: '10.5px', fontWeight: '800', color: '#0F766E' },
  previewPhotoBox: { textAlign: 'center' },
  previewThumbImg: { maxHeight: '100px', borderRadius: '6px', border: '1px solid #CBD5E1' },
  btnBulkSubmit: { width: '100%', padding: '10px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  noticeTextSmall: { fontSize: '12px', color: '#475569', lineHeight: '1.5' },
  moduleIntro: { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '12px', padding: '16px' },
  moduleIntroTitle: { fontSize: '18px', fontWeight: '800', color: '#0F172A', margin: '0 0 6px' },
  moduleIntroText: { fontSize: '13px', color: '#475569', lineHeight: '1.5', margin: 0 },
  userCardRow: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '12px', backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '12px', padding: '16px' },
  userLeftBox: { display: 'flex', alignItems: 'flex-start', gap: '12px' },
  userIdentity: { flex: 1, minWidth: 0 },
  userIdentityTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' },
  userSummaryDevice: { marginTop: '3px', color: '#475569', fontSize: '12px', lineHeight: '1.45', overflowWrap: 'anywhere' },
  numBadge: { fontSize: '12px', fontWeight: '800', color: '#64748B' },
  userNameText: { fontSize: '15px', fontWeight: '800', color: '#0F172A', marginBottom: '3px' },
  userRightActionRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', width: '100%' },
  userModerationActions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginLeft: 'auto' },
  btnViewUser: { padding: '7px 10px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  btnWarn: { padding: '7px 10px', backgroundColor: '#D97706', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  btnBan: { padding: '7px 10px', backgroundColor: '#DC2626', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  btnApproveUser: { padding: '7px 10px', backgroundColor: '#15803D', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  btnRejectUser: { padding: '7px 10px', backgroundColor: '#DC2626', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  verificationCard: { display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '12px', padding: '16px' },
  userRequestName: { fontSize: '15px', fontWeight: '700', color: '#0F766E', margin: 0 },
  idPhotoContainer: { margin: '8px 0' },
  idProofImg: { display: 'block', width: '100%', maxWidth: '360px', maxHeight: '240px', objectFit: 'contain', objectPosition: 'center', backgroundColor: '#F1F5F9', borderRadius: '6px', cursor: 'pointer', border: '1px solid #CBD5E1', marginTop: '6px' },
  userDetailsModal: { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '14px', padding: '16px', maxWidth: '460px', width: '100%', maxHeight: '88vh', overflowY: 'auto', textAlign: 'left' },
  userDetailsHeader: { display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '12px', borderBottom: '1px solid #E2E8F0' },
  userDetailsTitle: { fontSize: '16px', fontWeight: '700', color: '#0F766E', margin: '0 0 3px' },
  userDetailsSection: { marginTop: '14px' },
  userDetailsSectionTitle: { color: '#0F766E', fontSize: '13px', fontWeight: '700', marginBottom: '8px' },
  userDetailsGrid: { display: 'flex', flexDirection: 'column', gap: '8px', margin: '8px 0', fontSize: '12px', color: '#475569' },
  userDetailsItem: { display: 'flex', flexDirection: 'column', gap: '2px', paddingBottom: '7px', borderBottom: '1px solid #E2E8F0' },
  userDetailsLabel: { color: '#64748B', fontSize: '11px', fontWeight: '700', lineHeight: '1.35' },
  userDetailsValue: { color: '#000000', fontSize: '12px', lineHeight: '1.45', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
  userReportsSection: { marginTop: '14px' },
  userReportsSectionTitle: { color: '#0F766E', fontSize: '13px', fontWeight: '700', marginBottom: '8px' },
  userReportEmpty: { padding: '8px 0', color: '#64748B', fontSize: '12px' },
  userReportCard: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 0', marginTop: '6px', borderBottom: '1px solid #CBD5E1' },
  userReportToggle: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '5px', width: '100%', padding: 0, border: 'none', background: 'transparent', color: 'inherit', fontFamily: "'Inter', sans-serif", textAlign: 'left', cursor: 'pointer' },
  userReportToggleHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' },
  userReportToggleHint: { color: '#0F766E', fontSize: '11px', fontWeight: '700' },
  userReportStatus: { color: '#475569', fontSize: '10px', fontWeight: '400' },
  userReportTitle: { color: '#0F766E', fontSize: '13px', fontWeight: '700', margin: '4px 0' },
  userReportFields: { display: 'flex', flexDirection: 'column', gap: '7px', margin: '8px 0' },
  userReportField: { display: 'flex', flexDirection: 'column', gap: '2px' },
  userReportDescriptionTitle: { color: '#64748B', fontSize: '11px', marginTop: '8px' },
  userReportDescription: { margin: '2px 0 0', color: '#000000', fontSize: '12px', lineHeight: '1.5', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
  userReportPhotoSection: { display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '10px' },
  sectionSubTitle: { fontSize: '10px', fontWeight: '800', color: '#475569', letterSpacing: '0.8px', marginTop: '6px' },
  subTitleSmall: { fontSize: '9.5px', fontWeight: '800', color: '#0F766E', marginBottom: '4px' },
  subTicketRow: { fontSize: '9.5px', color: '#334155', padding: '3px 0' },
  memoSelectionCard: { minWidth: 0, backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '12px', padding: '14px', cursor: 'pointer' },
  memoSelectionHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' },
  memoSelectionTitle: { minWidth: 0, color: '#0F766E', fontSize: '14px', fontWeight: '700', overflowWrap: 'anywhere' },
  memoSelectionMeta: { color: '#475569', fontSize: '12px', lineHeight: '1.5', margin: '4px 0 0', overflowWrap: 'anywhere' },
  memoTicketRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '3px', padding: '9px 10px', marginTop: '7px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '7px' },
  memoTicketLabel: { color: '#0F766E', fontSize: '11px', fontWeight: '700' },
  memoTicketText: { color: '#0F172A', fontSize: '12px', lineHeight: '1.45', overflowWrap: 'anywhere' },
  memoTicketLocation: { color: '#64748B', fontSize: '11px', lineHeight: '1.4', overflowWrap: 'anywhere' },
  memoActionBox: { marginTop: '8px' },
  btnMakeMemoPrimary: { padding: '6px 12px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '10px', fontWeight: '800', cursor: 'pointer' },
  memoDescText: { fontSize: '10px', fontStyle: 'italic', color: '#334155', margin: '4px 0' },
  memoPreviewStack: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 },
  memoPrintHeaderAction: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '12px', backgroundColor: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid #CBD5E1' },
  memoPrintNoticeText: { flex: '1 1 220px', minWidth: 0, fontSize: '12px', fontWeight: '700', color: '#15803D', lineHeight: '1.45', overflowWrap: 'anywhere' },
  iconBtnRow: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  iconBtnPrint: { padding: '6px 10px', backgroundColor: '#15803D', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '10px', fontWeight: '800', cursor: 'pointer' },
  iconBtnDownloadDoc: { padding: '6px 10px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '10px', fontWeight: '800', cursor: 'pointer' },
  officialMemoPaper: { boxSizing: 'border-box', minWidth: 0, backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '18px', fontFamily: "'Inter', sans-serif", overflowWrap: 'anywhere' },
  memoHeaderSeal: { textAlign: 'center', marginBottom: '14px' },
  memoRepTitle: { fontSize: '10px', fontWeight: '700', color: '#64748B', letterSpacing: '0.6px', lineHeight: '1.4' },
  memoProvinceTitle: { fontSize: '11px', fontWeight: '700', color: '#334155', margin: '4px 0', lineHeight: '1.4' },
  memoDeptTitle: { fontSize: '13px', fontWeight: '700', color: '#0F766E', margin: '4px 0', lineHeight: '1.4' },
  memoCenterSub: { fontSize: '10px', fontStyle: 'italic', color: '#475569', lineHeight: '1.4' },
  memoDividerLine: { height: '2px', backgroundColor: '#0F766E', marginTop: '8px' },
  memoMetaTable: { display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: '#F8FAFC', padding: '12px', borderRadius: '8px', border: '1px solid #E2E8F0', marginBottom: '14px', fontSize: '12px' },
  memoMetaRow: { display: 'grid', gridTemplateColumns: 'minmax(110px, 0.6fr) minmax(0, 1.4fr)', gap: '6px 12px', alignItems: 'start', color: '#334155', lineHeight: '1.45', overflowWrap: 'anywhere' },
  memoSectionHeading: { fontSize: '12px', fontWeight: '700', color: '#0F766E', letterSpacing: '0.2px', borderBottom: '1px solid #CCFBF1', paddingBottom: '5px', margin: '16px 0 8px', lineHeight: '1.4' },
  formalTable: { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px', marginBottom: '10px' },
  tableLabelCell: { fontWeight: '600', color: '#475569', padding: '7px 10px 7px 0', width: '38%', verticalAlign: 'top', lineHeight: '1.45', overflowWrap: 'anywhere' },
  tableValCell: { color: '#0F172A', padding: '7px 0', lineHeight: '1.45', overflowWrap: 'anywhere' },
  memoDescriptionBox: { display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '12px', fontSize: '12px', color: '#334155', lineHeight: '1.5' },
  memoReportEntry: { display: 'flex', flexDirection: 'column', gap: '5px', padding: '10px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '7px' },
  memoReportEntryTitle: { color: '#0F766E', fontSize: '12px', fontWeight: '700', lineHeight: '1.4', overflowWrap: 'anywhere' },
  memoReportEntryText: { color: '#334155', fontSize: '12px', lineHeight: '1.5', overflowWrap: 'anywhere' },
  memoReportEntryLocation: { color: '#64748B', fontSize: '11px', lineHeight: '1.4', overflowWrap: 'anywhere' },
  memoPhotoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginTop: '8px' },
  exhibitPhotoCard: { minWidth: 0, textAlign: 'center', border: '1px solid #E2E8F0', padding: '8px', borderRadius: '8px', backgroundColor: '#F8FAFC' },
  memoThumbImgFixed: { width: '100%', height: '120px', objectFit: 'cover', borderRadius: '5px' },
  exhibitTag: { fontSize: '8px', fontWeight: '800', color: '#475569', marginTop: '4px' },
  noPhotoNoticeBox: { fontSize: '9.5px', fontStyle: 'italic', color: '#64748B', padding: '8px', backgroundColor: '#F8FAFC', borderRadius: '6px', textAlign: 'center' },
  memoDirectiveText: { fontSize: '12px', color: '#334155', lineHeight: '1.5', margin: '8px 0' },
  signatureRow: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '24px 12px', marginTop: '30px', paddingTop: '10px' },
  sigBlock: { flex: '1 1 180px', textAlign: 'center', minWidth: 0 },
  sigLine: { borderBottom: '1px solid #334155', marginBottom: '4px' },
  sigName: { fontSize: '9px', fontWeight: '800', color: '#0F172A' },
  sigTitle: { fontSize: '8px', color: '#64748B' },
  resolvedSubTicketCard: { backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '10px', marginTop: '6px' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' },
  modalContent: { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '14px', maxWidth: '400px', width: '100%', textAlign: 'center' },
  photoPreviewOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(2, 6, 23, 0.92)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: '12px' },
  photoPreviewModal: { display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#0F172A', border: '1px solid #334155', borderRadius: '14px', padding: '12px', maxWidth: '1000px', maxHeight: '92vh', width: '100%', boxSizing: 'border-box' },
  photoPreviewHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' },
  photoPreviewTitle: { color: '#F8FAFC', fontSize: '13px', fontWeight: '700' },
  photoPreviewClose: { padding: '6px 10px', backgroundColor: '#1E293B', color: '#F8FAFC', border: '1px solid #475569', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' },
  photoPreviewHint: { color: '#CBD5E1', fontSize: '10px', textAlign: 'center' },
  fullModalImg: { display: 'block', maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain', borderRadius: '8px', alignSelf: 'center' },
  modalCloseBtn: { backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', padding: '8px 16px', borderRadius: '8px', fontSize: '11px', fontWeight: '800', cursor: 'pointer', marginTop: '10px' }
};