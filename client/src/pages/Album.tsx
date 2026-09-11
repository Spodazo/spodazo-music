import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Link, useRoute } from "wouter";
import AdminLoginLink from "../components/AdminLoginLink";
import {
  assignSrc,
  dropLegacyAudioCaches,
  pipelineIsDead,
  playSong,
  setPlaybackSession,
  START_OFFSET,
  unlockAudio,
} from "../lib/audioCache";
import { fetchAlbum } from "../lib/api";
import { totalListeningLabel } from "../lib/listeningTime";
import { lyricScrollAt, songLengthSeconds } from "../lib/lyricScroll";
import { copyText, songShareUrl } from "../lib/shareLink";
import { copyrightLines, DEFAULT_PLAYER_SETUP } from "@shared/seed-data";
import type { PublicAlbum, PublicTrack } from "@shared/types";
import { applyPalette } from "../lib/palette";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function introductionBody(text: string): string {
  return text.replace(/^\s*Introduction\s*\r?\n+/i, "").trim();
}

function trackHasLyrics(track: { lyrics: string; instrumental?: boolean } | null): boolean {
  if (!track || track.instrumental) return false;
  const lyrics = track.lyrics.replace(/^\s*Introduction\s*\r?\n+/i, "").trim();
  if (!lyrics || /^lyrics can be added/i.test(lyrics)) return false;
  return Boolean(lyrics.replace(/^\[[^\]]+\]\s*/gm, "").trim());
}

function AlbumsBack({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`albums-back${className ? ` ${className}` : ""}`} aria-label="Back to albums">
      <IconBack />
      Albums
    </Link>
  );
}

function CopyrightLines({ text }: { text: string }) {
  const parts = copyrightLines(text);
  return (
    <p className="copyright">
      {parts.map((line, index) => (
        <span key={index}>
          {index > 0 ? <br /> : null}
          {line}
        </span>
      ))}
    </p>
  );
}

export default function AlbumPage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug || "";
  const [album, setAlbum] = useState<PublicAlbum | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [enlargedCover, setEnlargedCover] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [durations, setDurations] = useState<Record<string, string>>({});
  const [repeatAll, setRepeatAll] = useState(false);
  const [repeatOne, setRepeatOne] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const albumRef = useRef<PublicAlbum | null>(null);
  const currentUrlRef = useRef("");
  const resumeTimeRef = useRef(0);
  const userVolRef = useRef(0.85);
  const lyricsRef = useRef<HTMLDivElement | null>(null);
  const lyricsSheetRef = useRef<HTMLDivElement | null>(null);
  const lyricsTrackRef = useRef<HTMLDivElement | null>(null);
  const lyricsClock = useRef({ media: 0, stamp: 0, lastTick: 0, displayed: 0 });
  const lyricsDrag = useRef({
    holding: false,
    follow: true,
    offset: 0,
    originY: 0,
    grabY: 0,
    moved: false,
  });
  const sheetPull = useRef({ dragging: false, startY: 0, y: 0, moved: false });

  function rememberTime() {
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.currentTime) && audio.currentTime > 0.15) {
      resumeTimeRef.current = audio.currentTime;
    }
  }

  useEffect(() => {
    fetchAlbum(slug)
      .then((data) => {
        setAlbum(data);
        applyPalette(data.color);
        document.title = `${data.title} — ${data.artists}`;
      })
      .catch((err: Error) => setError(err.message));
  }, [slug]);

  const track = useMemo(
    () => (album && active !== null ? album.tracks[active] : null),
    [album, active],
  );
  const listeningTime = useMemo(
    () =>
      album
        ? totalListeningLabel(album.tracks.map((item) => durations[item.id] || item.durationLabel))
        : "",
    [album, durations],
  );
  const introduction = track ? introductionBody(track.introduction) : "";

  useEffect(() => {
    albumRef.current = album;
  }, [album]);

  useEffect(() => {
    setPlaybackSession();
    void dropLegacyAudioCaches();
    const onHide = () => rememberTime();
    const onVisibility = () => {
      if (document.hidden) onHide();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("freeze", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("freeze", onHide);
    };
  }, []);

  useEffect(() => {
    if (!album) return;
    const fromHash = () => {
      const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
      if (!hash) return;
      const index = album.tracks.findIndex((item) => item.slug === hash || item.key === hash);
      if (index >= 0) openAt(index, false);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [album]);

  async function acquireWake() {
    try {
      if ("wakeLock" in navigator) {
        wakeRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      /* ignore */
    }
  }

  function releaseWake() {
    wakeRef.current?.release().catch(() => undefined);
    wakeRef.current = null;
  }

  function startPlay() {
    const audio = audioRef.current;
    const url = currentUrlRef.current;
    if (!audio || !url) return Promise.resolve();
    unlockAudio();
    audio.volume = userVolRef.current;
    return playSong(audio, url, START_OFFSET, true);
  }

  function warm() {
    unlockAudio();
  }

  function load(index: number, autoplay: boolean) {
    const catalog = albumRef.current;
    const next = catalog?.tracks[index];
    const audio = audioRef.current;
    if (!next || !audio) return;
    currentUrlRef.current = next.audioUrl;
    resumeTimeRef.current = 0;
    setEnlargedCover(null);
    if (autoplay) {
      void startPlay().then(() => {
        setPlaying(true);
        window.setTimeout(() => acquireWake(), 400);
      }).catch(() => setPlaying(false));
    } else {
      assignSrc(audio, next.audioUrl);
    }
    window.setTimeout(() => {
      history.replaceState(null, "", `#${next.slug}`);
    }, 250);
  }

  function playAt(index: number, autoplay: boolean) {
    load(index, autoplay);
    setActive(index);
  }

  function openAt(index: number, autoplay: boolean) {
    playAt(index, autoplay);
    setModalOpen(true);
  }

  function closeModal() {
    setEnlargedCover(null);
    setLyricsOpen(false);
    setModalOpen(false);
    history.replaceState(null, "", location.pathname + location.search);
  }

  function navigate(delta: number) {
    if (!album || active === null) return;
    const next = (active + delta + album.tracks.length) % album.tracks.length;
    openAt(next, true);
  }

  function lyricPlayhead(): number {
    const audio = audioRef.current;
    if (!audio) return 0;
    const media = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const clock = lyricsClock.current;
    const now = performance.now();
    if (audio.paused) {
      clock.media = media;
      clock.stamp = now;
      return media;
    }
    if (!clock.stamp) {
      clock.media = media;
      clock.stamp = now;
      return media;
    }
    const estimated = clock.media + (now - clock.stamp) / 1000;
    if (Math.abs(media - estimated) > 0.6) {
      clock.media = media;
      clock.stamp = now;
      return media;
    }
    return estimated;
  }

  function lyricMaxScroll(): number {
    const view = lyricsRef.current;
    const trackEl = lyricsTrackRef.current;
    if (!view || !trackEl) return 0;
    return Math.max(0, trackEl.scrollHeight - view.clientHeight);
  }

  function lyricNaturalScroll(): number {
    const audio = audioRef.current;
    const length = songLengthSeconds(audio?.duration ?? 0) || songLengthSeconds(duration);
    return lyricScrollAt(lyricPlayhead(), length, lyricMaxScroll());
  }

  function applyLyricY(y: number) {
    const max = lyricMaxScroll();
    const next = Math.max(0, Math.min(max, y));
    lyricsClock.current.displayed = next;
    if (lyricsTrackRef.current) {
      lyricsTrackRef.current.style.transform = `translate3d(0, ${-next}px, 0)`;
    }
  }

  function resetLyricFollow() {
    lyricsDrag.current.offset = 0;
    lyricsDrag.current.follow = true;
    lyricsDrag.current.holding = false;
    lyricsClock.current.media = 0;
    lyricsClock.current.stamp = 0;
    lyricsClock.current.displayed = 0;
    applyLyricY(0);
  }

  function setSheetOffset(y: number) {
    sheetPull.current.y = Math.max(0, y);
    if (lyricsSheetRef.current) {
      lyricsSheetRef.current.style.transform = sheetPull.current.y
        ? `translateY(${sheetPull.current.y}px)`
        : "";
    }
  }

  function openLyricsSheet() {
    setSheetOffset(0);
    resetLyricFollow();
    setLyricsOpen(true);
  }

  function closeLyricsSheet() {
    setSheetOffset(0);
    setLyricsOpen(false);
  }

  useEffect(() => {
    setLyricsOpen(false);
    setSheetOffset(0);
    resetLyricFollow();
  }, [track?.id]);

  useEffect(() => {
    if (!track || !lyricsOpen) return;
    const el = lyricsRef.current;
    if (!el) return;
    const blockBounce = (event: TouchEvent) => event.preventDefault();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      lyricsDrag.current.offset += event.deltaY;
    };
    el.addEventListener("touchmove", blockBounce, { passive: false });
    el.addEventListener("wheel", onWheel, { passive: false });
    lyricsClock.current.lastTick = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const drag = lyricsDrag.current;
      lyricsClock.current.lastTick = now;
      if (!drag.holding && drag.follow) {
        applyLyricY(lyricNaturalScroll() + drag.offset);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      el.removeEventListener("touchmove", blockBounce);
      el.removeEventListener("wheel", onWheel);
    };
  }, [track, lyricsOpen]);

  function onLyricsPointerDown(event: PointerEvent<HTMLDivElement>) {
    const el = lyricsRef.current;
    if (!el) return;
    const drag = lyricsDrag.current;
    drag.holding = true;
    drag.follow = false;
    drag.originY = event.clientY;
    drag.grabY = lyricsClock.current.displayed;
    drag.moved = false;
    el.setPointerCapture(event.pointerId);
  }

  function onLyricsPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = lyricsDrag.current;
    if (!drag.holding) return;
    const travel = drag.originY - event.clientY;
    if (Math.abs(travel) > 6) drag.moved = true;
    applyLyricY(drag.grabY + travel);
    event.preventDefault();
  }

  function onLyricsPointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = lyricsDrag.current;
    if (!drag.holding) return;
    const el = lyricsRef.current;
    drag.holding = false;
    if (el) {
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      drag.offset = drag.moved ? lyricsClock.current.displayed - lyricNaturalScroll() : 0;
    }
    drag.follow = true;
  }

  function onSheetHandleDown(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const pull = sheetPull.current;
    pull.dragging = true;
    pull.startY = event.clientY;
    pull.y = 0;
    pull.moved = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onSheetHandleMove(event: PointerEvent<HTMLButtonElement>) {
    const pull = sheetPull.current;
    if (!pull.dragging) return;
    const y = event.clientY - pull.startY;
    if (Math.abs(y) > 6) pull.moved = true;
    setSheetOffset(y);
    event.preventDefault();
  }

  function onSheetHandleUp(event: PointerEvent<HTMLButtonElement>) {
    const pull = sheetPull.current;
    if (!pull.dragging) return;
    pull.dragging = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    const threshold = Math.max(80, (lyricsSheetRef.current?.clientHeight || 240) * 0.22);
    if (!pull.moved || pull.y > threshold) closeLyricsSheet();
    else setSheetOffset(0);
  }

  function restartSong() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = START_OFFSET;
    setCurrentTime(0);
    resetLyricFollow();
  }

  function togglePlay() {
    const audio = audioRef.current;
    const url = currentUrlRef.current;
    if (!audio || !url) return;
    if (audio.paused) {
      const resumeTime = audio.currentTime > 0.15 ? audio.currentTime : resumeTimeRef.current;
      const fromStart = resumeTime < 0.2;
      const play = fromStart
        ? startPlay()
        : pipelineIsDead(audio)
          ? playSong(audio, url, resumeTime, true)
          : audio.play().then(() => undefined);
      void play.then(() => {
        setPlaying(true);
        acquireWake();
      }).catch(() => undefined);
    } else {
      rememberTime();
      audio.pause();
      setPlaying(false);
      releaseWake();
    }
  }

  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = repeatOne;
  }, [repeatOne]);

  function onEnded() {
    if (repeatOne) return;
    if (!album || active === null) return;
    if (active < album.tracks.length - 1) {
      playAt(active + 1, true);
      return;
    }
    if (repeatAll) {
      playAt(0, true);
      return;
    }
    setPlaying(false);
    releaseWake();
  }

  function seek(event: MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    audio.currentTime = ((event.clientX - rect.left) / rect.width) * duration;
  }

  const player = (
    <audio
      ref={audioRef}
      preload="none"
      playsInline
      onTimeUpdate={(event) => {
        const time = event.currentTarget.currentTime;
        setCurrentTime(time);
        if (time > 0.15) resumeTimeRef.current = time;
      }}
      onDurationChange={(event) => {
        const seconds = event.currentTarget.duration || 0;
        setDuration(seconds);
        if (track && seconds) {
          setDurations((prev) => ({ ...prev, [track.id]: formatTime(seconds) }));
        }
      }}
      onEnded={onEnded}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
    />
  );

  return (
    <>
      {player}
      {error ? (
        <main className="home"><AdminLoginLink /><AlbumsBack /><p className="error">{error}</p></main>
      ) : !album ? (
        <main className="home"><AdminLoginLink /><AlbumsBack /><p>Loading…</p></main>
      ) : (
    <div className="layout">
      <AdminLoginLink />
      <aside className="portrait-panel">
        <AlbumsBack className="albums-back-on-art" />
        {(album.thumbUrl || album.heroUrl) ? (
          <img className="portrait-img" src={album.thumbUrl || album.heroUrl} alt={`${album.title} — ${album.artists}`} fetchPriority="low" decoding="async" />
        ) : null}
      </aside>
      <section className="track-panel">
        <div className="album-head">
          <AlbumsBack />
          <h1 className="alb-name2">{album.title}</h1>
          <p className="alb-tag">{album.tagline}</p>
          <p className="alb-credit">{album.credits}</p>
        </div>
        <div className="album-hero">
          <div className="album-stats">
            <span className="song-count">{album.tracks.length} Songs</span>
            {listeningTime ? (
              <span className="listening-time">
                Total Listening Time
                <span>{listeningTime}</span>
              </span>
            ) : null}
          </div>
          <div className="hero-play">
            <button
              className="btn-play-all"
              onPointerDown={() => warm()}
              onClick={() => openAt(0, true)}
            >
              <IconPlay />
              Play All
            </button>
            <button
              className={`btn-repeat-all${repeatAll ? " on" : ""}`}
              onClick={() => setRepeatAll((on) => !on)}
              title={repeatAll ? "Repeat all on" : "Repeat all"}
              aria-pressed={repeatAll}
              aria-label="Repeat all"
            >
              <IconRepeat />
              All
            </button>
          </div>
          {album.artistUrl ? (
            <img
              className="hero-thumb"
              src={album.artistUrl}
              alt={album.artists}
              title={album.artists}
              fetchPriority="low"
              decoding="async"
              onClick={() => setLightbox(true)}
            />
          ) : null}
        </div>
        <div className="tracks">
          {album.tracks.map((item, index) => (
            <TrackRow
              key={item.id}
              track={item}
              albumSlug={album.slug}
              index={index}
              durationLabel={durations[item.id] || item.durationLabel}
              active={active === index}
              isPlaying={active === index && playing}
              enlarged={enlargedCover === `list:${item.id}`}
              onZoom={
                item.imageUrl
                  ? () => setEnlargedCover((cur) => (cur === `list:${item.id}` ? null : `list:${item.id}`))
                  : undefined
              }
              onWarm={() => warm()}
              onPlay={() => openAt(index, true)}
            />
          ))}
        </div>
        <footer className="site-footer">
          <CopyrightLines text={album.copyright || DEFAULT_PLAYER_SETUP.copyright} />
          <div className="sdg">
            <IconCross />
            Soli Deo Gloria
          </div>
        </footer>
      </section>

      {track && modalOpen ? (
        <div className="modal open">
          <div className={`modal-card${enlargedCover === `player:${track.id}` ? " cover-enlarged" : ""}`}>
            <div className="modal-head">
              {track.imageUrl ? (
                <button
                  type="button"
                  className={`m-cover${enlargedCover === `player:${track.id}` ? " enlarged" : ""}`}
                  style={{ backgroundImage: `url("${track.imageUrl}")` }}
                  aria-label={enlargedCover === `player:${track.id}` ? `Shrink ${track.title} cover` : `Enlarge ${track.title} cover`}
                  onClick={() => setEnlargedCover((cur) => (cur === `player:${track.id}` ? null : `player:${track.id}`))}
                />
              ) : (
                <div className="m-cover" />
              )}
              <div className="m-meta">
                <div className="m-title">{track.title}</div>
                {track.scripture ? <div className="m-subtitle">{track.scripture}</div> : null}
              </div>
              <button className="btn-close" onClick={closeModal} title="Close" aria-label="Close">
                <IconClose />
              </button>
            </div>
            <div className="transport">
              <div className="progress-wrap">
                <span className="time">{formatTime(currentTime)}</span>
                <div className="prog-bar" onClick={seek}>
                  <div className="prog-fill" style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }} />
                </div>
                <span className="time">{formatTime(duration)}</span>
              </div>
              <div className="controls">
                <button className="ctrl" onClick={restartSong} title="Back to beginning" aria-label="Back to beginning">
                  <IconRestart />
                </button>
                <button className="ctrl" onClick={() => navigate(-1)} title="Previous" aria-label="Previous">
                  <IconPrev />
                </button>
                <button className="btn-play-modal" onClick={togglePlay} title="Play / Pause" aria-label={playing ? "Pause" : "Play"}>
                  {playing ? <IconPause /> : <IconPlay />}
                </button>
                <button className="ctrl" onClick={() => navigate(1)} title="Next" aria-label="Next">
                  <IconNext />
                </button>
                <button
                  className={`ctrl${repeatAll ? " on" : ""}`}
                  onClick={() => setRepeatAll((on) => !on)}
                  title={repeatAll ? "Repeat all on" : "Repeat all"}
                  aria-pressed={repeatAll}
                  aria-label="Repeat all"
                >
                  <IconRepeat />
                </button>
                <button
                  className={`ctrl repeat-one${repeatOne ? " on" : ""}`}
                  onClick={() => setRepeatOne((on) => !on)}
                  title={repeatOne ? "Repeat song on" : "Repeat song"}
                  aria-pressed={repeatOne}
                  aria-label="Repeat song"
                >
                  <IconRepeatOne />
                </button>
              </div>
            </div>
            <div className="vol-wrap">
              <IconVolume />
              <input
                className="vol-slider"
                type="range"
                min="0"
                max="1"
                step="0.02"
                defaultValue="0.85"
                onChange={(event) => {
                  const volume = Number(event.target.value);
                  userVolRef.current = volume;
                  if (audioRef.current) audioRef.current.volume = volume;
                }}
              />
            </div>
            {trackHasLyrics(track) && !lyricsOpen ? (
              <button type="button" className="sing-along-btn" onClick={openLyricsSheet}>
                SING ALONG...
              </button>
            ) : null}
            <div className={`lyrics-dock${lyricsOpen && trackHasLyrics(track) ? " has-sheet" : ""}`}>
              <div className="lyrics-section lyrics-static">
                {introduction ? <div className="introduction-text">{introduction}</div> : null}
                {track.lyrics.trim() || !track.instrumental ? (
                  <>
                    <div className="lyrics-label">Lyrics</div>
                    <div className="lyrics-text">
                      {track.lyrics || (track.instrumental ? "" : "Lyrics can be added in Admin.")}
                    </div>
                  </>
                ) : null}
                <footer className="site-footer" style={{ borderTop: "1px solid var(--border)", padding: "12px 0 0", marginTop: 16 }}>
                  <CopyrightLines text={album.copyright || DEFAULT_PLAYER_SETUP.copyright} />
                  <div className="sdg">
                    <IconCross />
                    Soli Deo Gloria
                  </div>
                </footer>
              </div>
              {lyricsOpen && trackHasLyrics(track) ? (
                <div className="lyrics-sheet" ref={lyricsSheetRef}>
                  <button
                    type="button"
                    className="lyrics-handle"
                    title="Drag down to close"
                    aria-label="Drag down to close lyrics"
                    onPointerDown={onSheetHandleDown}
                    onPointerMove={onSheetHandleMove}
                    onPointerUp={onSheetHandleUp}
                    onPointerCancel={onSheetHandleUp}
                  >
                    <IconChevronDown />
                  </button>
                  <div
                    className="lyrics-section lyrics-scroll"
                    ref={lyricsRef}
                    onPointerDown={onLyricsPointerDown}
                    onPointerMove={onLyricsPointerMove}
                    onPointerUp={onLyricsPointerUp}
                    onPointerCancel={onLyricsPointerUp}
                  >
                    <div className="lyrics-scroll-track" ref={lyricsTrackRef}>
                      {track.lyrics.trim() || !track.instrumental ? (
                        <>
                          <div className="lyrics-label">Lyrics</div>
                          <div className="lyrics-text">
                            {track.lyrics || (track.instrumental ? "" : "Lyrics can be added in Admin.")}
                          </div>
                        </>
                      ) : null}
                      <div className="lyrics-scroll-pad" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {lightbox && album.artistUrl ? (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <img src={album.artistUrl} alt={album.artists} />
        </div>
      ) : null}

    </div>
      )}
    </>
  );
}

function TrackRow({
  track,
  albumSlug,
  index,
  durationLabel,
  active,
  isPlaying,
  enlarged,
  onZoom,
  onWarm,
  onPlay,
}: {
  track: PublicTrack;
  albumSlug: string;
  index: number;
  durationLabel?: string;
  active: boolean;
  isPlaying: boolean;
  enlarged?: boolean;
  onZoom?: () => void;
  onWarm: () => void;
  onPlay: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyLink(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const url = songShareUrl(window.location.origin, albumSlug, track.slug);
    if (await copyText(url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <div
      className={`track-row${active ? " active" : ""}${isPlaying ? " playing" : ""}${enlarged ? " cover-enlarged" : ""}`}
      data-i={index}
      aria-current={isPlaying ? "true" : undefined}
      onPointerDown={onWarm}
      onClick={onPlay}
    >
      {isPlaying ? (
        <span className="t-eq" aria-hidden="true">
          <i /><i /><i />
        </span>
      ) : (
        <span className="t-num">{pad(track.n)}</span>
      )}
      {track.imageUrl && onZoom ? (
        <button
          type="button"
          className={`t-thumb${enlarged ? " enlarged" : ""}`}
          aria-label={enlarged ? `Shrink ${track.title} cover` : `Enlarge ${track.title} cover`}
          onClick={(event) => {
            event.stopPropagation();
            onZoom();
          }}
        >
          <img src={track.imageUrl} alt="" loading={index === 0 ? "eager" : "lazy"} decoding="async" />
        </button>
      ) : (
        <div className="t-thumb">
          {track.imageUrl ? (
            <img src={track.imageUrl} alt="" loading={index === 0 ? "eager" : "lazy"} decoding="async" />
          ) : null}
        </div>
      )}
      <div className="t-info">
        <div className="t-title">
          {track.title}
          {track.instrumental ? (
            <>
              <br />
              <span className="t-instrumental">(Instrumental)</span>
            </>
          ) : null}
        </div>
        {isPlaying ? <div className="t-now">Playing</div> : null}
        {track.scripture ? <div className="t-subtitle">{track.scripture}</div> : null}
      </div>
      <button
        type="button"
        className={`t-copy${copied ? " on" : ""}`}
        data-tip={copied ? "Copied" : "Copy link to send this song to your friends.."}
        aria-label={copied ? `Copied link to ${track.title}` : "Copy link to send this song to your friends.."}
        onClick={copyLink}
      >
        {copied ? "Copied" : <IconLink />}
      </button>
      <span className="t-dur">{durationLabel || "—"}</span>
      <div className="t-play-icon" aria-hidden="true">{isPlaying ? <IconPause /> : <IconPlay />}</div>
    </div>
  );
}

function IconLink() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.9 12a5 5 0 0 1 5-5h3v2h-3a3 3 0 1 0 0 6h3v2h-3a5 5 0 0 1-5-5zm7-1h2.2v2H10.9zm3.2-4h3a5 5 0 0 1 0 10h-3v-2h3a3 3 0 1 0 0-6h-3z" />
    </svg>
  );
}

function IconBack() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.4 6.4 10.8 11l4.6 4.6L14 17l-6-6 6-6z" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 6 5-6z" /></svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
  );
}

function IconRestart() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
    </svg>
  );
}

function IconPrev() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
  );
}

function IconNext() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" /></svg>
  );
}

function IconRepeat() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" /></svg>
  );
}

function IconRepeatOne() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
      <path d="M13 15V9h-1.1L10 10.1v1.1l1.4-.9H11.5V15H13z" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
  );
}

function IconVolume() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" /></svg>
  );
}

function IconCross() {
  return (
    <svg className="sdg-cross" viewBox="0 0 10 11" aria-hidden="true">
      <rect x="4" y="0" width="2" height="11" />
      <rect x="0" y="3.5" width="10" height="2" />
    </svg>
  );
}
