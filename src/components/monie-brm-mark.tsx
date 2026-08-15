import { cn } from "@/lib/utils";

const MONIEPOINT_LOGO_URL =
  "https://eu-west-2.graphassets.com/AxQ8YTi9LTCrOeR0pPuwfz/cmk3yx2dd15il07lco5cye9zy";

export function MonieBrmMark({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex flex-col items-center justify-center", className)}>
      <img
        src={MONIEPOINT_LOGO_URL}
        alt="Moniepoint"
        className={cn("w-auto object-contain", compact ? "h-5 max-w-24" : "h-7 max-w-32")}
      />
      <span
        className={cn(
          "font-extrabold uppercase tracking-[0.22em] text-primary",
          compact ? "mt-0.5 text-[7px]" : "mt-1 text-[9px]",
        )}
      >
        BRM
      </span>
    </div>
  );
}
