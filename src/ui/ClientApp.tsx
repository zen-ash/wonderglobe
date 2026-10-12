"use client";
// The game is entirely client-side (WebGL, IndexedDB, Web Audio).
import dynamic from "next/dynamic";

const App = dynamic(() => import("./App"), {
  ssr: false,
  loading: () => (
    <div className="loading-screen" role="status">
      <div className="spinner-planet" />
      Getting the crayons ready…
    </div>
  ),
});

export default function ClientApp() {
  return <App />;
}
