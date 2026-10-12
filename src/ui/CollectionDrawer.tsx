"use client";
// A drawer listing everything the player has made; tapping one travels there.

import { useGame } from "@/state/store";
import { getKind } from "@/core/kinds";
import { useArtworkUrls } from "./CreationPanel";
import { travelTo } from "./GalleryPanels";
import { CloseIcon, PencilIcon } from "./Icons";
import { playSfx } from "@/audio/sfx";

function Thumb({ artworkId, cut }: { artworkId: string; cut: boolean }) {
  const urls = useArtworkUrls(artworkId);
  return urls ? <img src={cut ? urls.cutoutUrl : urls.originalUrl} alt="" /> : <span className="spinner-small" style={{ margin: 19 }} />;
}

export function CollectionDrawer() {
  const world = useGame((s) => s.world);
  const runtime = useGame((s) => s.runtime);
  const mode = useGame((s) => s.mode);
  const { openPanel } = useGame.getState();
  if (!world || !runtime) return null;
  const items =
    mode === "gallery"
      ? world.easels.map((e) => ({ id: e.id, artworkId: e.artworkId, title: e.title, sub: e.artist ? `by ${e.artist}` : "", emoji: "🖼️" }))
      : world.creations.map((c) => {
          const k = getKind(c.kind);
          const pos = runtime.positionOf(c.id);
          return { id: c.id, artworkId: c.artworkId, title: c.name, sub: `${k.label}${pos ? ` · ${runtime.regionNameAt(pos)}` : ""}`, emoji: k.emoji };
        });

  const go = (id: string) => {
    playSfx("whoosh");
    travelTo(id);
    openPanel(mode === "gallery" ? "easel" : "creation", id);
  };

  return (
    <>
      <div className="drawer-backdrop" onPointerDown={() => openPanel(null)} />
      <aside className="drawer paper" aria-label="My collection">
        <div className="modal-head">
          <h2>{mode === "gallery" ? "My gallery" : "My drawings"}</h2>
          <button className="icon-btn close-x" onClick={() => openPanel(null)} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="collection-list">
          {items.length === 0 ? (
            <div className="empty-state">
              <div className="big-emoji">🖍️</div>
              <p>Nothing here yet. Draw something and it will show up here!</p>
              <button className="btn green" onClick={() => openPanel("draw")}>
                <PencilIcon /> Draw
              </button>
            </div>
          ) : (
            [...items].reverse().map((it) => (
              <button key={it.id} className="collection-item" onClick={() => go(it.id)}>
                <Thumb artworkId={it.artworkId} cut={mode !== "gallery"} />
                <span className="info">
                  <strong>
                    {it.emoji} {it.title}
                  </strong>
                  <span className="small muted">{it.sub}</span>
                </span>
                <span aria-hidden style={{ fontSize: "1.4rem" }}>
                  ➜
                </span>
              </button>
            ))
          )}
        </div>
      </aside>
    </>
  );
}

