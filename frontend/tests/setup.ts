import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard",
  useParams: () => ({}),
}));

// jsdom doesn't implement <dialog>.
HTMLDialogElement.prototype.showModal ||= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close ||= function close(this: HTMLDialogElement) { this.removeAttribute("open"); };

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
