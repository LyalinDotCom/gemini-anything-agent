import type { ReactNode } from "react";
import { Asterisk, Lock, Pencil, PlusCircle, RotateCcw, Wand2 } from "lucide-react";
import { BADGE_HINT, BADGE_LABEL, type BadgeState } from "../lib/badges";

type IconType = typeof Wand2;

const BADGE_ICON: Record<BadgeState, IconType> = {
  required: Asterisk,
  fixed: Lock,
  default: Wand2,
  custom: Pencil,
  addon: PlusCircle
};

export const BadgeChip = ({ state, count }: { state: BadgeState; count?: string }) => {
  const Icon = BADGE_ICON[state];
  return (
    <span className={`badge-chip badge-${state}`} title={BADGE_HINT[state]}>
      <Icon size={11} />
      {BADGE_LABEL[state]}
      {count ? ` ${count}` : ""}
    </span>
  );
};

export const CapabilityCard = ({
  id,
  state,
  icon: Icon,
  title,
  subtitle,
  omittedNote,
  count,
  customizeLabel = "Customize",
  open,
  onCustomize,
  onReset,
  children
}: {
  id?: string;
  state: BadgeState;
  icon: IconType;
  title: string;
  subtitle?: string;
  omittedNote?: string;
  count?: string;
  customizeLabel?: string;
  /** Force the editor open even while the badge is still Default (e.g. after "Customize"). */
  open?: boolean;
  onCustomize?: () => void;
  onReset?: () => void;
  children?: ReactNode;
}) => {
  const showEditor = open ?? state !== "default";
  const resettable = state !== "default" || (open === true && state === "default");
  return (
    <section className="cap-card" data-state={state} id={id}>
      <header className="cap-head">
        <span className="cap-icon" aria-hidden>
          <Icon size={17} />
        </span>
        <div className="cap-titles">
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {resettable && onReset && (
          <button type="button" className="link-button" onClick={onReset} title="Reset to default">
            <RotateCcw size={13} />
            Reset
          </button>
        )}
      </header>

      {showEditor ? (
        <div className="cap-body">{children}</div>
      ) : (
        <div className="cap-default">
          {omittedNote && <p className="omitted-note">{omittedNote}</p>}
          {onCustomize && (
            <button type="button" className="ghost-button" onClick={onCustomize}>
              {customizeLabel}
              <Pencil size={13} />
            </button>
          )}
        </div>
      )}
    </section>
  );
};
