import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useRoute } from "wouter";
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

export default function AlbumPage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug || "";
  const [album, setAlbum] = useState<PublicAlbum | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [durations, setDurations] = useState<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);

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
    if (!album) return;
    album.tracks.forEach((item) => {
      if (!item.audioUrl) return;
      const probe = new Audio();
      probe.preload = "metadata";
      probe.src = item.audioUrl;
      probe.onloadedmetadata = () => {
        setDurations((prev) => ({ ...prev, [item.id]: formatTime(probe.duration) }));
      };
    });
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
    const next = album?.tracks[index];
    const audio = audioRef.current;
    if (!next || !audio) return;
    audio.src = next.audioUrl;
    history.replaceState(null, "", `#${next.slug}`);
    if (autoplay) {
      audio.play().then(() => {
        setPlaying(true);
        acquireWake();
      }).catch(() => setPlaying(false));
    }
  }

  function openAt(index: number, autoplay: boolean) {
    setActive(index);
    setTimeout(() => load(index, autoplay), 0);
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

  function onEnded() {
    if (repeat) {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => undefined);
      }
      return;
    }
    navigate(1);
  }

  function seek(event: MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    audio.currentTime = ((event.clientX - rect.left) / rect.width) * duration;
  }

  if (error) {
    return <main className="home"><p className="error">{error}</p></main>;
  }
  if (!album) {
    return <main className="home"><p>Loading…</p></main>;
  }

  return (
    <div className="album-page">
      <aside className="portrait-panel" id="portraitPanel">
        {album.heroUrl ? <img id="portraitImg" src={album.heroUrl} alt={`${album.title} — ${album.artists}`} /> : null}
        <div className="portrait-shade" />
        <div className="portrait-title">{album.title.toUpperCase()}</div>
        <div className="portrait-artists">{album.artists.toUpperCase()}</div>
      </aside>
      <section className="track-panel">
        <div className="album-head">
          <h1 className="alb-name">{album.title}</h1>
          <p className="alb-tag">{album.tagline}</p>
          <p className="alb-credit">{album.credits}</p>
          <div className="album-actions">
            <button className="btn-play-all" id="btnPlayAll" onClick={() => openAt(0, true)}>▶ PLAY ALL</button>
            <span className="song-count" id="songCount">{album.tracks.length} Songs</span>
          </div>
          {album.thumbUrl ? <img className="hero-thumb" id="heroThumb" src={album.thumbUrl} alt={album.artists} /> : null}
        </div>
        <div className="tracks" id="trackList">
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
        <footer className="album-foot">
          <div>{album.copyright}</div>
          <div className="sdg">† Soli Deo Gloria</div>
        </footer>
      </section>

      {track ? (
        <div className="modal" id="modal" onClick={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
          <div className="modal-card" id="modalCard">
            {track.imageUrl ? <img className="modal-cover" id="mCover" src={track.imageUrl} alt={track.title} /> : <div />}
            <div className="modal-body">
              <button className="close" id="btnClose" onClick={closeModal} aria-label="Close">×</button>
              <div className="modal-eyebrow" id="mEyebrow">{track.scripture || album.title}</div>
              <h2 className="modal-title" id="mTitle">{track.title}</h2>
              <div className="time-row">
                <span id="timeCur">{formatTime(currentTime)}</span>
                <div className="prog" id="progBar" onClick={seek}>
                  <div className="prog-fill" id="progFill" style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }} />
                </div>
                <span id="timeDur">{formatTime(duration)}</span>
              </div>
              <div className="controls">
                <button id="btnPrev" onClick={() => navigate(-1)} aria-label="Previous">⏮</button>
                <button className="play" id="btnPlayModal" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
                  {playing ? "❚❚" : "▶"}
                </button>
                <button id="btnNext" onClick={() => navigate(1)} aria-label="Next">⏭</button>
                <button id="btnRepeat" className={repeat ? "on" : ""} onClick={() => setRepeat((value) => !value)} aria-label="Repeat">↺</button>
                <input
                  className="vol"
                  id="volSlider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  defaultValue="1"
                  onChange={(event) => {
                    if (audioRef.current) audioRef.current.volume = Number(event.target.value);
                  }}
                />
              </div>
              <div className="lyrics-label" id="lyricsLabel">
                {track.instrumental ? track.scripture || "Instrumental" : "Lyrics"}
              </div>
              <div className="lyrics" id="lyricsText">
                {track.lyrics || (track.instrumental ? "" : "Lyrics can be added in Admin.")}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <audio
        id="audio"
        ref={audioRef}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
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
    <div className={`track-row${active ? " active" : ""}`} data-i={index} onClick={onPlay}>
      <span className="t-num">{pad(track.n)}</span>
      <div className="t-thumb" style={{ backgroundImage: track.imageUrl ? `url('${track.imageUrl}')` : undefined }} />
      <div className="t-info">
        <div className="t-title">{track.title}</div>
        <div className="t-scripture">{track.scripture}</div>
      </div>
      <div className="t-dur" id={`dur${index}`}>{durationLabel || "—"}</div>
      <div className="t-play">▶</div>
    </div>
  );
}
