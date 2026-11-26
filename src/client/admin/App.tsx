import { useMemo } from "react";
import { EventThemeProvider } from "../design";
import { ConfigProvider } from "../lib/config/ConfigProvider";
import { AmbientBackground, ToastProvider } from "../ui";
import { AdminShell } from "./AdminShell";
import styles from "./App.module.css";
import { AdminDataProvider } from "./data/AdminData";
import { NavigationProvider } from "./navigation";
import { SessionProvider } from "./session/SessionContext";
import { SessionGate } from "./session/LoginView";
import { useSession } from "./session/useSession";

/** Treasury admin ("Tesorería"): session gate, then the hash-routed panel. */
export function App() {
  const session = useSession();
  const { expire, logout } = session;
  const actions = useMemo(() => ({ expire, logout }), [expire, logout]);

  return (
    <ConfigProvider>
      <ToastProvider>
        <NavigationProvider>
          {session.state.status === "signedIn" ? (
            <SessionProvider value={actions}>
              <AdminDataProvider>
                <AdminShell />
              </AdminDataProvider>
            </SessionProvider>
          ) : (
            <EventThemeProvider tone={null} coverUrl={null} as="div" className={styles.root}>
              <AmbientBackground subtle />
              <SessionGate session={session} />
            </EventThemeProvider>
          )}
        </NavigationProvider>
      </ToastProvider>
    </ConfigProvider>
  );
}
