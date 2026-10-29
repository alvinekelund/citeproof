import { createRoot } from "react-dom/client";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

// Without Supabase settings the client throws on import; show setup steps instead of a blank page.
if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
  root.render(
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "15vh auto", padding: "0 16px", lineHeight: 1.6 }}>
      <h1>Citeproof is not configured yet</h1>
      <p>
        Copy <code>.env.example</code> to <code>.env</code>, fill in your Supabase URL and anon key, then restart{" "}
        <code>npm run dev</code>. The README walks through the full setup.
      </p>
    </main>,
  );
} else {
  import("./App.tsx").then(({ default: App }) => root.render(<App />));
}
