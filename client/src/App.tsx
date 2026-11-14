import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import AdminPage from "./pages/Admin";
import AlbumPage from "./pages/Album";
import HomePage from "./pages/Home";

const PlaylistsPage = lazy(() => import("./pages/Playlists"));

function PlaylistsRoute() {
  return (
    <Suspense fallback={<main className="home"><p>Loading…</p></main>}>
      <PlaylistsPage />
    </Suspense>
  );
}

export default function App() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/playlists/:id" component={PlaylistsRoute} />
      <Route path="/playlists" component={PlaylistsRoute} />
      <Route path="/:slug" component={AlbumPage} />
    </Switch>
  );
}
