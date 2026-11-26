import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { getRoute, matchPath, navigate, setHash, useRoute } from "./router";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("matchPath", () => {
  it("extracts typed params", () => {
    const params = matchPath("/e/:slug", "/e/musical-navidad");
    expect(params).toEqual({ slug: "musical-navidad" });
    expect(matchPath("/admin/pagos/:id", "/admin/pagos/abc%20123")).toEqual({ id: "abc 123" });
  });

  it("ignores trailing slashes and rejects other paths", () => {
    expect(matchPath("/estado", "/estado/")).toEqual({});
    expect(matchPath("/e/:slug", "/e")).toBeNull();
    expect(matchPath("/e/:slug", "/e/a/b")).toBeNull();
    expect(matchPath("/e/:slug", "/x/a")).toBeNull();
  });

  it("supports a trailing wildcard", () => {
    expect(matchPath("/admin/*", "/admin/pagos/1")).toEqual({});
    expect(matchPath("/admin/*", "/public")).toBeNull();
  });
});

describe("navigation", () => {
  it("pushes paths, parses query and hash", () => {
    navigate("/e/navidad?code=ABC-123#datos");
    const route = getRoute();
    expect(route.path).toBe("/e/navidad");
    expect(route.hash).toBe("datos");
    expect(route.query.get("code")).toBe("ABC-123");
  });

  it("returns a stable snapshot until the location changes", () => {
    navigate("/estado");
    expect(getRoute()).toBe(getRoute());
  });

  it("re-renders useRoute subscribers on navigate, hash changes and back/forward", () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current.path).toBe("/");
    act(() => navigate("/admin"));
    expect(result.current.path).toBe("/admin");
    act(() => setHash("pagos"));
    expect(result.current.hash).toBe("pagos");
    expect(result.current.path).toBe("/admin");
    act(() => {
      window.history.replaceState(null, "", "/estado");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.path).toBe("/estado");
  });

  it("replace does not add a history entry", () => {
    const before = window.history.length;
    navigate("/a", { replace: true });
    expect(window.history.length).toBe(before);
    navigate("/b");
    expect(window.history.length).toBe(before + 1);
  });
});
