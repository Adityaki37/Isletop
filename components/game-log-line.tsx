import { goodImage, GOOD_LABELS } from "@/lib/goods-ui";
import type { Good } from "@/lib/cities-knights";
import { COLORS } from "@/lib/board";
import Image from "next/image";
const names: Record<string, Good> = {
  wood: "wood",
  lumber: "wood",
  brick: "brick",
  sheep: "sheep",
  wool: "sheep",
  wheat: "wheat",
  grain: "wheat",
  ore: "ore",
  stone: "ore",
  paper: "paper",
  cloth: "cloth",
  coin: "coin",
};
const cardList = String.raw`\d+ (?:wood|brick|sheep|wheat|ore|paper|cloth|coin)(?: and \d+ (?:wood|brick|sheep|wheat|ore|paper|cloth|coin))*`;
const receiptPattern = new RegExp(`^ got (${cardList})(?: from (gold|Aqueduct))?\\.$`);
const tradePattern = new RegExp(`^ traded (${cardList}) for (${cardList}) with (.+)\\.$`);
function LogCards({ cards }: { cards: string }) {
  return cards.split(" and ").map(card => {
    const [count, resource] = card.split(" ");
    const good = resource as Good;
    const label = `${count} ${GOOD_LABELS[good]}`;
    return <span key={good} className="log-production" title={label} aria-label={label}>
      <Image src={goodImage(good)} alt="" width={22} height={30} /><strong aria-hidden="true">×{count}</strong>
    </span>;
  });
}
export default function GameLogLine({
  text,
  players = [],
}: {
  text: string;
  players?: { name: string; color: number }[];
}) {
  const speaker = players.find((p) => text.startsWith(`${p.name} `));
  const message = speaker ? text.slice(speaker.name.length) : text;
  const receipt = speaker && message.match(receiptPattern);
  const trade = speaker && message.match(tradePattern);
  return (
    <>
      {speaker && (
        <strong
          className="log-player"
          style={{ color: speaker.color === 3 ? "#637078" : COLORS[speaker.color] }}
        >
          {speaker.name}
        </strong>
      )}
      {receipt ? (
        <> got <LogCards cards={receipt[1]} />{receipt[2] && ` from ${receipt[2]}`}.</>
      ) : trade ? (
        <> traded <LogCards cards={trade[1]} /> for <LogCards cards={trade[2]} /> with {trade[3]}.</>
      ) : message
        .split(
          /\b(wood|lumber|brick|sheep|wool|wheat|grain|ore|stone|paper|cloth|coin)\b/gi,
        )
        .map((part, i) =>
          names[part.toLowerCase()] ? (
            <span key={i} className="log-resource">
              <img src={goodImage(names[part.toLowerCase()])} alt="" />
              {part}
            </span>
          ) : (
            part
          ),
        )}
    </>
  );
}
