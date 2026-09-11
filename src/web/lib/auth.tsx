import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";
import { api } from "./api";
import type { User } from "./types";

interface AuthContextValue {
  user: User | null | undefined;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api.me()).user,
  });

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => api.login(email, password),
    onSuccess: (data) => queryClient.setQueryData(["me"], data.user),
  });

  const signupMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => api.signup(email, password),
    onSuccess: (data) => queryClient.setQueryData(["me"], data.user),
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => queryClient.setQueryData(["me"], null),
  });

  const value: AuthContextValue = {
    user: meQuery.data,
    isLoading: meQuery.isLoading,
    login: async (email, password) => {
      await loginMutation.mutateAsync({ email, password });
    },
    signup: async (email, password) => {
      await signupMutation.mutateAsync({ email, password });
    },
    logout: async () => {
      await logoutMutation.mutateAsync();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
