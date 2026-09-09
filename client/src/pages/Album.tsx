import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useRoute } from "wouter";
import AdminLoginLink from "../components/AdminLoginLink";
import { fetchAlbum } from "../lib/api";
import type { PublicAlbum, PublicTrack } from "@shared/types";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function copyrightParts(text: string): string[] {
  const marker = "Reserved.";
  const at = text.indexOf(marker);
  if (at < 0) return [text];
  const first = text.slice(0, at + marker.length).trim();
  const rest = text.slice(at + marker.length).trim();
  return rest ? [first, rest] : [first];
}

function CopyrightLines({ text }: { text: string }) {
  const parts = copyrightParts(text);
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
  const [playing, setPlaying] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [durations, setDurations] = useState<Record<string, string>>({});
  const [repeatAll, setRepeatAll] = useState(false);
  const [repeatOne, setRepeatOne] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const albumRef = useRef<PublicAlbum | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  const probeStopRef = useRef(false);

  function sameSrc(audio: HTMLAudioElement, src: string): boolean {
    try {
      return audio.src === new URL(src, window.location.href).href;
    } catch {
      return false;
    }
  }

  function prefetch(url: string) {
    if (!url) return;
    let el = preloadRef.current;
    if (!el) {
      el = new Audio();
      el.preload = "auto";
      preloadRef.current = el;
    }
    if (el.dataset.url === url) return;
    el.dataset.url = url;
    el.src = url;
  }

  useEffect(() => {
    fetchAlbum(slug)
      .then((data) => {
        setAlbum(data);
        document.title = `${data.title} — ${data.artists}`;
      })
      .catch((err: Error) => setError(err.message));
  }, [slug]);

  const track = useMemo(
    () => (album && active !== null ? album.tracks[active] : null),
    [album, active],
  );

  useEffect(() => {
    albumRef.current = album;
    if (album?.tracks[0]?.audioUrl) prefetch(album.tracks[0].audioUrl);
  }, [album]);

  useEffect(() => {
    if (!album) return;
    probeStopRef.current = false;
    const items = album.tracks.filter((item) => item.audioUrl);
    let index = 0;
    let timer = 0;
    const probeNext = () => {
      if (probeStopRef.current) return;
      const item = items[index++];
      if (!item) return;
      const probe = new Audio();
      probe.preload = "metadata";
      const finish = () => {
        probe.removeAttribute("src");
        probe.load();
        timer = window.setTimeout(probeNext, 400);
      };
      probe.onloadedmetadata = () => {
        setDurations((prev) => ({ ...prev, [item.id]: formatTime(probe.duration) }));
        finish();
      };
      probe.onerror = finish;
      probe.src = item.audioUrl;
    };
    timer = window.setTimeout(probeNext, 600);
    return () => {
      probeStopRef.current = true;
      window.clearTimeout(timer);
    };
  }, [album]);

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

  function load(index: number, autoplay: boolean) {
    const catalog = albumRef.current;
    const next = catalog?.tracks[index];
    const audio = audioRef.current;
    if (!next || !audio) return;
    if (!sameSrc(audio, next.audioUrl)) {
      audio.src = next.audioUrl;
    }
    history.replaceState(null, "", `#${next.slug}`);
    const upcoming = catalog?.tracks[(index + 1) % catalog.tracks.length];
    if (upcoming?.audioUrl) prefetch(upcoming.audioUrl);
    if (autoplay) {
      probeStopRef.current = true;
      void audio.play().then(() => {
        setPlaying(true);
        acquireWake();
      }).catch(() => setPlaying(false));
    }
  }

  function openAt(index: number, autoplay: boolean) {
    setActive(index);
    load(index, autoplay);
  }

  function closeModal() {
    setActive(null);
    setPlaying(false);
    audioRef.current?.pause();
    releaseWake();
    history.replaceState(null, "", location.pathname + location.search);
  }

  function navigate(delta: number) {
    if (!album || active === null) return;
    const next = (active + delta + album.tracks.length) % album.tracks.length;
    openAt(next, true);
  }

  function restartSong() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().then(() => {
        setPlaying(true);
        acquireWake();
      }).catch(() => undefined);
    } else {
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
      openAt(active + 1, true);
      return;
    }
    if (repeatAll) {
      openAt(0, true);
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

  if (error) {
    return <main className="home"><AdminLoginLink /><p className="error">{error}</p></main>;
  }
  if (!album) {
    return <main className="home"><AdminLoginLink /><p>Loading…</p></main>;
  }

  return (
    <div className="layout">
      <AdminLoginLink />
      <aside className="portrait-panel">
        {album.heroUrl ? (
          <img className="portrait-img" src={album.heroUrl} alt={`${album.title} — ${album.artists}`} />
        ) : null}
      </aside>
      <section className="track-panel">
        <div className="album-head">
          <h1 className="alb-name2">{album.title}</h1>
          <p className="alb-tag">{album.tagline}</p>
          <p className="alb-credit">{album.credits}</p>
        </div>
        <div className="album-hero">
          <span className="song-count">{album.tracks.length} Songs</span>
          <div className="hero-play">
            <button className="btn-play-all" onClick={() => openAt(0, true)}>
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
              onClick={() => setLightbox(true)}
            />
          ) : null}
        </div>
        <div className="tracks">
          {album.tracks.map((item, index) => (
            <TrackRow
              key={item.id}
              track={item}
              index={index}
              durationLabel={durations[item.id]}
              active={active === index}
              onPlay={() => openAt(index, true)}
            />
          ))}
        </div>
        <footer className="site-footer">
          <CopyrightLines text={album.copyright} />
          <div className="sdg">
            <IconCross />
            Soli Deo Gloria
          </div>
        </footer>
      </section>

      {track ? (
        <div className="modal open">
          <div className="modal-card">
            <div className="modal-head">
              <div
                className="m-cover"
                style={track.imageUrl ? { backgroundImage: `url("${track.imageUrl}")` } : undefined}
              />
              <div className="m-meta">
                <div className="m-eyebrow">{track.scripture || album.title}</div>
                <div className="m-title">{track.title}</div>
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
                  if (audioRef.current) audioRef.current.volume = Number(event.target.value);
                }}
              />
            </div>
            <div className="lyrics-section">
              <div className="lyrics-label">
                {track.instrumental ? track.scripture || "Instrumental" : "Lyrics"}
              </div>
              <div className="lyrics-text">
                {track.lyrics || (track.instrumental ? "" : "Lyrics can be added in Admin.")}
              </div>
              <footer className="site-footer" style={{ borderTop: "1px solid var(--border)", padding: "12px 0 0", marginTop: 16 }}>
                <CopyrightLines text={album.copyright} />
                <div className="sdg">
                  <IconCross />
                  Soli Deo Gloria
                </div>
              </footer>
            </div>
          </div>
        </div>
      ) : null}

      {lightbox && album.artistUrl ? (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <img src={album.artistUrl} alt={album.artists} />
        </div>
      ) : null}

      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
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
    </div>
  );
}

function TrackRow({
  track,
  index,
  durationLabel,
  active,
  onPlay,
}: {
  track: PublicTrack;
  index: number;
  durationLabel?: string;
  active: boolean;
  onPlay: () => void;
}) {
  return (
    <div className={`track-row${active ? " playing" : ""}`} data-i={index} onClick={onPlay}>
      <span className="t-num">{pad(track.n)}</span>
      <div className="t-thumb" style={{ backgroundImage: track.imageUrl ? `url("${track.imageUrl}")` : undefined }} />
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
        <div className="t-scripture">{track.scripture}</div>
      </div>
      <span className="t-dur">{durationLabel || "—"}</span>
      <div className="t-play-icon"><IconPlay /></div>
    </div>
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
