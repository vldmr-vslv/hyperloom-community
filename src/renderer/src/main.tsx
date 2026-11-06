import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import App from "./App";
import "./index.css";
import "./rings.css";
import "./rings-agent.css";
import { applyTheme, savedTheme } from "./themes";
import { installTips } from "./tips";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Ошибка отрисовки интерфейса:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "32px", color: "#f87171", fontFamily: "monospace", background: "#1a1a1a", height: "100vh", boxSizing: "border-box" }}>
          <h2 style={{ margin: "0 0 16px 0", color: "#ef4444" }}>Ошибка интерфейса</h2>
          <pre style={{ whiteSpace: "pre-wrap", color: "#e5e7eb", fontSize: "12px", maxHeight: "60vh", overflow: "auto" }}>
            {this.state.error.stack || this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: "16px",
              padding: "8px 16px",
              background: "#374151",
              color: "#fff",
              border: "1px solid #4b5563",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Перезагрузить окно
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("не найден узел #root в index.html");

// Тема - до первой отрисовки: иначе окно показалось бы в тёмном виде и перекрасилось на глазах.
applyTheme(savedTheme());
// Подсказки прототипа вместо системных.
installTips();

// Провайдер снаружи полотна: App сам берёт у него масштаб и положение камеры - для льда.
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <ReactFlowProvider>
        <App />
      </ReactFlowProvider>
    </ErrorBoundary>
  </StrictMode>,
);

