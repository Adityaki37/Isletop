"use client";
import { useEffect, useRef, useState } from "react";
import type { View } from "@/lib/game";
import { renderResultImage, resultImageModel } from "@/lib/result-image";
import IslandBoard from "./board";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

export default function ShareResult({ game }: { game: View }) {
  const [snapshot, setSnapshot] = useState<View | null>(null);
  if (game.phase !== "finished" || game.winner === null) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setSnapshot(game)}>
        Share Results
      </Button>
      {snapshot && (
        <ResultImageDialog game={snapshot} onClose={() => setSnapshot(null)} />
      )}
    </>
  );
}
function ResultImageDialog({
  game,
  onClose,
}: {
  game: View;
  onClose: () => void;
}) {
  const source = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setImage(null);
    setError("");
    setMessage("");
    setCanShare(false);
    void (async () => {
      try {
        const board = source.current?.querySelector("svg");
        if (!board)
          throw new Error("Unable to read the final board. Please retry.");
        const blob = await renderResultImage(
          resultImageModel(game),
          board,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage({ blob, url });
        try {
          setCanShare(
            typeof navigator.share === "function" &&
              !!navigator.canShare?.({
                files: [
                  new File([blob], "island-table-results.png", {
                    type: "image/png",
                  }),
                ],
              }),
          );
        } catch {
          setCanShare(false);
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Unable to create result image. Please retry.",
          );
      }
    })();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [game, attempt]);
  const copy = async () => {
    if (!image || busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
        throw new Error();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": image.blob }),
      ]);
      setMessage("Image copied.");
    } catch {
      setMessage(
        "Unable to copy the image in this browser. Download the PNG instead.",
      );
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (!image || busy) return;
    const url = URL.createObjectURL(image.blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "island-table-results.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("PNG downloaded.");
  };
  const share = async () => {
    if (!image || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await navigator.share({
        files: [
          new File([image.blob], "island-table-results.png", {
            type: "image/png",
          }),
        ],
        title: "Game results",
      });
      setMessage("Image shared.");
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError"))
        setMessage(
          "Unable to share the image in this browser. Download the PNG instead.",
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="result-board-source" ref={source} aria-hidden="true">
        <IslandBoard
          board={game.board}
          cities={game.cities}
          playerColors={game.players.map((p) => p.color)}
        />
      </div>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="share-result-dialog">
          <DialogTitle>Share Results</DialogTitle>
          <DialogDescription className="sr-only">
            Download or copy a PNG of the final board and every player's score.
          </DialogDescription>
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <Button onClick={() => setAttempt((a) => a + 1)}>Retry</Button>
            </div>
          ) : image ? (
            <img
              className="result-image-preview"
              src={image.url}
              alt={`Final board and scores: ${game.players.map((p) => `${p.name}, ${p.score} points`).join("; ")}`}
              width={1080}
              height={608}
            />
          ) : (
            <p role="status">Preparing result image…</p>
          )}
          <div className="result-share-actions">
            <Button
              className="green-button"
              disabled={!image || busy}
              onClick={download}
            >
              Download
            </Button>
            <Button
              className="green-button"
              disabled={!image || busy}
              onClick={() => void copy()}
            >
              Copy Image
            </Button>
            {canShare && (
              <Button
                className="green-button"
                disabled={!image || busy}
                onClick={() => void share()}
              >
                Share Image
              </Button>
            )}
          </div>
          {message && <p role="status">{message}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
