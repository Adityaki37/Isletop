import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export default function HandCardHelp({ label, effect, status, disabled, children }: {
  label: string; effect: string; status?: string; disabled?: boolean; children: ReactNode;
}) {
  return <Tooltip disableHoverableContent>
    <TooltipTrigger asChild>
      <span className="hand-card-help" role="group" aria-label={label} tabIndex={disabled ? 0 : undefined}>
        {children}
      </span>
    </TooltipTrigger>
    <TooltipContent side="top" sideOffset={10} collisionPadding={12} className="hand-card-tooltip">
      <strong>{label}</strong>
      <p>{effect}</p>
      {status && <small>{status}</small>}
    </TooltipContent>
  </Tooltip>;
}
