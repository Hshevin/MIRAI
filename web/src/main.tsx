import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main>
      <header>
        <span className="eyebrow">PRIMARY SUBJECT PRIVACY</span>
        <h1>Keep one person. Hide everything else.</h1>
        <p>
          Analyze a video, choose the person who may remain visible, review uncertain appearances,
          and export a privacy-filtered copy.
        </p>
      </header>
      <section className="upload-card">
        <div className="step">01</div>
        <div>
          <h2>Upload a video</h2>
          <p>Up to 1080p and 30 minutes for the initial release.</p>
          <label>
            Choose video
            <input type="file" accept="video/*" />
          </label>
        </div>
      </section>
      <aside>Audio is preserved and is not anonymized.</aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

