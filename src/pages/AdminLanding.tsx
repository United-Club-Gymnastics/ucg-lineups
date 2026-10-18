export default function AdminLanding() {
  return (
    <main style={{ padding: 24 }}>
      <h1 className="display" style={{ fontSize: 40 }}>UCG Lineups</h1>
      <p>Admins sign in with their UCG Google account.</p>
      <button className="btn primary" type="button" disabled>Sign in with Google</button>
    </main>
  );
}
