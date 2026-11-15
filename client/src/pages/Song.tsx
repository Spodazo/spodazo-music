import { useEffect, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { lyricLines } from "@shared/lyrics";
import {
  isMobilePlayback,
  pipelineIsDead,
  playSong,
  releaseOutputForRouteChange,
  sameSong,
  setPlaybackSession,
  unlockAudio,
} from "../lib/audioCache";
import { imageIsHot, revealLoadedImage } from "../lib/images";

function introductionParagraphs(text: string): string[] {
  const body = text.replace(/^\s*Introduction\s*\r?\n+/i, "").replace(/\r\n/g, "\n").trim();
  if (!body) return [];
  const blocks = body.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks;
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length > 1 ? lines : [body];
}

type SharedSong = {
  albumTitle: string;
  albumSlug: string;
  track: {
    title: string;
    slug: string;
    scripture: string;
    lyrics: string;
    introduction: string;
    instrumental: boolean;
    imageUrl: string;
    durationLabel: string;
    playUrl: string;
  };
};

export default function SongPage() {
  const [, params] = useRoute("/song/:album/:track");
  const albumSlug = params?.album || "";
  const trackSlug = params?.track || "";
  const [song, setSong] = useState<SharedSong | null>(null);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [phoneRestartNote, setPhoneRestartNote] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSong(null);
    setError("");
    fetch(`/api/songs/${encodeURIComponent(albumSlug)}/${encodeURIComponent(trackSlug)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("This song is not available.");
        return response.json() as Promise<SharedSong>;
      })
      .then((data) => {
        if (!cancelled) setSong(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [albumSlug, trackSlug]);

  useEffect(() => {
    setPlaybackSession();
    return () => {
      const audio = audioRef.current;
      releaseOutputForRouteChange(audio);
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
      }
    };
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    const url = song?.track.playUrl;
    if (!audio || !url) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    unlockAudio(audio);
    const resume = audio.currentTime > 0.2 && sameSong(audio, url);
    const play = resume
      ? audio.play().then(() => undefined)
      : playSong(audio, url, 0, pipelineIsDead(audio), 0.85, false);
    void play.catch(() => {
      if (isMobilePlayback()) setPhoneRestartNote(true);
    });
  }

  const track = song?.track;
  const introduction = track ? introductionParagraphs(track.introduction) : [];
  const lines = track && !track.instrumental ? lyricLines(track.lyrics) : [];

  return (
    <main className="home song-share">
      <Link href="/" className="albums-back playlist-back">Albums</Link>
      {error ? <p className="error">{error}</p> : null}
      {!song && !error ? <p>Loading…</p> : null}
      {track ? (
        <div className="song-share-card">
          {track.imageUrl ? (
            <img
              className={`song-share-cover${imageIsHot(track.imageUrl) ? " is-hot" : ""}`}
              src={track.imageUrl}
              alt=""
              decoding="async"
              ref={(img) => revealLoadedImage(img, track.imageUrl)}
              onLoad={(event) => revealLoadedImage(event.currentTarget, track.imageUrl)}
            />
          ) : null}
          <h1>{track.title}</h1>
          <p className="playlist-device-note">{song.albumTitle}</p>
          {track.scripture ? <p className="song-share-scripture">{track.scripture}</p> : null}
          <button
            type="button"
            className="btn-play-all"
            onPointerDown={() => unlockAudio(audioRef.current)}
            onClick={togglePlay}
          >
            {playing ? "Pause" : "Play"}
          </button>
          {phoneRestartNote ? (
            <p className="phone-restart-note" role="status">If this keeps happening, restart your phone once.</p>
          ) : null}
          {introduction.length ? (
            <div className="song-share-intro">
              {introduction.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          ) : null}
          {lines.length ? (
            <div className="lyrics-text song-share-lyrics">
              <div className="lyrics-label">Lyrics</div>
              {lines.map((line, index) => (
                <span key={index}>
                  {index > 0 ? "\n" : null}
                  {line.heading ? <strong className="lyrics-heading">{line.text}</strong> : line.text}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <audio
        ref={audioRef}
        preload="none"
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={(event) => {
          if (!event.currentTarget.paused) return;
          setPlaying(false);
        }}
      />
    </main>
  );
}
