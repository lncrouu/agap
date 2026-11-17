import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import ActionDialog from '../components/ActionDialog';
import { formatTicketReference } from '../utils/ticketNumber';

function getSubmittedReportPhotos(report) {
  const rawPhotos = report?.proof_photos || report?.photos;
  if (!rawPhotos) return [];

  const normalize = (photos) => photos
    .map((photo) => (
      typeof photo === 'string'
        ? photo
        : photo?.base64 || photo?.url || null
    ))
    .filter(Boolean);

  if (Array.isArray(rawPhotos)) return normalize(rawPhotos);
  if (typeof rawPhotos === 'object') {
    const photo = rawPhotos.base64 || rawPhotos.url;
    return photo ? [photo] : [];
  }
  if (typeof rawPhotos !== 'string') return [];

  const trimmedPhotos = rawPhotos.trim();
  if (trimmedPhotos.startsWith('[')) {
    try {
      const parsedPhotos = JSON.parse(trimmedPhotos);
      return Array.isArray(parsedPhotos) ? normalize(parsedPhotos) : [];
    } catch (error) {
      console.warn('Could not parse submitted report photos:', error.message);
      return [];
    }
  }
  return trimmedPhotos ? [trimmedPhotos] : [];
}

export default function ResponderScreen({ onBack }) {
  const [selectedTeam, setSelectedTeam] = useState('CDRRMO Rescue Alpha Team');
  const [reports, setReports] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedVerdictReport, setSelectedVerdictReport] = useState(null);
  const [fieldRemarks, setFieldRemarks] = useState('');
  const [fieldVerdict, setFieldVerdict] = useState('CONFIRMED');
  const [fieldVerdictNotes, setFieldVerdictNotes] = useState('');
  const [fieldEvidencePhoto, setFieldEvidencePhoto] = useState('');
  const [resolutionPhoto, setResolutionPhoto] = useState('');
  const [previewImage, setPreviewImage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialog, setDialog] = useState(null);
  const dialogResolverRef = useRef(null);

  const showMessage = (message, tone = 'info') => {
    dialogResolverRef.current = null;
    setDialog({ type: 'message', message, tone });
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

  const TEAMS = [
    'CDRRMO Rescue Alpha Team',
    'BFP Fire Station Unit 1',
    'Batangas PNP Patrol Unit 3',
    'Philippine Red Cross Ambulance'
  ];

  useEffect(() => {
    fetchAssignedReports();
    const subscription = supabase
      .channel('responder_reports_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => {
        fetchAssignedReports();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [selectedTeam]);

  const fetchAssignedReports = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setReports(data || []);
    } catch (err) {
      console.log('Fetch error:', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateStatus = async (reportId, newStatus) => {
    const report = reports.find((item) => item.id === reportId);
    const ticketReference = formatTicketReference(report?.ticket_no || reportId);
    const currentStatus = (report?.status || '').trim().toUpperCase();
    if (newStatus === 'EN_ROUTE' && !['FIELD_DISPATCHED', 'DISPATCHED'].includes(currentStatus)) {
      return showMessage('Acknowledge is only available after the ticket has been dispatched.');
    }
    if (newStatus === 'ON_SCENE' && currentStatus !== 'EN_ROUTE') {
      return showMessage('Acknowledge the dispatch before marking the team on scene.');
    }
    if (newStatus === 'RESOLVED') {
      if (currentStatus !== 'IN_PROGRESS') {
        return showMessage('The active operation must be marked In Progress before it can be resolved.');
      }
      if (!resolutionPhoto) {
        return showMessage('A resolution proof photo is required before marking this ticket resolved.');
      }
    }

    const confirmationText = newStatus === 'EN_ROUTE'
      ? `Confirm that your team has acknowledged ticket ${ticketReference} and is en route?`
      : newStatus === 'ON_SCENE'
        ? `Confirm that your team has arrived at the location for ticket ${ticketReference}?`
        : `Confirm resolving ticket ${ticketReference} with the attached proof photo?`;
    if (!(await confirmAction(confirmationText))) return;

    setIsSubmitting(true);
    try {
      const updateData = { status: newStatus };
      if (newStatus === 'RESOLVED') {
        if (fieldRemarks.trim()) {
          updateData.admin_notes = [report?.admin_notes, `RESOLUTION NOTES: ${fieldRemarks.trim()}`].filter(Boolean).join('\n');
        }
        updateData.progress_photo = resolutionPhoto;
      }

      const { error } = await supabase
        .from('reports')
        .update(updateData)
        .eq('id', reportId);

      if (error) throw error;

      showMessage(`Ticket ${ticketReference} updated to ${newStatus.replace(/_/g, ' ')}.`, 'success');
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, ...updateData } : r));
      if (newStatus === 'RESOLVED') {
        setSelectedReport(null);
        setFieldRemarks('');
        setResolutionPhoto('');
      }
    } catch (err) {
      showMessage(`Update failed: ${err.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitFieldVerdict = async () => {
    if (!selectedVerdictReport) return;
    const ticketReference = formatTicketReference(selectedVerdictReport.ticket_no || selectedVerdictReport.id);
    if (!fieldVerdictNotes.trim()) return showMessage('Enter the field team’s location verification findings.', 'error');
    if ((selectedVerdictReport.status || '').trim().toUpperCase() !== 'ON_SCENE') {
      return showMessage('The team must be marked On Scene before submitting its field verdict.', 'error');
    }
    if (!fieldEvidencePhoto) {
      return showMessage('Attach a photo of the actual reported site before submitting the field verdict.', 'error');
    }
    if (!(await confirmAction(
      `Submit a ${fieldVerdict === 'CONFIRMED' ? 'confirmed' : 'not found'} field verdict for ticket ${ticketReference}?`
    ))) return;

    setIsSubmitting(true);
    try {
      const reportId = selectedVerdictReport.id;
      const newStatus = fieldVerdict === 'CONFIRMED' ? 'FIELD_CONFIRMED' : 'FIELD_NOT_FOUND';
      const updateData = {
        status: newStatus,
        admin_notes: `FIELD VERDICT: ${fieldVerdict === 'CONFIRMED' ? 'INCIDENT CONFIRMED AT LOCATION' : 'INCIDENT NOT FOUND AT LOCATION'} by ${selectedTeam}. Findings: ${fieldVerdictNotes.trim()}`
      };
      updateData.response_photo = fieldEvidencePhoto;
      const { error: repErr } = await supabase
        .from('reports')
        .update(updateData)
        .eq('id', reportId);

      if (repErr) throw repErr;

      showMessage(`Field verification submitted for ticket ${ticketReference}. The admin team will review the verdict.`, 'success');

      setSelectedVerdictReport(null);
      setFieldVerdictNotes('');
      setFieldEvidencePhoto('');
      fetchAssignedReports();
    } catch (err) {
      showMessage(`Field verification failed: ${err.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhotoUpload = (e, setPhoto) => {
    const file = e.target.files ? e.target.files[0] : null;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 800;
        let width = image.width;
        let height = image.height;
        if (width > height ? width > maxSize : height > maxSize) {
          if (width > height) {
            height *= maxSize / width;
            width = maxSize;
          } else {
            width *= maxSize / height;
            height = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) return showMessage('Could not process the selected photo. Please choose another image.', 'error');
        context.drawImage(image, 0, 0, width, height);
        setPhoto(canvas.toDataURL('image/jpeg', 0.75));
      };
      image.onerror = () => showMessage('Could not read the selected photo. Please choose another image.', 'error');
      image.src = event.target.result;
    };
    reader.onerror = () => showMessage('Could not load the selected photo. Please choose another image.', 'error');
    reader.readAsDataURL(file);
  };

  const assignedReports = reports.filter(r => {
    const st = (r.status || '').trim().toUpperCase();
    const isActive = ['FIELD_DISPATCHED', 'DISPATCHED', 'EN_ROUTE', 'ON_SCENE', 'APPROVED', 'IN_PROGRESS'].includes(st);
    return isActive && (r.assigned_responder === selectedTeam || r.assigned_team === selectedTeam);
  });

  return (
    <div style={styles.container}>
      <div style={styles.navHeader}>
        <button style={styles.backBtn} onClick={onBack}>&lt; Back</button>
        <div>
          <h2 style={styles.headerTitle}>Field Responder Portal</h2>
          <div style={styles.headerSub}>CDRRMO Mobile Response Network</div>
        </div>
      </div>

      <div style={styles.teamTabContainer}>
        {TEAMS.map(team => (
          <button
            key={team}
            style={selectedTeam === team ? styles.teamTabActive : styles.teamTabInactive}
            onClick={() => setSelectedTeam(team)}
          >
            {team}
          </button>
        ))}
      </div>

      <div style={styles.statusBanner}>
        ACTIVE SQUAD: <strong>{selectedTeam}</strong> &bull; Assigned Incident Dispatches ({assignedReports.length})
      </div>

      {isLoading ? (
        <div style={styles.loadingBox}>Loading assigned field dispatches...</div>
      ) : assignedReports.length === 0 ? (
        <div style={styles.emptyCard}>
          <div style={styles.emptyTitle}>NO ACTIVE DISPATCHES</div>
          <div style={styles.emptySub}>All reported hazards for this squad are cleared or standing by in queue.</div>
        </div>
      ) : (
        <div style={styles.reportsStack}>
          {assignedReports.map(rep => {
            const st = (rep.status || 'DISPATCHED').trim().toUpperCase();
            const submittedPhotos = getSubmittedReportPhotos(rep);
            const isFieldVerification = ['FIELD_DISPATCHED', 'DISPATCHED', 'EN_ROUTE', 'ON_SCENE'].includes(st);
            const isActiveOperation = ['APPROVED', 'IN_PROGRESS'].includes(st);
            const canAcknowledge = ['FIELD_DISPATCHED', 'DISPATCHED'].includes(st);
            const hasAcknowledged = ['EN_ROUTE', 'ON_SCENE'].includes(st);
            const canArriveOnScene = st === 'EN_ROUTE';
            const hasArrivedOnScene = st === 'ON_SCENE';
            const canSubmitVerdict = hasArrivedOnScene;
            const canSubmitResolution = st === 'IN_PROGRESS';
            return (
              <div key={rep.id} style={styles.reportCard}>
                {rep.dispatch_notes && (
                  <div style={styles.dispatchMessage}>
                    <span>Dispatch message: {rep.dispatch_notes}</span>
                  </div>
                )}
                <div style={styles.rowBetween}>
                  <span style={st === 'ON_SCENE' ? styles.badgeOnScene : st === 'EN_ROUTE' ? styles.badgeEnRoute : st === 'IN_PROGRESS' ? styles.badgeInvestigating : styles.badgeDispatched}>
                    {st === 'ON_SCENE' ? 'ON SCENE' : st === 'EN_ROUTE' ? 'EN ROUTE' : st === 'IN_PROGRESS' ? 'IN PROGRESS' : 'DISPATCHED TO SQUAD'}
                  </span>
                  <span style={styles.ticketTag}>{rep.ticket_no || rep.id}</span>
                </div>

                <h3 style={styles.reportTitle}>{rep.hazard_type || 'Hazard Alert'}</h3>
                <p style={styles.reportMeta}>Location: {rep.location || 'Batangas City'}</p>
                <p style={styles.reportMeta}>Urgency level: {rep.severity || 'HIGH'}</p>

                {rep.description && (
                  <div style={styles.descriptionBox}>{rep.description}</div>
                )}

                {submittedPhotos.length > 0 && (
                  <div style={styles.submittedPhotoSection}>
                    <div style={styles.submittedPhotoHeading}>
                      <span>PHOTOS FROM REPORTER ({submittedPhotos.length})</span>
                      <span style={styles.submittedPhotoHint}>Use these to identify the reported site</span>
                    </div>
                    <div style={styles.submittedPhotoGrid}>
                      {submittedPhotos.map((photo, index) => (
                        <button
                          key={`${rep.id}-submitted-photo-${index}`}
                          type="button"
                          style={styles.submittedPhotoButton}
                          aria-label={`View submitted report photo ${index + 1}`}
                          onClick={() => setPreviewImage(photo)}
                        >
                          <img src={photo} alt={`Citizen-submitted report evidence ${index + 1}`} style={styles.submittedPhoto} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={styles.actionRow}>
                  {isFieldVerification && (
                    <button
                      style={canAcknowledge ? styles.btnEnRoute : hasAcknowledged ? styles.btnStepCompleted : styles.btnStepDisabled}
                      onClick={() => handleUpdateStatus(rep.id, 'EN_ROUTE')}
                      disabled={!canAcknowledge || isSubmitting}
                    >
                      {hasAcknowledged ? 'Dispatch Acknowledged ✓' : 'Acknowledge & En Route'}
                    </button>
                  )}
                  {isFieldVerification && (
                    <button
                      style={canArriveOnScene ? styles.btnOnScene : hasArrivedOnScene ? styles.btnStepCompleted : styles.btnStepDisabled}
                      onClick={() => handleUpdateStatus(rep.id, 'ON_SCENE')}
                      disabled={!canArriveOnScene || isSubmitting}
                    >
                      {hasArrivedOnScene ? 'Arrived On Scene ✓' : 'Arrived On Scene'}
                    </button>
                  )}
                  {isFieldVerification && (
                    <button
                      style={canSubmitVerdict ? styles.btnResolveModal : styles.btnStepDisabled}
                      onClick={() => {
                        setFieldVerdict('CONFIRMED');
                        setFieldVerdictNotes('');
                        setFieldEvidencePhoto('');
                        setSelectedVerdictReport(rep);
                      }}
                      disabled={!canSubmitVerdict || isSubmitting}
                    >
                      Submit Field Verification
                    </button>
                  )}
                  {isActiveOperation && (
                    <>
                      {!canSubmitResolution && (
                        <div style={styles.workflowHint}>
                          Waiting for the admin to mark this operation In Progress.
                        </div>
                      )}
                      <button
                        style={canSubmitResolution ? styles.btnResolveModal : styles.btnStepDisabled}
                        onClick={() => setSelectedReport(rep)}
                        disabled={!canSubmitResolution || isSubmitting}
                      >
                        Submit Resolution & Proof
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Resolution & Photo Proof Upload Modal */}
      {selectedReport && (
        <div style={styles.modalBackdrop} onClick={() => setSelectedReport(null)}>
          <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>Field Resolution & Completion Proof</span>
              <button style={styles.closeBtn} onClick={() => setSelectedReport(null)}>✕</button>
            </div>

            <div style={styles.modalTicket}>Ticket Ref: {selectedReport.ticket_no || selectedReport.id}</div>
            <div style={styles.modalHazard}>{selectedReport.hazard_type || selectedReport.category}</div>

            <div style={styles.formGroup}>
              <label style={styles.label}>ON-SCENE RESOLUTION REMARKS</label>
              <textarea
                style={styles.textarea}
                rows="3"
                placeholder="Type details on how the hazard was cleared or mitigated..."
                value={fieldRemarks}
                onChange={e => setFieldRemarks(e.target.value)}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>RESOLUTION PROOF PHOTO (REQUIRED) *</label>
              {resolutionPhoto && (
                <div style={styles.previewBox}>
                  <img src={resolutionPhoto} alt="Resolution proof" style={styles.previewImg} />
                </div>
              )}
              <label style={styles.fileDropzone}>
                <span>{resolutionPhoto ? 'Change Resolution Photo' : '+ Upload On-Site Resolution Photo'}</span>
                <input type="file" accept="image/*" onChange={(e) => handlePhotoUpload(e, setResolutionPhoto)} style={{ display: 'none' }} />
              </label>
            </div>
            {!resolutionPhoto && <div style={styles.workflowHint}>Attach a photo showing the completed repair or cleared hazard to enable resolution.</div>}

            <div style={styles.modalBtnRow}>
              <button style={styles.cancelBtn} onClick={() => setSelectedReport(null)}>Cancel</button>
              <button
                style={resolutionPhoto ? styles.confirmBtn : styles.btnStepDisabled}
                onClick={() => handleUpdateStatus(selectedReport.id, 'RESOLVED')}
                disabled={!resolutionPhoto || isSubmitting}
              >
                {isSubmitting ? 'Transmitting...' : 'Mark Incident as RESOLVED'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Field Verification Verdict Modal */}
      {selectedVerdictReport && (
        <div style={styles.modalBackdrop} onClick={() => setSelectedVerdictReport(null)}>
          <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>Field Verification Verdict</span>
              <button style={styles.closeBtn} onClick={() => setSelectedVerdictReport(null)}>✕</button>
            </div>

            <p style={{ fontSize: '11px', color: '#475569', lineHeight: '1.4', margin: '0 0 10px 0' }}>
              Ticket {formatTicketReference(selectedVerdictReport.ticket_no || selectedVerdictReport.id)}. Your findings will be sent to the admin queue for an accept/reject decision.
            </p>

            <div style={styles.formGroup}>
              <label style={styles.label}>LOCATION VERDICT</label>
              <select
                style={styles.textarea}
                value={fieldVerdict}
                onChange={(e) => setFieldVerdict(e.target.value)}
              >
                <option value="CONFIRMED">Incident exists at the reported location</option>
                <option value="NOT_FOUND">Incident not found at the reported location</option>
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>FIELD INVESTIGATION FINDINGS *</label>
              <textarea
                style={styles.textarea}
                rows="3"
                placeholder="Describe what the team observed at the reported location..."
                value={fieldVerdictNotes}
                onChange={e => setFieldVerdictNotes(e.target.value)}
                required
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>ACTUAL SITE PHOTO (REQUIRED FOR EVERY VERDICT) *</label>
              {fieldEvidencePhoto && (
                <div style={styles.previewBox}>
                  <img src={fieldEvidencePhoto} alt="Field verification of actual report site" style={styles.previewImg} />
                </div>
              )}
              <label style={styles.fileDropzone}>
                <span>{fieldEvidencePhoto ? 'Change Site Photo' : '+ Upload Actual Site Photo'}</span>
                <input type="file" accept="image/*" onChange={(e) => handlePhotoUpload(e, setFieldEvidencePhoto)} style={{ display: 'none' }} />
              </label>
              {!fieldEvidencePhoto && <div style={styles.workflowHint}>A photo of the actual location is required for both confirmed and not-found verdicts.</div>}
            </div>

            <div style={styles.modalBtnRow}>
              <button style={styles.cancelBtn} onClick={() => setSelectedVerdictReport(null)}>Cancel</button>
              <button
                style={!fieldEvidencePhoto ? styles.btnStepDisabled : fieldVerdict === 'CONFIRMED' ? styles.confirmBtn : styles.hoaxConfirmBtn}
                onClick={handleSubmitFieldVerdict}
                disabled={isSubmitting || !fieldVerdictNotes.trim() || !fieldEvidencePhoto}
              >
                {isSubmitting ? 'Submitting...' : 'Send Verdict to Admin'}
              </button>
            </div>
          </div>
        </div>
      )}
      {previewImage && (
        <div style={styles.photoPreviewOverlay} onClick={() => setPreviewImage(null)}>
          <div style={styles.photoPreviewModal} onClick={(event) => event.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>Photo submitted with report</span>
              <button
                type="button"
                style={styles.closeBtn}
                aria-label="Close submitted photo preview"
                onClick={() => setPreviewImage(null)}
              >
                Close
              </button>
            </div>
            <img src={previewImage} alt="Full-size citizen-submitted report evidence" style={styles.fullPhotoPreview} />
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
  container: { maxWidth: '440px', margin: '0 auto', padding: '16px', fontFamily: "'Inter', sans-serif", boxSizing: 'border-box' },
  navHeader: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' },
  backBtn: { backgroundColor: 'transparent', border: 'none', color: '#0F766E', fontSize: '14px', fontWeight: '700', cursor: 'pointer' },
  headerTitle: { fontSize: '18px', fontWeight: '800', color: '#0F172A', margin: 0 },
  headerSub: { fontSize: '11px', color: '#64748B' },
  teamTabContainer: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '12px' },
  teamTabActive: { padding: '8px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '10px', fontWeight: '800', cursor: 'pointer' },
  teamTabInactive: { padding: '8px', backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: '10px', fontWeight: '700', cursor: 'pointer' },
  statusBanner: { backgroundColor: '#F0FDF4', border: '1px solid #99F6E4', color: '#0F766E', padding: '8px 12px', borderRadius: '8px', fontSize: '10px', marginBottom: '14px' },
  loadingBox: { padding: '24px', textAlign: 'center', color: '#64748B', fontSize: '12px' },
  emptyCard: { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '12px', padding: '24px', textAlign: 'center' },
  emptyTitle: { fontSize: '12px', fontWeight: '800', color: '#0F766E', marginBottom: '4px' },
  emptySub: { fontSize: '10px', color: '#64748B' },
  reportsStack: { display: 'flex', flexDirection: 'column', gap: '12px' },
  reportCard: { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '12px', padding: '14px' },
  dispatchMessage: { backgroundColor: '#F0FDF4', border: '1px solid #99F6E4', borderRadius: '8px', padding: '9px', marginBottom: '10px', fontSize: '10px', color: '#000000', lineHeight: '1.4' },
  rowBetween: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  badgeDispatched: { fontSize: '9px', fontWeight: '400', backgroundColor: '#FEF3C7', color: '#D97706', padding: '3px 8px', borderRadius: '6px' },
  badgeEnRoute: { fontSize: '9px', fontWeight: '400', backgroundColor: '#CCFBF1', color: '#0F766E', padding: '3px 8px', borderRadius: '6px' },
  badgeOnScene: { fontSize: '9px', fontWeight: '400', backgroundColor: '#DCFCE7', color: '#15803D', padding: '3px 8px', borderRadius: '6px' },
  badgeInvestigating: { fontSize: '9px', fontWeight: '400', backgroundColor: '#E0E7FF', color: '#4338CA', padding: '3px 8px', borderRadius: '6px' },
  ticketTag: { fontSize: '10px', fontWeight: '400', color: '#000000' },
  reportTitle: { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden', fontSize: '14px', fontWeight: '700', color: '#0F766E', lineHeight: '1.35', margin: '0 0 6px 0' },
  reportMeta: { fontSize: '11px', color: '#000000', fontWeight: '400', margin: '2px 0' },
  descriptionBox: { backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', padding: '8px', borderRadius: '6px', fontSize: '10px', color: '#000000', fontWeight: '400', margin: '8px 0' },
  submittedPhotoSection: { margin: '10px 0', padding: '10px', backgroundColor: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: '8px' },
  submittedPhotoHeading: { display: 'flex', flexDirection: 'column', gap: '3px', color: '#0F766E', fontSize: '10px', fontWeight: '800', marginBottom: '8px' },
  submittedPhotoHint: { color: '#475569', fontSize: '10px', fontWeight: '400' },
  submittedPhotoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))', gap: '7px' },
  submittedPhotoButton: { height: '82px', padding: 0, overflow: 'hidden', backgroundColor: '#E2E8F0', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'zoom-in' },
  submittedPhoto: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  photoPreviewOverlay: { position: 'fixed', inset: 0, zIndex: 10500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', backgroundColor: 'rgba(15, 23, 42, 0.82)' },
  photoPreviewModal: { width: '100%', maxWidth: '600px', maxHeight: '90vh', overflow: 'auto', padding: '14px', backgroundColor: '#FFFFFF', borderRadius: '12px', boxSizing: 'border-box' },
  fullPhotoPreview: { display: 'block', width: '100%', maxHeight: '75vh', objectFit: 'contain', backgroundColor: '#0F172A', borderRadius: '8px' },
  actionRow: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' },
  btnEnRoute: { padding: '8px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  btnOnScene: { padding: '8px', backgroundColor: '#15803D', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  btnResolveModal: { padding: '8px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  btnStepCompleted: { padding: '8px', backgroundColor: '#15803D', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'default' },
  btnStepDisabled: { flex: 1, padding: '8px', backgroundColor: '#E2E8F0', color: '#64748B', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '11px', fontWeight: '400', cursor: 'not-allowed' },
  workflowHint: { padding: '8px 10px', backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #CBD5E1', borderRadius: '7px', fontSize: '11px', lineHeight: '1.45' },
  btnHoaxModal: { padding: '8px', backgroundColor: '#FEF2F2', color: '#991B1B', border: '1px solid #FCA5A5', borderRadius: '6px', fontSize: '10px', fontWeight: '800', cursor: 'pointer' },
  modalBackdrop: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '16px' },
  modalContent: { backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '18px', maxWidth: '360px', width: '100%' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  modalTitle: { fontSize: '14px', fontWeight: '800', color: '#0F172A' },
  closeBtn: { backgroundColor: '#F1F5F9', border: 'none', width: '26px', height: '26px', borderRadius: '50%', fontSize: '11px', fontWeight: '800', color: '#64748B', cursor: 'pointer' },
  modalTicket: { fontSize: '10px', fontWeight: '400', color: '#000000' },
  modalHazard: { fontSize: '13px', fontWeight: '800', color: '#0F766E', marginBottom: '12px' },
  formGroup: { marginBottom: '12px' },
  label: { fontSize: '9px', fontWeight: '800', color: '#64748B', display: 'block', marginBottom: '4px' },
  textarea: { width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '11px', boxSizing: 'border-box', fontFamily: 'inherit' },
  previewBox: { width: '100%', height: '100px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #0F766E', marginBottom: '6px' },
  previewImg: { width: '100%', height: '100%', objectFit: 'cover' },
  fileDropzone: { border: '2px dashed #0F766E', backgroundColor: '#F0FDF4', padding: '8px', borderRadius: '6px', display: 'block', textAlign: 'center', fontSize: '10px', fontWeight: '800', color: '#0F766E', cursor: 'pointer' },
  modalBtnRow: { display: 'flex', gap: '8px', marginTop: '14px' },
  cancelBtn: { flex: 1, padding: '9px', backgroundColor: '#F1F5F9', color: '#475569', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  confirmBtn: { flex: 1, padding: '9px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  hoaxConfirmBtn: { flex: 1, padding: '9px', backgroundColor: '#DC2626', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }
};
