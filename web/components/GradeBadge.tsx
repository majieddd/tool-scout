type Letter = "S" | "A" | "B" | "C" | "D" | "F";

const LETTER_BG: Record<Letter, string> = {
  S: "bg-grade-s",
  A: "bg-grade-a",
  B: "bg-grade-b",
  C: "bg-grade-c",
  D: "bg-grade-d",
  F: "bg-grade-f",
};

const LETTER_LABEL: Record<Letter, string> = {
  S: "Stop everything",
  A: "Install this week",
  B: "Solid, try soon",
  C: "Situational",
  D: "Probably skip",
  F: "Irrelevant or dead",
};

export function GradeBadge({
  letter,
  size = "md",
  showLabel = false,
}: {
  letter?: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}) {
  const L = ((letter || "F").toUpperCase() as Letter) || "F";
  const sizing = {
    sm: "w-7 h-7 text-xs",
    md: "w-10 h-10 text-base",
    lg: "w-14 h-14 text-xl",
  }[size];
  return (
    <div className="flex items-center gap-3" title={LETTER_LABEL[L]}>
      <span
        className={`${sizing} ${LETTER_BG[L]} rounded-md flex items-center justify-center font-mono font-bold text-bg shrink-0`}
      >
        {L}
      </span>
      {showLabel && (
        <span className="text-sm text-ink-muted">{LETTER_LABEL[L]}</span>
      )}
    </div>
  );
}
