import { useCallback } from "react";
import { useToast } from "../../ui";
import { useSessionActions } from "../session/SessionContext";

/** Signs out and confirms it with a toast. */
export function useLogout(): () => void {
  const { logout } = useSessionActions();
  const toast = useToast();
  return useCallback(() => {
    void logout().then(() => toast.show({ message: "Cerraste la sesión.", tone: "ok" }));
  }, [logout, toast]);
}
