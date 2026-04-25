import React, { useEffect } from "react";
import { WorkoutEditor } from "./WorkoutEditor.jsx";

/**
 * Modal wrapper around {@link WorkoutEditor}. Keeps the popup chrome (backdrop, card, header,
 * close button, body-scroll lock) separate from the editor logic so the same editor can also be
 * rendered inline (Today view) without carrying modal-only behavior.
 *
 * All editor-level props are forwarded as-is; {@code modalKicker}/{@code modalKickerDetail} style
 * the popup header (e.g. "Edit workout" + date label).
 */
export function WorkoutModal({
  loadExercisePicker,
  createUserExercise,
  draftLines,
  setDraftLines,
  exerciseMeta,
  setExerciseMeta,
  isSubmitting,
  submitError,
  onClose,
  onDraftPersist,
  modalKicker = "Add workout",
  modalKickerDetail = "",
}) {
  useEffect(() => {
    // Lock background scroll for the duration of the popup; restore whatever was there before
    // so stacked modals / inline layouts don't clobber each other.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div className="modal-card">
          <div className="modal-head">
            <div>
              <div className="modal-kicker" id="modalTitle">
                {modalKicker}
              </div>
              {modalKickerDetail ? (
                <p className="modal-head-detail">{modalKickerDetail}</p>
              ) : null}
            </div>
            <button
              className="icon-btn"
              type="button"
              aria-label="Close"
              onClick={onClose}
            >
              X
            </button>
          </div>

          <WorkoutEditor
            loadExercisePicker={loadExercisePicker}
            createUserExercise={createUserExercise}
            draftLines={draftLines}
            setDraftLines={setDraftLines}
            exerciseMeta={exerciseMeta}
            setExerciseMeta={setExerciseMeta}
            isSubmitting={isSubmitting}
            submitError={submitError}
            onDraftPersist={onDraftPersist}
            onEscape={onClose}
          />
        </div>
      </div>
    </>
  );
}
