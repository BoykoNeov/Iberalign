// jsdom test setup — runs only for the `dom` vitest project (`*.dom.test.tsx`), never
// for the pure `node` project. Registers jest-dom's matchers (`toBeInTheDocument`,
// `toHaveValue`, …) and unmounts React trees after each test so cases stay isolated.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
