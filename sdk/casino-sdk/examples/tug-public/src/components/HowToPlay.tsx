import { useEffect, useRef } from "react";

const STORAGE_KEY = "tug.how-to-play.dismissed.v1";
let dismissedThisVisit = false;

export function HowToPlay({ available = true }: { available?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const open = () => {
    const dialog = dialogRef.current;
    if (!available || !dialog || dialog.open) return;
    dialog.showModal();
    titleRef.current?.focus();
  };

  const dismiss = () => {
    dismissedThisVisit = true;
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Private/restricted storage must never prevent dismissal or play.
    }
    dialogRef.current?.close();
    triggerRef.current?.focus();
  };

  useEffect(() => {
    let dismissed = dismissedThisVisit;
    try {
      dismissed ||= localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Retain the in-memory fallback when browser storage is unavailable.
    }
    if (!dismissed && available) open();
    const dialog = dialogRef.current;
    return () => dialog?.close();
  }, [available]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="help-trigger"
        onClick={open}
        aria-haspopup="dialog"
        aria-controls="how-to-play"
        disabled={!available}
      >
        How to play
      </button>
      <dialog
        ref={dialogRef}
        id="how-to-play"
        className="how-to-play"
        aria-labelledby="how-to-play-title"
        aria-describedby="how-to-play-steps"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons =
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === titleRef.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          dismiss();
        }}
      >
        <button
          type="button"
          className="help-close"
          aria-label="Close how to play"
          onClick={dismiss}
        >
          Close
        </button>
        <h2 ref={titleRef} id="how-to-play-title" tabIndex={-1}>
          How to play Tug
        </h2>
        <p
          className="help-sequence"
          aria-label="Pick a grip, then survive the tug, then bank or climb again"
        >
          <span>Pick a grip</span>
          <i aria-hidden>→</i>
          <span>Survive the tug</span>
          <i aria-hidden>→</i>
          <span>Bank or climb again</span>
        </p>
        <ol id="how-to-play-steps">
          <li>Set your wager and start the round.</li>
          <li>Choose Ease, Steady or Haul. More risk means a higher payout.</li>
          <li>
            Bank after surviving, or pull again. If the rope snaps, you lose the
            wager.
          </li>
        </ol>
        <button type="button" className="btn primary xl" onClick={dismiss}>
          Start playing
        </button>
      </dialog>
    </>
  );
}
