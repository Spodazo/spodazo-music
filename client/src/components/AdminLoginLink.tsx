import { Link } from "wouter";

export default function AdminLoginLink() {
  return (
    <Link href="/admin" className="admin-login" aria-label="Admin login" title="Admin login">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9h-2zm-8 0V7a3 3 0 0 1 6 0v2H9zm3 5.2a1.8 1.8 0 0 1 .8 3.4V19h-1.6v-1.4a1.8 1.8 0 0 1 .8-3.4z" />
      </svg>
    </Link>
  );
}
