import { Route, Switch } from "wouter";
import AdminPage from "./pages/Admin";
import AlbumPage from "./pages/Album";
import HomePage from "./pages/Home";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/:slug" component={AlbumPage} />
    </Switch>
  );
}
