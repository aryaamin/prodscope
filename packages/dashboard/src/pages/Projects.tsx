import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth.js";
import { apiGet, apiPost } from "../api.js";
import { useNavigate } from "react-router-dom";

interface Project {
  id: string;
  name: string;
  api_key: string;
  created_at: string;
}

export function Projects() {
  const { token, setToken } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      const data = await apiGet("/auth/projects", token!);
      setProjects(data);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError("");
    try {
      await apiPost("/auth/projects", { name: newName }, token!);
      setNewName("");
      await loadProjects();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function copyKey(project: Project) {
    navigator.clipboard.writeText(project.api_key);
    setCopiedId(project.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function logout() {
    setToken(null);
    navigate("/login");
  }

  return (
    <div className="dashboard">
      <header>
        <h1>ProdScope</h1>
        <button className="secondary" onClick={logout}>
          Sign out
        </button>
      </header>

      <main>
        <section>
          <h2>Your Projects</h2>
          {error && <p className="error">{error}</p>}

          <form onSubmit={handleCreate} className="create-form">
            <input
              type="text"
              placeholder="New project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
            <button type="submit">Create Project</button>
          </form>

          {projects.length === 0 ? (
            <p className="muted">No projects yet. Create one above.</p>
          ) : (
            <div className="project-list">
              {projects.map((p) => (
                <div key={p.id} className="project-card">
                  <h3>{p.name}</h3>
                  <div className="api-key-row">
                    <code>{p.api_key}</code>
                    <button className="small" onClick={() => copyKey(p)}>
                      {copiedId === p.id ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <div className="config-snippet">
                    <h4>Quick setup</h4>
                    <pre>{`// prodscope.config.ts
export default {
  projectId: "${p.id}",
  apiKey: process.env.PRODSCOPE_API_KEY,
  ingestUrl: "https://ingest.prodscope.dev",
  apiUrl: "https://api.prodscope.dev",
}`}</pre>
                  </div>
                  <p className="muted">
                    Created {new Date(p.created_at).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
