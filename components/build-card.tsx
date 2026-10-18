import type { ComponentProps, ReactNode } from "react";
import { RESOURCES, type Hand } from "@/lib/board";
import { GOOD_LABELS, goodImage } from "@/lib/goods-ui";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type BuildCardProps = ComponentProps<typeof Button> & {
  label: string;
  cost: Partial<Hand>;
  remaining?: number;
  children: ReactNode;
};

export default function BuildCard({
  label, cost, remaining, children, disabled, ...props
}: BuildCardProps) {
  const resources = RESOURCES.flatMap(resource =>
    Array.from({ length: cost[resource] ?? 0 }, () => resource),
  );
  const description = RESOURCES.filter(resource => cost[resource]).map(resource =>
    `${cost[resource]} ${GOOD_LABELS[resource]}`,
  ).join(", ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="build-card-control" tabIndex={disabled ? 0 : undefined}
          role="group" aria-label={`${label}: ${description}${remaining === undefined ? "" : `; ${remaining} remaining`}`}>
          <Button {...props} disabled={disabled} aria-label={label}>
            {children}
          </Button>
          {remaining !== undefined && <span className="build-stock" aria-hidden="true">{remaining}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8} className="build-cost-tooltip">
        <span className="sr-only">{label} costs {description}.</span>
        <div className="build-cost-preview" aria-hidden="true">
          {resources.map((resource, index) => (
            <img key={`${resource}-${index}`} src={goodImage(resource)} alt="" />
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
