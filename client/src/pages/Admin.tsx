import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { PALETTES, paletteById } from "@shared/palettes";
import { DEFAULT_CURATOR, DEFAULT_PLAYER_SETUP, publicCurator } from "@shared/seed-data";
import type { AlbumListItem, Curator, PlayerSetup, PublicAlbum, PublicTrack } from "@shared/types";
import {
  adminLogin,
  adminLogout,
  adminMe,
  createAlbum,
  fetchCurator,
  recoverCuratorPassword,
  createTrack,
  createTracksBulk,
  deleteAlbum,
  fetchAlbum,
  fetchAlbums,
  fetchPlayerSetup,
  reorderTracks,
  setTrackArchived,
  trackFileUrl,
  updateAlbum,
  updateCurator,
  updatePlayerSetup,
  updateTrack,
  verifyCuratorPassword,
} from "../lib/api";
import { assignSrc, pipelineIsDead, playSong, unlockAudio } from "../lib/audioCache";
import { applyPalette } from "../lib/palette";

type AdminQueue = {
  albumId: string;
  albumTitle: string;
  tracks: PublicTrack[];
  index: number;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function useAdminPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentUrlRef = useRef("");
  const resumeTimeRef = useRef(0);
  const [queue, setQueue] = useState<AdminQueue | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const current = queue?.tracks[queue.index] ?? null;

  function startTrack(track: PublicTrack) {
    unlockAudio();
    const audio = audioRef.current;
    if (!audio || !track.audioUrl) return;
    currentUrlRef.current = track.audioUrl;
    resumeTimeRef.current = 0;
    if (audio.dataset.trackId !== track.id) {
      audio.dataset.trackId = track.id;
      assignSrc(audio, track.audioUrl);
      setCurrentTime(0);
      setDuration(0);
    }
    void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  function warmTrack(track: PublicTrack) {
    unlockAudio();
    const audio = audioRef.current;
    if (!audio || !track.audioUrl || !audio.paused) return;
    if (audio.dataset.trackId === track.id) return;
    audio.dataset.trackId = track.id;
    currentUrlRef.current = track.audioUrl;
    assignSrc(audio, track.audioUrl);
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!current?.audioUrl) {
      audio.pause();
      audio.removeAttribute("src");
      delete audio.dataset.trackId;
      currentUrlRef.current = "";
      audio.load();
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [current]);

  function toggle() {
    const audio = audioRef.current;
    const url = currentUrlRef.current || current?.audioUrl;
    if (!audio || !current || !url) return;
    if (audio.paused) {
      const resumeTime = audio.currentTime > 0.15 ? audio.currentTime : resumeTimeRef.current;
      const play = pipelineIsDead(audio)
        ? playSong(audio, url, resumeTime, true)
        : audio.play().then(() => undefined);
      void play.then(() => setPlaying(true)).catch(() => undefined);
    } else {
      if (audio.currentTime > 0.15) resumeTimeRef.current = audio.currentTime;
      audio.pause();
      setPlaying(false);
    }
  }

  function playAlbumTracks(album: PublicAlbum, index: number, toggleSame = true) {
    const track = album.tracks[index];
    if (!track?.audioUrl) return;
    if (toggleSame && current?.id === track.id) {
      toggle();
      return;
    }
    setQueue({
      albumId: album.id,
      albumTitle: album.title,
      tracks: album.tracks,
      index,
    });
    startTrack(track);
  }

  function playAlbum(album: PublicAlbum) {
    if (queue?.albumId === album.id && current) {
      toggle();
      return;
    }
    const index = album.tracks.findIndex((track) => track.audioUrl);
    if (index >= 0) playAlbumTracks(album, index, false);
  }

  function syncQueue(album: PublicAlbum) {
    setQueue((currentQueue) => {
      if (!currentQueue || currentQueue.albumId !== album.id) return currentQueue;
      const playingId = currentQueue.tracks[currentQueue.index]?.id;
      const liveIndex = album.tracks.findIndex((track) => track.id === playingId);
      if (liveIndex >= 0) {
        return {
          albumId: album.id,
          albumTitle: album.title,
          tracks: album.tracks,
          index: liveIndex,
        };
      }
      const archived = album.archivedTracks || [];
      const archivedIndex = archived.findIndex((track) => track.id === playingId);
      if (archivedIndex >= 0) {
        return {
          albumId: album.id,
          albumTitle: `${album.title} (Archive)`,
          tracks: archived,
          index: archivedIndex,
        };
      }
      return null;
    });
  }

  function skip(delta: number) {
    if (!queue) return;
    if (delta > 0) {
      const found = queue.tracks.findIndex((track, index) => index > queue.index && track.audioUrl);
      if (found >= 0) {
        setQueue({ ...queue, index: found });
        startTrack(queue.tracks[found]);
      }
      return;
    }
    for (let index = queue.index - 1; index >= 0; index -= 1) {
      if (queue.tracks[index]?.audioUrl) {
        setQueue({ ...queue, index });
        startTrack(queue.tracks[index]);
        return;
      }
    }
  }

  function onEnded() {
    if (!queue) return;
    const next = queue.tracks.findIndex((track, index) => index > queue.index && track.audioUrl);
    if (next >= 0) {
      setQueue({ ...queue, index: next });
      startTrack(queue.tracks[next]);
      return;
    }
    setPlaying(false);
  }

  function restart() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
  }

  function seek(event: MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    audio.currentTime = ((event.clientX - rect.left) / rect.width) * duration;
  }

  function stop() {
    const audio = audioRef.current;
    audio?.pause();
    if (audio) {
      audio.removeAttribute("src");
      delete audio.dataset.trackId;
      audio.load();
    }
    currentUrlRef.current = "";
    setQueue(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }

  return {
    audioRef,
    queue,
    current,
    playing,
    currentTime,
    duration,
    playAlbum,
    playAlbumTracks,
    warmTrack,
    syncQueue,
    toggle,
    skip,
    restart,
    seek,
    stop,
    onEnded,
    setCurrentTime: (time: number) => {
      setCurrentTime(time);
      if (time > 0.15) resumeTimeRef.current = time;
    },
    setDuration,
    setPlaying,
  };
}

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [error, setError] = useState("");
  const [albums, setAlbums] = useState<AlbumListItem[]>([]);
  const [selected, setSelected] = useState<PublicAlbum | null>(null);
  const [playerSetup, setPlayerSetup] = useState<PlayerSetup>(DEFAULT_PLAYER_SETUP);
  const [curator, setCurator] = useState<Curator>(publicCurator(DEFAULT_CURATOR));
  const [curatorOpen, setCuratorOpen] = useState(false);
  const [curatorRecover, setCuratorRecover] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [albumSetupOpen, setAlbumSetupOpen] = useState(false);
  const [createAlbumOpen, setCreateAlbumOpen] = useState(false);
  const player = useAdminPlayer();

  async function refresh() {
    const list = await fetchAlbums();
    setAlbums(list);
    if (selected) {
      const next = await fetchAlbum(selected.slug);
      setSelected(next);
    }
  }

  useEffect(() => {
    adminMe()
      .then(async (me) => {
        setAuthed(me.admin);
        if (me.admin) {
          await refresh();
          const next = await fetchPlayerSetup();
          setPlayerSetup(next);
          setCurator(await fetchCurator());
          applyPalette(next.collectionColor);
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <main className="admin"><p>Loading…</p></main>;

  if (!authed) {
    return (
      <main className="admin">
        <h1>{playerSetup.appName} Admin</h1>
        <p>The public player stays open. This password only unlocks adding albums, songs, artwork, and lyrics.</p>
        {recoverOpen ? (
          <LostPasswordForm
            needRecoveryKey
            onRecovered={async () => {
              setRecoverOpen(false);
              setAuthed(true);
              await refresh();
              const next = await fetchPlayerSetup();
              setPlayerSetup(next);
              setCurator(await fetchCurator());
              applyPalette(next.collectionColor);
            }}
            onCancel={() => {
              setError("");
              setRecoverOpen(false);
            }}
          />
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              try {
                await adminLogin(password);
                setAuthed(true);
                await refresh();
                const next = await fetchPlayerSetup();
                setPlayerSetup(next);
                setCurator(await fetchCurator());
                applyPalette(next.collectionColor);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Login failed");
              }
            }}
          >
            <PasswordField
              id="password"
              label="Admin password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
            />
            <button type="button" className="lost-password" onClick={() => { setError(""); setRecoverOpen(true); }}>
              Lost Password?
            </button>
            <div className="form-actions">
              <button type="submit">Sign in</button>
            </div>
            {error ? <p className="error">{error}</p> : null}
          </form>
        )}
      </main>
    );
  }

  async function loadAlbum(slug: string): Promise<PublicAlbum> {
    const album = await fetchAlbum(slug);
    setSelected(album);
    player.syncQueue(album);
    return album;
  }

  return (
    <main className={`admin${player.current ? " has-player" : ""}`}>
      <header className="admin-top">
        <h1>{playerSetup.appName} Admin</h1>
        <div className="admin-top-actions">
          <a href="/" className="ghost">View site</a>
          <button
            className="ghost"
            onClick={async () => {
              player.stop();
              await adminLogout();
              setAuthed(false);
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      {error ? <p className="error">{error}</p> : null}

      <section className="card curator-card">
        <div>
          <h2>Curator</h2>
          <dl className="curator-fields">
            <div>
              <dt>First Name</dt>
              <dd>{curator.firstName || "—"}</dd>
            </div>
            <div>
              <dt>Last Name</dt>
              <dd>{curator.lastName || "—"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{curator.email || "—"}</dd>
            </div>
            <div>
              <dt>Password</dt>
              <dd>••••••••</dd>
              <button
                type="button"
                className="lost-password"
                onClick={() => {
                  setCuratorRecover(true);
                  setCuratorOpen(true);
                }}
              >
                Lost Password?
              </button>
            </div>
          </dl>
        </div>
        <button
          type="button"
          onClick={() => {
            setCuratorRecover(false);
            setCuratorOpen(true);
          }}
        >
          Edit
        </button>
      </section>
      {curatorOpen ? (
        <AdminDialog title="Curator" onClose={() => { setCuratorOpen(false); setCuratorRecover(false); }}>
          <CuratorEditor
            curator={curator}
            startRecover={curatorRecover}
            onSaved={(next) => {
              setCurator(next);
              setCuratorOpen(false);
              setCuratorRecover(false);
            }}
            onCancel={() => {
              setCuratorOpen(false);
              setCuratorRecover(false);
            }}
          />
        </AdminDialog>
      ) : null}

      <section className="card player-setup-card">
        <div>
          <h2>Player Setup</h2>
          <p className="hint">Collection cover, logo, app name, theme, credits, and copyright on the public player.</p>
        </div>
        <button type="button" onClick={() => setSetupOpen(true)}>
          Edit
        </button>
      </section>
      {setupOpen ? (
        <AdminDialog title="Player Setup" onClose={() => { applyPalette(playerSetup.collectionColor); setSetupOpen(false); }}>
          <PlayerSetupForm
            setup={playerSetup}
            onSaved={(next) => {
              setPlayerSetup(next);
              applyPalette(next.collectionColor);
              setSetupOpen(false);
            }}
            onCancel={() => setSetupOpen(false)}
          />
        </AdminDialog>
      ) : null}

      {selected && albumSetupOpen ? (
        <AdminDialog title="Album Setup" onClose={() => setAlbumSetupOpen(false)}>
          <AlbumSetupForm
            key={selected.id}
            album={selected}
            setup={playerSetup}
            onSaved={async (slug) => {
              setAlbumSetupOpen(false);
              const list = await fetchAlbums();
              setAlbums(list);
              await loadAlbum(slug);
            }}
            onCancel={() => setAlbumSetupOpen(false)}
          />
        </AdminDialog>
      ) : null}
      {createAlbumOpen ? (
        <AdminDialog title="Create new Album" onClose={() => setCreateAlbumOpen(false)}>
          <AlbumForm
            embedded
            onCancel={() => setCreateAlbumOpen(false)}
            onSaved={async (slug) => {
              setCreateAlbumOpen(false);
              const list = await fetchAlbums();
              setAlbums(list);
              await loadAlbum(slug);
              setAlbumSetupOpen(true);
            }}
          />
        </AdminDialog>
      ) : null}

      <AlbumCoverRow
        albums={albums}
        selectedId={selected?.id || null}
        onSelect={async (slug) => {
          setAlbumSetupOpen(false);
          if (selected?.slug !== slug) await loadAlbum(slug);
        }}
        onEdit={async (slug) => {
          if (selected?.slug !== slug) await loadAlbum(slug);
          setAlbumSetupOpen(true);
        }}
        onCreate={() => setCreateAlbumOpen(true)}
      />

      {selected ? (
        <>
          <TrackAdmin
            album={selected}
            currentTrackId={player.current?.id || null}
            playing={player.playing}
            onWarm={(trackId) => {
              const track =
                selected.tracks.find((item) => item.id === trackId) ||
                selected.archivedTracks?.find((item) => item.id === trackId);
              if (track) player.warmTrack(track);
            }}
            onPlay={(trackId) => {
              const liveIndex = selected.tracks.findIndex((track) => track.id === trackId);
              if (liveIndex >= 0) {
                player.playAlbumTracks(selected, liveIndex);
                return;
              }
              const archived = selected.archivedTracks || [];
              const archivedIndex = archived.findIndex((track) => track.id === trackId);
              if (archivedIndex >= 0) {
                player.playAlbumTracks({ ...selected, tracks: archived }, archivedIndex);
              }
            }}
            onPlayAll={() => player.playAlbum(selected)}
            onChange={async () => { await loadAlbum(selected.slug); }}
          />
          <AlbumForm
            key={selected.id}
            album={selected}
            onSaved={async (slug) => {
              const list = await fetchAlbums();
              setAlbums(list);
              await loadAlbum(slug);
            }}
            onDeleted={async () => {
              if (player.queue?.albumId === selected.id) player.stop();
              setSelected(null);
              await refresh();
            }}
          />
        </>
      ) : null}

      <AdminPlayer
        audioRef={player.audioRef}
        current={player.current}
        albumTitle={player.queue?.albumTitle || ""}
        playing={player.playing}
        currentTime={player.currentTime}
        duration={player.duration}
        onToggle={player.toggle}
        onSkip={player.skip}
        onRestart={player.restart}
        onSeek={player.seek}
        onStop={player.stop}
        onEnded={player.onEnded}
        onTimeUpdate={player.setCurrentTime}
        onDurationChange={player.setDuration}
        onPlayingChange={player.setPlaying}
      />
    </main>
  );
}

function CoverField({
  label,
  name,
  currentUrl,
  previewClass = "setup-cover-preview",
}: {
  label: string;
  name: string;
  currentUrl?: string;
  previewClass?: string;
}) {
  return (
    <>
      <label>{label}</label>
      {currentUrl ? <img className={previewClass} src={currentUrl} alt="" /> : null}
      <input name={name} type="file" accept="image/*" />
    </>
  );
}

function ColorField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange?: (id: string) => void;
}) {
  const current = paletteById(value);
  return (
    <>
      <label>{label}</label>
      <div className="palette-current" aria-hidden="true">
        <span className="palette-swatch" style={{ background: current.bg }} />
        <span className="palette-swatch" style={{ background: current.card }} />
        <span className="palette-swatch" style={{ background: current.input }} />
        <span className="palette-swatch" style={{ background: current.text }} />
        <span className="palette-swatch" style={{ background: current.muted }} />
        <span className="palette-swatch" style={{ background: current.accent }} />
        <span>{current.name}</span>
      </div>
      <div className="palette-choices">
        {PALETTES.map((palette) => (
          <label key={palette.id} className={`palette-choice${palette.id === current.id ? " on" : ""}`}>
            <input
              type="radio"
              name={name}
              value={palette.id}
              checked={palette.id === current.id}
              onChange={() => onChange?.(palette.id)}
            />
            <span className="palette-choice-swatches">
              <span className="palette-swatch" style={{ background: palette.bg }} />
              <span className="palette-swatch" style={{ background: palette.card }} />
              <span className="palette-swatch" style={{ background: palette.accent }} />
            </span>
            <span>{palette.name}</span>
          </label>
        ))}
      </div>
    </>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
        />
        <button
          type="button"
          className="password-switch"
          role="switch"
          aria-checked={visible}
          aria-label={visible ? "Hide password" : "View password"}
          onClick={() => setVisible((open) => !open)}
        >
          <span className="password-switch-track" aria-hidden="true">
            <span className="password-switch-knob" />
          </span>
          <span>{visible ? "Hide" : "View"}</span>
        </button>
      </div>
    </>
  );
}

function LostPasswordForm({
  needRecoveryKey,
  onRecovered,
  onCancel,
}: {
  needRecoveryKey: boolean;
  onRecovered: (password: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        if (password !== confirmPassword) {
          setError("New passwords do not match");
          return;
        }
        try {
          await recoverCuratorPassword({
            password,
            email: needRecoveryKey ? email : undefined,
            recoveryPassword: needRecoveryKey ? recoveryPassword : undefined,
          });
          await onRecovered(password);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not reset password");
        }
      }}
    >
      <p className="hint">
        {needRecoveryKey
          ? "Enter the email on your Curator profile and the Admin password from your hosting settings, then choose a new password."
          : "Choose a new curator password. You are already signed in."}
      </p>
      {needRecoveryKey ? (
        <>
          <label htmlFor="recover-email">Email</label>
          <input
            id="recover-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <PasswordField
            id="recover-key"
            label="Recovery password"
            autoComplete="current-password"
            value={recoveryPassword}
            onChange={setRecoveryPassword}
            required
          />
        </>
      ) : null}
      <PasswordField
        id="recover-password"
        label="New password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        required
      />
      <PasswordField
        id="recover-confirm"
        label="Confirm new password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        required
      />
      <div className="form-actions">
        <button type="submit">Reset password</button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function CuratorEditor({
  curator,
  startRecover,
  onSaved,
  onCancel,
}: {
  curator: Curator;
  startRecover?: boolean;
  onSaved: (curator: Curator) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const [recovering, setRecovering] = useState(Boolean(startRecover));
  const [verifiedPassword, setVerifiedPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [firstName, setFirstName] = useState(curator.firstName);
  const [lastName, setLastName] = useState(curator.lastName);
  const [email, setEmail] = useState(curator.email);
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  if (recovering) {
    return (
      <LostPasswordForm
        needRecoveryKey={false}
        onRecovered={(password) => {
          setVerifiedPassword(password);
          setRecovering(false);
        }}
        onCancel={() => {
          if (startRecover) onCancel();
          else setRecovering(false);
        }}
      />
    );
  }

  if (!verifiedPassword) {
    return (
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            await verifyCuratorPassword(currentPassword);
            setVerifiedPassword(currentPassword);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Wrong password");
          }
        }}
      >
        <p className="hint">Enter your current password to edit curator details.</p>
        <PasswordField
          id="curator-verify"
          label="Password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
          required
        />
        <button type="button" className="lost-password" onClick={() => { setError(""); setRecovering(true); }}>
          Lost Password?
        </button>
        <div className="form-actions">
          <button type="submit">Continue</button>
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </form>
    );
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        if (nextPassword && nextPassword !== confirmPassword) {
          setError("New passwords do not match");
          return;
        }
        try {
          onSaved(await updateCurator({
            currentPassword: verifiedPassword,
            firstName,
            lastName,
            email,
            password: nextPassword || undefined,
          }));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed");
        }
      }}
    >
      <label htmlFor="curator-first">First Name</label>
      <input id="curator-first" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
      <label htmlFor="curator-last">Last Name</label>
      <input id="curator-last" value={lastName} onChange={(event) => setLastName(event.target.value)} />
      <label htmlFor="curator-email">Email</label>
      <input id="curator-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <PasswordField
        id="curator-password"
        label="New password"
        autoComplete="new-password"
        value={nextPassword}
        onChange={setNextPassword}
        placeholder="Leave blank to keep the current password"
      />
      <PasswordField
        id="curator-confirm"
        label="Confirm new password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
      />
      <div className="form-actions">
        <button type="submit">Save Curator</button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function PlayerSetupForm({
  setup,
  onSaved,
  onCancel,
}: {
  setup: PlayerSetup;
  onSaved: (setup: PlayerSetup) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const [color, setColor] = useState(setup.collectionColor);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const form = new FormData(event.currentTarget);
        try {
          onSaved(await updatePlayerSetup(form));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed");
        }
      }}
    >
      <CoverField label="Collection Cover" name="cover" currentUrl={setup.collectionCoverUrl} />
      <CoverField label="Logo" name="logo" currentUrl={setup.logoUrl} previewClass="setup-logo-preview" />
      <ColorField
        label="Collection Color"
        name="collectionColor"
        value={color}
        onChange={(id) => {
          setColor(id);
          applyPalette(id);
        }}
      />
      <label>App Name</label>
      <input name="appName" defaultValue={setup.appName} required />
      <label>Theme</label>
      <input name="theme" defaultValue={setup.theme} />
      <label>Credits</label>
      <input name="credits" defaultValue={setup.credits} />
      <label>Copyright</label>
      <textarea name="copyright" className="player-setup-copyright" defaultValue={setup.copyright} />
      <div className="form-actions">
        <button type="submit">Save Player Setup</button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            applyPalette(setup.collectionColor);
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function AlbumSetupForm({
  album,
  setup,
  onSaved,
  onCancel,
}: {
  album: PublicAlbum;
  setup: PlayerSetup;
  onSaved: (slug: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const [color, setColor] = useState(album.color);
  useEffect(() => {
    applyPalette(album.color);
    return () => applyPalette(setup.collectionColor);
  }, [album.color, setup.collectionColor]);
  const copied = {
    theme: album.tagline || setup.theme,
    credits: album.credits || setup.credits,
    copyright: album.copyright || setup.copyright,
  };
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const form = new FormData(event.currentTarget);
        try {
          const saved = await updateAlbum(album.id, form);
          await onSaved(saved.slug);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed");
        }
      }}
    >
      <CoverField label="Album Background" name="hero" currentUrl={album.heroUrl} />
      <CoverField label="Album Cover" name="thumb" currentUrl={album.thumbUrl} />
      <ColorField
        label="Album Color"
        name="color"
        value={color}
        onChange={(id) => {
          setColor(id);
          applyPalette(id);
        }}
      />
      <label>Album Name</label>
      <input name="title" defaultValue={album.title} required />
      <label>Theme</label>
      <input name="tagline" defaultValue={copied.theme} />
      <label>Credits</label>
      <input name="credits" defaultValue={copied.credits} />
      <label>Copyright</label>
      <textarea name="copyright" className="player-setup-copyright" defaultValue={copied.copyright} />
      <div className="form-actions">
        <button type="submit">Save Album Setup</button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function AlbumForm({
  album,
  embedded,
  onSaved,
  onCancel,
  onDeleted,
}: {
  album?: PublicAlbum;
  embedded?: boolean;
  onSaved: (slug: string) => Promise<void>;
  onCancel?: () => void;
  onDeleted?: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  return (
    <form
      className={embedded ? undefined : "card"}
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const formEl = event.currentTarget;
        const form = new FormData(formEl);
        try {
          const saved = album ? await updateAlbum(album.id, form) : await createAlbum(form);
          await onSaved(saved.slug);
          if (!album) formEl.reset();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed");
        }
      }}
    >
      {embedded ? null : <h2>{album ? `Edit ${album.title}` : "New album"}</h2>}
      {album ? null : (
        <>
          <label>Title</label>
          <input name="title" required />
        </>
      )}
      <div className="row-2">
        <div>
          <label>URL slug</label>
          <input name="slug" defaultValue={album?.slug} placeholder="echoes" />
        </div>
        <div>
          <label>Artists</label>
          <input name="artists" defaultValue={album?.artists} />
        </div>
      </div>
      <div className="row-2">
        <div>
          <label>Album Background</label>
          <input name="hero" type="file" accept="image/*" />
        </div>
        <div>
          {album ? (
            <>
              <label>Artist photo (player thumbnail)</label>
              <input name="artist" type="file" accept="image/*" />
            </>
          ) : (
            <>
              <label>Album cover</label>
              <input name="thumb" type="file" accept="image/*" />
            </>
          )}
        </div>
      </div>
      {album ? null : (
        <>
          <label>Artist photo (player thumbnail)</label>
          <input name="artist" type="file" accept="image/*" />
        </>
      )}
      <label>
        <input name="hidden" type="checkbox" value="true" defaultChecked={album ? album.hidden : true} /> Hide from the
        public site. You can still play it while signed in as admin.
      </label>
      <div className="form-actions">
        <button type="submit">{album ? "Save album" : "Create album"}</button>
        {onCancel ? (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {album && onDeleted ? (
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if (!confirm(`Delete ${album.title}?`)) return;
              await deleteAlbum(album.id);
              await onDeleted();
            }}
          >
            Delete album
          </button>
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function moveById<T extends { id: string }>(items: T[], fromId: string, toId: string): T[] {
  if (fromId === toId) return items;
  const from = items.findIndex((item) => item.id === fromId);
  const to = items.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function AlbumCoverRow({
  albums,
  selectedId,
  onSelect,
  onEdit,
  onCreate,
}: {
  albums: AlbumListItem[];
  selectedId: string | null;
  onSelect: (slug: string) => Promise<void>;
  onEdit: (slug: string) => Promise<void>;
  onCreate: () => void;
}) {
  return (
    <section className="card album-setup-gallery">
      <h2>Album Setup</h2>
      <div className="album-cover-row">
        {albums.map((album) => {
          const coverUrl = album.thumbUrl || album.heroUrl;
          return (
            <div key={album.id} className="album-cover-item">
              <button
                type="button"
                className={`album-cover-tile${selectedId === album.id ? " selected" : ""}`}
                aria-label={album.title}
                onClick={() => void onSelect(album.slug)}
              >
                {coverUrl ? <img src={coverUrl} alt="" /> : <span className="album-cover-empty" />}
                {album.hidden ? <span className="hidden-badge">Hidden</span> : null}
              </button>
              <button type="button" className="album-cover-edit" onClick={() => void onEdit(album.slug)}>
                Edit
              </button>
            </div>
          );
        })}
        <button type="button" className="album-cover-tile album-cover-create" onClick={onCreate}>
          <span>Create new Album</span>
        </button>
      </div>
    </section>
  );
}

function TrackDownload({ track }: { track: PublicTrack }) {
  if (!track.file) {
    return (
      <span className="ghost" aria-disabled="true" title="No audio file">
        Download
      </span>
    );
  }
  return (
    <a className="ghost" href={trackFileUrl(track.id)} download={track.file} title={`Download ${track.title}`}>
      Download
    </a>
  );
}

function TrackAdmin({
  album,
  currentTrackId,
  playing,
  onWarm,
  onPlay,
  onPlayAll,
  onChange,
}: {
  album: PublicAlbum;
  currentTrackId: string | null;
  playing: boolean;
  onWarm: (trackId: string) => void;
  onPlay: (trackId: string) => void;
  onPlayAll: () => void;
  onChange: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<PublicTrack | null>(null);
  const [rows, setRows] = useState(album.tracks);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    setRows(album.tracks);
  }, [album.tracks]);

  async function dropOn(fromId: string | null, targetId: string) {
    setDraggingId(null);
    if (!fromId) return;
    const next = moveById(rows, fromId, targetId);
    if (next === rows) return;
    setRows(next);
    try {
      await reorderTracks(album.id, next.map((track) => track.id));
      await onChange();
    } catch {
      setRows(album.tracks);
    }
  }

  return (
    <section className="card">
      <div className="track-head">
        <h2>Tracks — {album.title}</h2>
        <div className="track-head-actions">
          <button
            type="button"
            className="ghost"
            onPointerDown={() => {
              if (album.tracks[0]) onWarm(album.tracks[0].id);
            }}
            onClick={onPlayAll}
            disabled={!album.tracks.some((track) => track.audioUrl)}
          >
            {currentTrackId && album.tracks.some((track) => track.id === currentTrackId) && playing ? "Pause" : "Play all"}
          </button>
          <BulkTrackUpload albumId={album.id} onSaved={onChange} />
        </div>
      </div>
      <p className="hint">
        Drag the handle to reorder songs. Play a track here, or download the live MP3 to keep a copy.
      </p>
      {rows.map((track, index) => (
        <div
          className={`track-admin${draggingId === track.id ? " dragging" : ""}${currentTrackId === track.id ? " playing" : ""}`}
          key={track.id}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            void dropOn(event.dataTransfer.getData("text/plain") || draggingId, track.id);
          }}
        >
          <button
            type="button"
            className="drag-handle"
            draggable
            title="Drag to reorder"
            aria-label={`Reorder ${track.title}`}
            onDragStart={(event) => {
              setDraggingId(track.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", track.id);
            }}
            onDragEnd={() => setDraggingId(null)}
          >
            ⋮⋮
          </button>
          <div className="track-admin-num">{String(index + 1).padStart(2, "0")}</div>
          {track.imageUrl ? <img src={track.imageUrl} alt="" /> : <div className="track-admin-placeholder">No cover</div>}
          <div className="track-admin-info">
            <strong>{track.title}</strong>
            <div>{track.scripture || (track.lyrics ? "" : "Add subtitle, lyrics, and cover later")}</div>
          </div>
          <div className="track-admin-actions">
            <button
              type="button"
              className={`ghost admin-track-play${currentTrackId === track.id && playing ? " on" : ""}`}
              onPointerDown={() => onWarm(track.id)}
              onClick={() => onPlay(track.id)}
              disabled={!track.audioUrl}
              title={track.audioUrl ? (currentTrackId === track.id && playing ? "Pause" : "Play") : "No audio file"}
              aria-label={`${currentTrackId === track.id && playing ? "Pause" : "Play"} ${track.title}`}
            >
              {currentTrackId === track.id && playing ? <IconPause /> : <IconPlay />}
            </button>
            <button type="button" className="ghost" onClick={() => setEditing(track)}>Edit</button>
            <TrackDownload track={track} />
            <button
              type="button"
              className="danger"
              onClick={async () => {
                if (!confirm(`Archive ${track.title}? You can restore it later from Archive.`)) return;
                await setTrackArchived(track.id, true);
                await onChange();
              }}
            >
              Archive
            </button>
          </div>
        </div>
      ))}
      <TrackForm
        key="new"
        albumId={album.id}
        track={null}
        nextNumber={album.tracks.length + 1}
        onSaved={onChange}
        onCancel={() => undefined}
      />
      <ArchiveList
        tracks={album.archivedTracks || []}
        currentTrackId={currentTrackId}
        playing={playing}
        onWarm={onWarm}
        onPlay={onPlay}
        onRestore={async (track) => {
          await setTrackArchived(track.id, false);
          await onChange();
        }}
        onEdit={setEditing}
      />
      {editing ? (
        <AdminDialog title={`Edit ${editing.title}`} onClose={() => setEditing(null)}>
          <TrackForm
            key={editing.id}
            albumId={album.id}
            track={editing}
            nextNumber={editing.n}
            heading={false}
            onSaved={async () => {
              setEditing(null);
              await onChange();
            }}
            onCancel={() => setEditing(null)}
          />
        </AdminDialog>
      ) : null}
    </section>
  );
}

function ArchiveList({
  tracks,
  currentTrackId,
  playing,
  onWarm,
  onPlay,
  onRestore,
  onEdit,
}: {
  tracks: PublicTrack[];
  currentTrackId: string | null;
  playing: boolean;
  onWarm: (trackId: string) => void;
  onPlay: (trackId: string) => void;
  onRestore: (track: PublicTrack) => Promise<void>;
  onEdit: (track: PublicTrack) => void;
}) {
  return (
    <div className="archive-block">
      <h3>Archive</h3>
      <p className="hint">
        {tracks.length
          ? "These songs are hidden from the album. Restore one to put it back live."
          : "Archived songs will appear here so you can restore them later."}
      </p>
      {tracks.map((track) => (
        <div
          className={`track-admin archive-row${currentTrackId === track.id ? " playing" : ""}`}
          key={track.id}
        >
          {track.imageUrl ? <img src={track.imageUrl} alt="" /> : <div className="track-admin-placeholder">No cover</div>}
          <div className="track-admin-info">
            <strong>{track.title}</strong>
            <div>{track.scripture || "Archived"}</div>
          </div>
          <div className="track-admin-actions">
            <button
              type="button"
              className={`ghost admin-track-play${currentTrackId === track.id && playing ? " on" : ""}`}
              onPointerDown={() => onWarm(track.id)}
              onClick={() => onPlay(track.id)}
              disabled={!track.audioUrl}
              title={track.audioUrl ? (currentTrackId === track.id && playing ? "Pause" : "Play") : "No audio file"}
              aria-label={`${currentTrackId === track.id && playing ? "Pause" : "Play"} ${track.title}`}
            >
              {currentTrackId === track.id && playing ? <IconPause /> : <IconPlay />}
            </button>
            <button type="button" className="ghost" onClick={() => onEdit(track)}>Edit</button>
            <TrackDownload track={track} />
            <button type="button" onClick={() => void onRestore(track)}>Restore</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function BulkTrackUpload({ albumId, onSaved }: { albumId: string; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(0);
  const inputId = useId();
  return (
    <form
      className="bulk-upload-inline"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const formEl = event.currentTarget;
        const form = new FormData(formEl);
        const files = form.getAll("audio").filter((item) => item instanceof File && item.size > 0);
        if (!files.length) {
          setError("Choose one or more MP3 files");
          return;
        }
        setBusy(true);
        try {
          await createTracksBulk(albumId, form);
          await onSaved();
          formEl.reset();
          setPicked(0);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Upload failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        id={inputId}
        className="file-input-hidden"
        name="audio"
        type="file"
        accept="audio/mpeg,audio/*"
        multiple
        onChange={(event) => setPicked(event.currentTarget.files?.length || 0)}
      />
      <label htmlFor={inputId} className="ghost file-pick">
        {picked ? `${picked} selected` : "Choose files"}
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Uploading…" : picked ? `Upload ${picked}` : "Upload"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function TrackForm({
  albumId,
  track,
  nextNumber,
  heading = true,
  onSaved,
  onCancel,
}: {
  albumId: string;
  track: PublicTrack | null;
  nextNumber: number;
  heading?: boolean;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const formEl = event.currentTarget;
        const form = new FormData(formEl);
        try {
          if (track) await updateTrack(track.id, form);
          else await createTrack(albumId, form);
          await onSaved();
          formEl.reset();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed");
        }
      }}
    >
      {heading ? <h3>{track ? `Edit ${track.title}` : "Add one song"}</h3> : null}
      <div className="row-2">
        <div>
          <label>Title</label>
          <input name="title" defaultValue={track?.title} required />
        </div>
        <div>
          <label>Subtitle</label>
          <input name="scripture" defaultValue={track?.scripture} placeholder="Shown under the song title" />
        </div>
      </div>
      <div className="row-2">
        <div>
          <label>{track ? "Replace MP3" : "Audio file"}</label>
          <input name="audio" type="file" accept="audio/mpeg,audio/*" />
          {track?.file ? <p className="hint">Current file: {track.file}. Leave empty to keep it.</p> : null}
        </div>
        <div>
          <label>{track ? "Replace artwork" : "Artwork"}</label>
          <input name="artwork" type="file" accept="image/*" />
        </div>
      </div>
      <label>Introduction</label>
      <textarea name="introduction" defaultValue={track?.introduction} placeholder="Optional. Shown above the lyrics." />
      <label>Lyrics</label>
      <textarea name="lyrics" defaultValue={track?.lyrics} />
      <label>
        <input name="instrumental" type="checkbox" value="true" defaultChecked={track?.instrumental} /> Instrumental
      </label>
      <input type="hidden" name="n" value={track?.n || nextNumber} />
      <div className="form-actions">
        <button type="submit">{track ? "Save song" : "Add song"}</button>
        {track ? <button type="button" className="ghost" onClick={onCancel}>Cancel</button> : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function AdminDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const focusable = panelRef.current?.querySelector<HTMLElement>("input:not([type='hidden']), textarea, select");
    focusable?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="admin-dialog-backdrop" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="admin-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-dialog-head">
          <h3>{title}</h3>
          <button type="button" className="ghost admin-dialog-close" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AdminPlayer({
  audioRef,
  current,
  albumTitle,
  playing,
  currentTime,
  duration,
  onToggle,
  onSkip,
  onRestart,
  onSeek,
  onStop,
  onEnded,
  onTimeUpdate,
  onDurationChange,
  onPlayingChange,
}: {
  audioRef: RefObject<HTMLAudioElement>;
  current: PublicTrack | null;
  albumTitle: string;
  playing: boolean;
  currentTime: number;
  duration: number;
  onToggle: () => void;
  onSkip: (delta: number) => void;
  onRestart: () => void;
  onSeek: (event: MouseEvent<HTMLDivElement>) => void;
  onStop: () => void;
  onEnded: () => void;
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  return (
    <>
      {current ? (
        <div className="admin-player" role="region" aria-label="Admin player">
          {current.imageUrl ? (
            <img className="admin-player-art" src={current.imageUrl} alt="" />
          ) : (
            <div className="admin-player-art placeholder" aria-hidden="true" />
          )}
          <div className="admin-player-meta">
            <div className="admin-player-title">{current.title}</div>
            <div className="admin-player-album">{albumTitle}</div>
          </div>
          <div className="admin-player-controls">
            <button type="button" className="ghost admin-player-ctrl" onClick={onRestart} title="Back to beginning" aria-label="Back to beginning">
              <IconRestart />
            </button>
            <button type="button" className="ghost admin-player-ctrl" onClick={() => onSkip(-1)} title="Previous" aria-label="Previous">
              <IconPrev />
            </button>
            <button
              type="button"
              className="admin-player-play"
              onClick={onToggle}
              title={playing ? "Pause" : "Play"}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <IconPause /> : <IconPlay />}
            </button>
            <button type="button" className="ghost admin-player-ctrl" onClick={() => onSkip(1)} title="Next" aria-label="Next">
              <IconNext />
            </button>
            <button type="button" className="ghost admin-player-ctrl" onClick={onStop} title="Close player" aria-label="Close player">
              <IconClose />
            </button>
          </div>
          <div className="admin-player-progress">
            <span className="time">{formatTime(currentTime)}</span>
            <div className="prog-bar" onClick={onSeek}>
              <div className="prog-fill" style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }} />
            </div>
            <span className="time">{formatTime(duration)}</span>
          </div>
        </div>
      ) : null}
      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
        onDurationChange={(event) => onDurationChange(event.currentTarget.duration || 0)}
        onEnded={onEnded}
        onPlay={() => onPlayingChange(true)}
        onPause={() => onPlayingChange(false)}
      />
    </>
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

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
  );
}
