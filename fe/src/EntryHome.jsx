import React from "react";
import { Link } from "react-router-dom";

export function EntryHome() {
  return (
    <main className="app app--entry">
      <section className="content content--entry">
        <div className="panel">
          <div className="panel-head">
            <h1 className="panel-title">Brogress</h1>
            <p className="panel-hint">
              Otwórz adres z Twoim nickiem w ścieżce, np.{" "}
              <Link to="/u/demo" className="pill">
                /u/demo
              </Link>{" "}
              (domyślne hasło: <code>demo</code>).
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
