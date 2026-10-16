export type AttendanceStatus = "present" | "absent";

export const statusLabel: Record<AttendanceStatus | "none", string> = {
  present: "Playing",
  absent: "Not playing",
  none: "Not recorded",
};

/** Text marks so status never depends on colour alone. */
export const statusMark: Record<AttendanceStatus | "none", string> = {
  present: "✓",
  absent: "✕",
  none: "–",
};
