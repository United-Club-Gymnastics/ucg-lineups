import { useParams } from 'react-router-dom';

export default function ClubPage() {
  const { token } = useParams();
  return (
    <main style={{ padding: 24 }} data-token={token}>
      <h1 className="display" style={{ fontSize: 40 }}>Club lineup</h1>
      <p>Your club page will appear here.</p>
    </main>
  );
}
