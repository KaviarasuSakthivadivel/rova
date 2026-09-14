// Shared stroke-icon primitive — same shape as the ad hoc Icon helpers in
// Layout.tsx/PacketDetail.tsx, pulled out once a third/fourth place
// (JobCard, JobListItem) needed the same thing.
export function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const ICONS = {
  addToPipeline: "M12 5v14M5 12h14",
  inPipeline: "m5 13 4 4L19 7",
};
