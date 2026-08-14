import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import ChatPage from "./routes/ChatPage";
import ReadPage from "./routes/ReadPage";
import SettingsPage from "./routes/SettingsPage";
import SkillsPage from "./routes/SkillsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<ReadPage />} />
        <Route path="read" element={<Navigate to="/" replace />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
