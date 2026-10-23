import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { HOSTED_CAPABILITIES, type Capabilities, type FollowUpBody, type Provider, type RunView, type StartRunBody } from "../lib/contract";
import { applyThread } from "./apply";
import { isActive } from "../lib/status";
import { ApiError, type ApiClient } from "./api";

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (api === null) throw new Error("useApi needs an ApiContext provider.");
  return api;
}

export const keys = {
  me: ["me"] as const,
  runs: ["runs"] as const,
  run: (id: string) => ["runs", id] as const,
  result: (id: string) => ["runs", id, "result"] as const,
  patch: (id: string) => ["runs", id, "patch"] as const,
  providers: ["providers"] as const,
};

export function useSession() {
  const api = useApi();
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

/** What this server can do (hosted site or desktop app). Hosted until /api/me says otherwise. */
export function useCapabilities(): Capabilities {
  const session = useSession();
  return session.data?.capabilities ?? HOSTED_CAPABILITIES;
}

/** Applies a thread's turns, oldest first, into the user's local folder. */
export function useApplyThread() {
  const api = useApi();
  return useMutation({ mutationFn: (runIds: string[]) => applyThread(api, runIds) });
}

/** All of the user's runs; polls while any is active so the sidebar's status dots stay current. */
export function useRuns() {
  const api = useApi();
  return useQuery({
    queryKey: keys.runs,
    queryFn: api.listRuns,
    refetchInterval: (query) => ((query.state.data ?? []).some((run) => isActive(run.status)) ? 4000 : false),
  });
}

export function useRun(id: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: keys.run(id ?? ""),
    queryFn: () => api.getRun(id ?? ""),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data !== undefined && isActive(query.state.data.status) ? 3000 : false),
  });
}

export function useRunResult(id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: keys.result(id),
    queryFn: () => api.getResult(id),
    enabled,
    staleTime: Infinity,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

export function usePatch(id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: keys.patch(id),
    queryFn: () => api.getPatch(id),
    enabled,
    staleTime: Infinity,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

export function useProviders() {
  const api = useApi();
  return useQuery({ queryKey: keys.providers, queryFn: api.listProviders });
}

export function useStartRun() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: StartRunBody | FollowUpBody) => api.startRun(body),
    onSuccess: (run) => {
      client.setQueryData(keys.run(run.id), run);
      void client.invalidateQueries({ queryKey: keys.runs });
      if (run.parentRunId !== null) void client.invalidateQueries({ queryKey: keys.run(run.parentRunId) });
    },
  });
}

export function useCancelRun() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelRun(id),
    onSuccess: (run: RunView) => {
      client.setQueryData(keys.run(run.id), run);
      void client.invalidateQueries({ queryKey: keys.runs });
    },
  });
}

export function useSaveKey() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, key, endpoint }: { provider: Provider; key: string; endpoint?: { baseUrl: string; model: string } }) =>
      api.saveKey(provider, key, endpoint),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.providers }),
  });
}

export function useConnectProvider() {
  const api = useApi();
  return useMutation({ mutationFn: (provider: Provider) => api.connectProvider(provider) });
}

export function useTestKey() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (provider: Provider) => api.testKey(provider),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.providers }),
  });
}

export function useDeleteKey() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (provider: Provider) => api.deleteKey(provider),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.providers }),
  });
}

export function useLogout() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => client.setQueryData(keys.me, null),
  });
}

/** Invalidates everything a finished run changes: its record, result, patch and the runs list. */
export function useRunFinishedRefresh() {
  const client = useQueryClient();
  return (id: string) => {
    void client.invalidateQueries({ queryKey: keys.run(id) });
    void client.invalidateQueries({ queryKey: keys.result(id) });
    void client.invalidateQueries({ queryKey: keys.patch(id) });
    void client.invalidateQueries({ queryKey: keys.runs });
  };
}
