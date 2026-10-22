import { Navigate, Route, Routes } from "react-router-dom";
import { useApi, useSession } from "../data";
import { ErrorBanner, Skeleton } from "../patterns";
import { HomeScreen } from "../screens/HomeScreen";
import { ReposScreen } from "../screens/ReposScreen";
import { RunScreen } from "../screens/RunScreen";
import { SetupScreen } from "../screens/SetupScreen";
import { SignInScreen } from "../screens/SignInScreen";
import { Layout } from "./Layout";
import styles from "./App.module.css";

/** Routes. Everything except sign-in sits inside the sidebar layout. */
export function App() {
  const api = useApi();
  const session = useSession();
  if (session.isLoading) {
    return <div className={styles.loading}><Skeleton lines={3} /></div>;
  }
  if (session.isError) {
    return <div className={styles.loading}><ErrorBanner message="Caramel's server did not answer. Check that it is running." onRetry={() => void session.refetch()} /></div>;
  }
  if (session.data === null || session.data === undefined) return <SignInScreen loginUrl={api.loginUrl} />;
  return (
    <Routes>
      <Route element={<Layout login={session.data.login} />}>
        <Route index element={<HomeScreen />} />
        <Route path="setup" element={<SetupScreen />} />
        <Route path="repos" element={<ReposScreen />} />
        <Route path="runs/:id" element={<RunScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
