import type { CSSProperties, ReactNode } from "react";
import { T } from "../tokens";

const ICON_PATHS: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  send: "M5 12 20 5l-3.5 7L20 19 5 12Zm0 0h8",
  stop: "M7 7h10v10H7z",
  mic: "M12 3a3 3 0 0 1 3 3v5a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3Zm-6 8a6 6 0 0 0 12 0M12 17v4",
  image: "M4 5h16v14H4zM4 15l4.5-4.5L13 15m2-2 2.5-2.5L20 13M15 9h.01",
  gear: "M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Zm7.5 3.5-.9-2.6 1.4-2-2.4-2.4-2 1.4L13 5.5 12 3l-1-.1-1 2.6-2.6.9-2-1.4L3 7.4l1.4 2L3.5 12l2.6 1 .9 2.6-1.4 2 2.4 2.4 2-1.4 2.6.9 1 2.5 1-.1 1-2.4 2.6-.9 2 1.4 2.4-2.4-1.4-2 .9-2.6 2.4-1Z",
  trash: "M5 7h14M10 7V5h4v2m-6 0 .7 12h6.6L16 7M10 11v5m4-5v5",
  chat: "M4 5h16v11H9l-5 4V5Z",
  x: "M6 6l12 12M18 6 6 18",
  copy: "M9 9h10v12H9zM5 15V3h10",
  download: "M12 3v12m0 0 4-4m-4 4-4-4M4 19h16",
  chevron: "M8 10l4 4 4-4",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm9.5 16-4.4-4.4",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z",
  code: "M8 6 3 12l5 6m8-12 5 6-5 6M14 4l-4 16",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 11 .9 2.6L22.5 18l-2.6.9L19 21.5l-.9-2.6L15.5 18l2.6-1.4L19 14Z",
  brain: "M12 4a3 3 0 0 0-3 3v10a3 3 0 1 0 6 0V7a3 3 0 0 0-3-3Zm-3 4H7a3 3 0 0 0 0 6h2m6-6h2a3 3 0 0 1 0 6h-2",
  menu: "M4 7h16M4 12h16M4 17h16",
  folder: "M3 6h6l2 2h10v11H3zM3 6v13",
};

export function Icon({ name, size = 18, color, style }: { name: string; size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
    >
      <path d={ICON_PATHS[name] ?? ICON_PATHS.sparkle} />
    </svg>
  );
}

export function Spinner({ size = 16, color = T.textDim }: { size?: number; color?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        border: `2px solid ${color}`,
        borderTopColor: "transparent",
        animation: "aichat-spin 0.8s linear infinite",
      }}
    />
  );
}

export function IconButton({
  name,
  label,
  onClick,
  danger,
  size = 18,
  disabled,
  style,
}: {
  name: string;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  size?: number;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: T.radiusSm,
        border: "none",
        background: "transparent",
        color: danger ? T.danger : T.textDim,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        ...style,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = T.bgHover;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <Icon name={name} size={size} />
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "10px 18px",
        borderRadius: T.radiusSm,
        border: "none",
        background: disabled ? T.bgHover : T.accent,
        color: disabled ? T.textFaint : "#0B0B0D",
        fontWeight: 600,
        fontSize: 14,
        cursor: disabled || busy ? "default" : "pointer",
        ...style,
      }}
    >
      {busy ? <Spinner size={14} color="#0B0B0D" /> : null}
      {children}
    </button>
  );
}
